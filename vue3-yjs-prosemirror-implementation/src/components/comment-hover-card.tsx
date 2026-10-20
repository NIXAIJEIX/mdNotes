"use client";

import { useEffect, useState } from "react";
import { pickTopComments, type Thread } from "@/lib/comments";
import { MarkdownView } from "@/components/markdown-view";

export interface HoverTarget {
  threadIds: string[];
  /** 被评论句子的联合矩形(视口坐标) */
  rect: { left: number; top: number; bottom: number; width: number };
}

const MIN_WIDTH = 200;
const MAX_WIDTH = 620;

/**
 * 极简悬浮预览。
 * 只显示一条评论正文；不显示作者、头像、时间、原文、点赞、按钮、分页、回复框。
 * 评论按点赞数优先、同赞数按时间最新，Markdown / KaTeX 正常渲染。
 */
export default function CommentHoverCard({
  target,
  threads,
  onMouseEnter,
  onMouseLeave,
}: {
  target: HoverTarget | null;
  threads: Thread[];
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const [flip, setFlip] = useState(false);

  useEffect(() => {
    if (!target) return;
    setFlip(window.innerHeight - target.rect.bottom < 180);
  }, [target]);

  if (!target) return null;
  const matched = threads.filter((thread) => target.threadIds.includes(thread.id));
  const top = pickTopComments(matched, "hot", 1)[0];
  if (!top) return null;

  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, target.rect.width));
  const left = Math.min(
    Math.max(8, target.rect.left),
    Math.max(8, window.innerWidth - width - 8),
  );
  const style: React.CSSProperties = flip
    ? { left, width, bottom: window.innerHeight - target.rect.top + 6 }
    : { left, width, top: target.rect.bottom + 6 };

  return (
    <div
      role="tooltip"
      className="fixed z-40 max-h-[240px] overflow-auto rounded border border-gray-200 bg-white px-2.5 py-2 shadow-[0_3px_12px_rgba(0,0,0,0.10)]"
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <MarkdownView content={top.row.body} compact />
    </div>
  );
}
