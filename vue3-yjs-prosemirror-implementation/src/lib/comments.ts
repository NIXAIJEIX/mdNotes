"use client";

import * as Y from "yjs";
import type { Editor } from "@tiptap/react";
import {
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
} from "@tiptap/y-tiptap";
import { b64ToU8, u8ToB64 } from "@/lib/collab-provider";

/* ---------------- 类型 ---------------- */

export interface CommentRow {
  id: string;
  docId: string;
  parentId: string | null;
  kind: "inline" | "doc";
  anchor: string | null;
  quote: string | null;
  authorId: string;
  authorName: string;
  authorColor: string;
  body: string;
  resolved: boolean;
  createdAt: string;
  likeCount: number;
  likedByMe: boolean;
}

/** 锚点:Yjs 相对位置(base64)+ 原文快照 */
export interface Anchor {
  from: string;
  to: string;
  quote: string | null;
}

export interface Thread {
  id: string;
  kind: "inline" | "doc";
  quote: string | null;
  anchor: Anchor | null;
  resolved: boolean;
  createdAt: string;
  items: CommentRow[];
  /** 串内所有评论的点赞总和,用于悬浮卡热度排序 */
  likeCount: number;
  lastActiveAt: string;
}

/* ---------------- 锚点编解码 ---------------- */

export function parseAnchor(raw: string | null): Anchor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Anchor;
    if (!parsed?.from || !parsed?.to) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 把 ProseMirror 选区转成 Yjs 相对位置。
 * 相对位置挂在 CRDT item 上,别人在锚点前后插入/删除文字都不会让它漂移 ——
 * 这是多人读书笔记能长期可用的前提。
 */
export function encodeAnchor(
  editor: Editor,
  from: number,
  to: number,
): Anchor | null {
  const sync = ySyncPluginKey.getState(editor.state) as
    | {
        type: Y.XmlFragment;
        doc: Y.Doc;
        binding: { mapping: Map<unknown, unknown> };
      }
    | undefined;
  if (!sync) return null;

  const mapping = sync.binding.mapping as never;
  const relFrom = absolutePositionToRelativePosition(from, sync.type, mapping);
  const relTo = absolutePositionToRelativePosition(to, sync.type, mapping);
  if (!relFrom || !relTo) return null;

  const quote = editor.state.doc
    .textBetween(from, to, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);

  return {
    from: u8ToB64(Y.encodeRelativePosition(relFrom)),
    to: u8ToB64(Y.encodeRelativePosition(relTo)),
    quote: quote || null,
  };
}

/** 把锚点还原成当前文档里的 ProseMirror 位置(已被删除的锚点返回 null) */
export function resolveAnchor(
  editor: Editor,
  anchor: Anchor,
): { from: number; to: number } | null {
  const sync = ySyncPluginKey.getState(editor.state) as
    | {
        type: Y.XmlFragment;
        doc: Y.Doc;
        binding: { mapping: Map<unknown, unknown> };
      }
    | undefined;
  if (!sync) return null;

  try {
    const mapping = sync.binding.mapping as never;
    const from = relativePositionToAbsolutePosition(
      sync.doc,
      sync.type,
      Y.decodeRelativePosition(b64ToU8(anchor.from)),
      mapping,
    );
    const to = relativePositionToAbsolutePosition(
      sync.doc,
      sync.type,
      Y.decodeRelativePosition(b64ToU8(anchor.to)),
      mapping,
    );
    if (from == null || to == null) return null;

    const size = editor.state.doc.content.size;
    const a = Math.min(from, to);
    const b = Math.min(Math.max(from, to), size);
    if (a >= b || b > size) return null;
    return { from: a, to: b };
  } catch {
    return null;
  }
}

/* ---------------- 组树 ---------------- */

/** 扁平评论列表 → 评论串(根 + 回复) */
export function buildThreads(rows: CommentRow[]): Thread[] {
  const byParent = new Map<string | null, CommentRow[]>();
  for (const row of rows) {
    const key = row.parentId;
    const list = byParent.get(key) ?? [];
    list.push(row);
    byParent.set(key, list);
  }

  const roots = byParent.get(null) ?? [];
  return roots.map((root) => {
    const replies = (byParent.get(root.id) ?? []).slice().sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    const items = [root, ...replies];
    return {
      id: root.id,
      kind: root.kind,
      quote: root.quote,
      anchor: parseAnchor(root.anchor),
      resolved: root.resolved,
      createdAt: root.createdAt,
      items,
      likeCount: items.reduce((n, c) => n + (c.likeCount ?? 0), 0),
      lastActiveAt: items[items.length - 1].createdAt,
    };
  });
}

/* ---------------- 网络 ---------------- */

export async function fetchComments(
  docId: string,
  me = "",
): Promise<CommentRow[]> {
  const res = await fetch(
    `/api/docs/${docId}/comments?me=${encodeURIComponent(me)}`,
    { cache: "no-store" },
  );
  if (!res.ok) return [];
  const json = (await res.json()) as { comments: CommentRow[] };
  return json.comments;
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/* ---------------- 悬浮卡排序 ---------------- */

export type HoverSort = "hot" | "new";

/**
 * 取某个锚点下最值得先看的几条评论。
 *  - hot: 点赞多优先,同赞数按时间新的优先
 *  - new: 纯按时间倒序
 * 根评论(发起这条笔记的人)在同分时优先展示。
 */
export function pickTopComments(
  threads: Thread[],
  sort: HoverSort,
  limit = 3,
): { row: CommentRow; threadId: string; isRoot: boolean }[] {
  const flat = threads.flatMap((t) =>
    t.items.map((row, i) => ({ row, threadId: t.id, isRoot: i === 0 })),
  );
  flat.sort((a, b) => {
    if (sort === "hot" && b.row.likeCount !== a.row.likeCount) {
      return b.row.likeCount - a.row.likeCount;
    }
    if (sort === "hot" && a.isRoot !== b.isRoot) return a.isRoot ? -1 : 1;
    return b.row.createdAt.localeCompare(a.row.createdAt);
  });
  return flat.slice(0, limit);
}

export function countComments(threads: Thread[]): number {
  return threads.reduce((n, t) => n + t.items.length, 0);
}
