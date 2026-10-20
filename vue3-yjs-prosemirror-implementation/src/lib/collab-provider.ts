"use client";

import { useSyncExternalStore } from "react";
import * as Y from "yjs";

/**
 * HttpCollabProvider —— 协同传输层(框架无关,Vue3 里可原样复用)。
 *
 * 职责与 y-websocket Provider 一致:
 *  1. 首屏: 服务端把 update log 内联进 HTML(或本地快照命中),这里不再请求全量
 *  2. 本地编辑: 监听 Y.Doc update,串行推送到服务端(= 上行 update 帧)
 *  3. 远端编辑: 自适应增量拉取 after=lastSeq(= 下行广播帧)
 *
 * 换成自写 ws 网关时,只需要把 pull/push 替换成 ws.send / ws.onmessage,
 * 上层编辑器代码零改动。
 */

export type CollabStatus = "connecting" | "synced" | "saving" | "offline";

export const b64ToU8 = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
};

export const u8ToB64 = (u8: Uint8Array): string => {
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin);
};

export const REMOTE_ORIGIN = "remote";
const ACTIVE_INTERVAL = 600; // 有人正在编辑:高频拉取,体感接近本地
const IDLE_INTERVAL = 2500; // 静默:降频省电
const ACTIVE_WINDOW = 8000;

export class HttpCollabProvider {
  readonly doc: Y.Doc;
  private docId: string;
  private lastSeq: number;
  private queue: Uint8Array[] = [];
  private pushing = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private lastActivity = Date.now();
  private statusListeners = new Set<(s: CollabStatus) => void>();
  private seqListeners = new Set<(seq: number) => void>();
  private status: CollabStatus = "connecting";

  constructor(docId: string, doc: Y.Doc, initialSeq = 0) {
    this.docId = docId;
    this.doc = doc;
    this.lastSeq = initialSeq;
    this.doc.on("update", this.onLocalUpdate);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibility);
    }
  }

  getLastSeq(): number {
    return this.lastSeq;
  }

  onStatus(fn: (s: CollabStatus) => void): () => void {
    this.statusListeners.add(fn);
    fn(this.status);
    return () => this.statusListeners.delete(fn);
  }

  onSeq(fn: (seq: number) => void): () => void {
    this.seqListeners.add(fn);
    return () => this.seqListeners.delete(fn);
  }

  private setStatus(s: CollabStatus) {
    if (this.status === s) return;
    this.status = s;
    this.statusListeners.forEach((fn) => fn(s));
  }

  private bump() {
    this.lastActivity = Date.now();
    this.schedule();
  }

  /** 首屏已经拿到数据,这里只做一次轻量对齐 + 启动轮询 */
  async connect(): Promise<void> {
    await this.pull();
    if (this.destroyed) return;
    this.setStatus("synced");
    this.schedule();
  }

  private schedule() {
    if (this.destroyed || this.timer) return;
    const idle = Date.now() - this.lastActivity > ACTIVE_WINDOW;
    const delay = idle ? IDLE_INTERVAL : ACTIVE_INTERVAL;
    this.timer = setTimeout(async () => {
      this.timer = null;
      if (this.destroyed) return;
      if (document.visibilityState === "hidden") {
        this.schedule();
        return;
      }
      await this.pull();
      this.schedule();
    }, delay);
  }

  private onVisibility = () => {
    if (document.visibilityState === "visible" && !this.destroyed) {
      this.lastActivity = Date.now();
      void this.pull();
    }
  };

  private onLocalUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE_ORIGIN) return; // 远端回放,不要回声
    this.queue.push(update);
    this.bump();
    void this.flush();
  };

  /** 串行推送,把积压的 update 先 merge 再发,减少请求数 */
  private async flush(): Promise<void> {
    if (this.pushing || this.destroyed || this.queue.length === 0) return;
    this.pushing = true;
    this.setStatus("saving");
    try {
      while (this.queue.length > 0 && !this.destroyed) {
        const batch = this.queue;
        this.queue = [];
        const merged = batch.length === 1 ? batch[0] : Y.mergeUpdates(batch);
        const res = await fetch(`/api/docs/${this.docId}/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ update: u8ToB64(merged) }),
        });
        if (!res.ok) throw new Error(`push failed: ${res.status}`);
        // 不在这里推进 lastSeq:并发场景下别人的 seq 可能夹在中间。
        // 下一轮 pull 会把自己的 update 拉回来,CRDT 幂等 apply 即可。
        await res.json().catch(() => null);
      }
      this.setStatus("synced");
    } catch {
      this.setStatus("offline");
      setTimeout(() => void this.flush(), 2500);
    } finally {
      this.pushing = false;
    }
  }

  private async pull(): Promise<void> {
    if (this.destroyed) return;
    try {
      const res = await fetch(
        `/api/docs/${this.docId}/sync?after=${this.lastSeq}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`pull failed: ${res.status}`);
      const json = (await res.json()) as {
        updates: { seq: number; data: string }[];
        lastSeq: number;
      };
      if (json.updates.length > 0) {
        for (const u of json.updates) {
          Y.applyUpdate(this.doc, b64ToU8(u.data), REMOTE_ORIGIN);
          this.lastSeq = Math.max(this.lastSeq, u.seq);
        }
        this.lastActivity = Date.now();
        this.seqListeners.forEach((fn) => fn(this.lastSeq));
      }
      if (this.status === "offline") this.setStatus("synced");
    } catch {
      this.setStatus("offline");
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.doc.off("update", this.onLocalUpdate);
    if (this.timer) clearTimeout(this.timer);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    this.statusListeners.clear();
    this.seqListeners.clear();
  }
}

/** 本地访客身份(昵称 + 光标颜色),存 localStorage */
export interface LocalUser {
  clientId: string;
  name: string;
  color: string;
}

const COLORS = [
  "#3370ff",
  "#04b49c",
  "#f54a45",
  "#ff8800",
  "#7f3bf5",
  "#0fc6c2",
  "#d91f91",
  "#2ea121",
];

export function getLocalUser(): LocalUser {
  if (typeof window === "undefined") {
    return { clientId: "ssr", name: "访客", color: COLORS[0] };
  }
  const KEY = "collab-doc-user";
  const saved = window.localStorage.getItem(KEY);
  if (saved) {
    try {
      return JSON.parse(saved) as LocalUser;
    } catch {
      /* fallthrough */
    }
  }
  const user: LocalUser = {
    clientId: Math.random().toString(36).slice(2, 12),
    name: `访客${Math.floor(1000 + Math.random() * 9000)}`,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  };
  window.localStorage.setItem(KEY, JSON.stringify(user));
  return user;
}

/* ---------- 水合安全的本地用户 ---------- */

/** 服务端渲染 / 水合阶段使用的占位身份(clientId = "ssr" 的不会发任何网络请求) */
export const SSR_USER: LocalUser = {
  clientId: "ssr",
  name: "访客",
  color: COLORS[0],
};

let cachedUser: LocalUser | null = null;
const noopSubscribe = () => () => undefined;

/**
 * 读取本地身份。
 * 服务端与首次水合返回 SSR_USER,水合完成后 React 自动切到真实用户,
 * 避免"服务端昵称 ≠ 客户端昵称"导致 React #418 水合失败、整页重渲染。
 */
export function useLocalUser(): LocalUser {
  return useSyncExternalStore(
    noopSubscribe,
    () => (cachedUser ??= getLocalUser()),
    () => SSR_USER,
  );
}
