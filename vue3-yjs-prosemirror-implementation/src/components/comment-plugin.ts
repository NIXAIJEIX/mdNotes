"use client";

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/react";

/** 一条评论串在文档中的可渲染区间 */
export interface ThreadRange {
  threadId: string;
  from: number;
  to: number;
  count: number;
  resolved: boolean;
  active: boolean;
}

export const commentPluginKey = new PluginKey<DecorationSet>(
  "comment-decorations",
);

interface CommentHighlightOptions {
  onOpenThread: (threadIds: string[]) => void;
  /** 悬浮在被评论句子上(离开时传 null) */
  onHoverThread: (threadIds: string[] | null) => void;
}

/**
 * 评论高亮层。
 *
 * 关键点:评论**不写进 Yjs 文档**,只用 ProseMirror Decoration 本地渲染。
 * 这样评论不会污染正文的协同历史,也不会触发多余的 update 广播;
 * 评论数据存在 Postgres,锚点用 Yjs 相对位置,两端解耦。
 */
export const CommentHighlight = Extension.create<CommentHighlightOptions>({
  name: "commentHighlight",

  addOptions() {
    return { onOpenThread: () => undefined, onHoverThread: () => undefined };
  },

  addProseMirrorPlugins() {
    const extension = this;
    return [
      new Plugin<DecorationSet>({
        key: commentPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const meta = tr.getMeta(commentPluginKey) as
              | DecorationSet
              | undefined;
            if (meta) return meta;
            // 正文变化时映射旧装饰,避免每次按键都重算
            return tr.docChanged ? old.map(tr.mapping, tr.doc) : old;
          },
        },
        props: {
          decorations: (state) =>
            commentPluginKey.getState(state) ?? DecorationSet.empty,
          handleDOMEvents: {
            mouseover(_view, event) {
              const el = (event.target as HTMLElement | null)?.closest?.(
                "[data-thread-id],[data-thread-badge]",
              ) as HTMLElement | null;
              if (!el) return false;
              const id =
                el.getAttribute("data-thread-id") ??
                el.getAttribute("data-thread-badge");
              if (!id) return false;
              extension.options.onHoverThread([id]);
              return false;
            },
            mouseout(_view, event) {
              const from = (event.target as HTMLElement | null)?.closest?.(
                "[data-thread-id],[data-thread-badge]",
              );
              if (!from) return false;
              const to = (event as MouseEvent).relatedTarget as HTMLElement | null;
              // 在同一条高亮的不同片段之间移动时不收起
              if (to?.closest?.("[data-thread-id],[data-thread-badge]")) return false;
              extension.options.onHoverThread(null);
              return false;
            },
          },
          handleClick(view, pos) {
            const set = commentPluginKey.getState(view.state);
            if (!set) return false;
            const hits = set
              .find(Math.max(0, pos - 1), pos + 1)
              .filter((d) => d.spec?.threadId);
            if (hits.length === 0) return false;
            const ids = [
              ...new Set(hits.map((h) => h.spec.threadId as string)),
            ];
            extension.options.onOpenThread(ids);
            return false; // 不拦截:光标仍照常落位
          },
        },
      }),
    ];
  },
});

/* ---------------- 装饰构建 ---------------- */

function makeBadge(range: ThreadRange): HTMLElement {
  const badge = document.createElement("span");
  badge.className = `comment-badge${range.active ? " comment-badge-active" : ""}`;
  badge.contentEditable = "false";
  badge.setAttribute("data-thread-badge", range.threadId);
  badge.title = `${range.count} 条笔记，点击查看`;
  badge.innerHTML = `<svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 3.5A1.5 1.5 0 0 1 4 2h8a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 12 11H6.5L3 13.8V11h-.5A1.5 1.5 0 0 1 1 9.5v-6Z" fill="currentColor"/></svg><span>${range.count}</span>`;
  return badge;
}

let lastSignature = "";

/**
 * 重算并下发评论装饰。签名相同则跳过,保证输入过程零额外开销。
 */
export function refreshCommentDecorations(
  editor: Editor,
  ranges: ThreadRange[],
): void {
  const signature = ranges
    .map(
      (r) =>
        `${r.threadId}:${r.from}:${r.to}:${r.count}:${r.resolved ? 1 : 0}:${r.active ? 1 : 0}`,
    )
    .join("|");
  if (signature === lastSignature) return;
  lastSignature = signature;

  const decorations: Decoration[] = [];
  for (const range of ranges) {
    if (range.from >= range.to) continue;

    const cls = [
      "comment-mark",
      range.resolved ? "comment-mark-resolved" : "",
      range.active ? "comment-mark-active" : "",
    ]
      .filter(Boolean)
      .join(" ");

    decorations.push(
      Decoration.inline(
        range.from,
        range.to,
        { class: cls, "data-thread-id": range.threadId },
        { threadId: range.threadId },
      ),
    );

    // 徽标点击落在锚点末尾,handleClick 通过同区间的 inline 装饰命中评论串
    decorations.push(
      Decoration.widget(range.to, () => makeBadge(range), {
        side: 1,
        // key 必须包含会影响外观的状态,否则 ProseMirror 会复用旧 DOM,徽标数字不更新
        key: `comment-badge-${range.threadId}-${range.count}-${range.active ? 1 : 0}-${range.resolved ? 1 : 0}`,
      }),
    );
  }

  const { state } = editor;
  const tr = state.tr
    .setMeta(commentPluginKey, DecorationSet.create(state.doc, decorations))
    .setMeta("addToHistory", false);
  editor.view.dispatch(tr);
}

/** 重置签名(切换文档时调用,否则新文档装饰会被误判为"无变化") */
export function resetDecorationSignature(): void {
  lastSignature = "__reset__";
}
