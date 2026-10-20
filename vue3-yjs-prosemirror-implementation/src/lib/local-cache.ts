"use client";

/**
 * 本地快照缓存 —— 打开速度的关键。
 *
 * 第二次及以后打开同一篇文档时:
 *  - 首帧直接从 localStorage 里读出 Y.Doc 快照 apply,内容立刻可见(0 网络等待)
 *  - 同时服务端把最新增量内联在 HTML 里,水合后立即合并
 *  - 之后再向网关增量拉取 diff
 *
 * 这就是 y-indexeddb 提供的能力,这里用 localStorage 换同步读取,
 * 少一次 IndexedDB 异步等待,首屏更快。
 */

const PREFIX = "feishu-doc-snapshot:v1:";
const MAX_SNAPSHOT_CHARS = 3_000_000; // localStorage 一般 5MB/域,留余量

interface Snapshot {
  seq: number;
  data: string;
}

function key(docId: string): string {
  return `${PREFIX}${docId}`;
}

export function readSnapshot(docId: string): Snapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key(docId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Snapshot;
    if (typeof parsed?.data !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeSnapshot(docId: string, seq: number, base64: string): void {
  if (typeof window === "undefined") return;
  if (base64.length > MAX_SNAPSHOT_CHARS) return;
  try {
    window.localStorage.setItem(key(docId), JSON.stringify({ seq, data: base64 }));
  } catch {
    // 配额满:清掉自己的旧快照后重试一次
    try {
      for (const k of Object.keys(window.localStorage)) {
        if (k.startsWith(PREFIX) && k !== key(docId)) {
          window.localStorage.removeItem(k);
        }
      }
      window.localStorage.setItem(
        key(docId),
        JSON.stringify({ seq, data: base64 }),
      );
    } catch {
      /* 放弃缓存,不影响功能 */
    }
  }
}

export function dropSnapshot(docId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key(docId));
  } catch {
    /* ignore */
  }
}
