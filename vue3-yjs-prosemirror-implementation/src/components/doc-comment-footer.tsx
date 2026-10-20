"use client";

import { useState } from "react";
import type { Thread } from "@/lib/comments";
import type { LocalUser } from "@/lib/collab-provider";
import { Composer, ThreadCard } from "@/components/comment-thread";

/**
 * 文末评论区(飞书文档底部的「评论」区)。
 * 与划词笔记共用同一张表,kind = "doc"。
 */
export default function DocCommentFooter({
  threads,
  me,
  busy,
  activeIds,
  onSubmit,
  onReply,
  onToggleResolved,
  onDelete,
  onLike,
  onFocusCard,
  onJumpToInline,
  inlineCount,
}: {
  threads: Thread[];
  me: LocalUser;
  busy: boolean;
  activeIds: string[];
  onSubmit: (body: string) => Promise<void>;
  onReply: (threadId: string, body: string) => Promise<void>;
  onToggleResolved: (threadId: string, resolved: boolean) => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
  onLike: (commentId: string) => void;
  onFocusCard: (threadId: string) => void;
  onJumpToInline: () => void;
  inlineCount: number;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section className="mt-12 border-t border-gray-200 pt-6 pb-4">
      <div className="mb-4 flex items-center gap-2">
        <h3 className="text-[15px] font-semibold text-gray-900">评论</h3>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
          {threads.length}
        </span>
        <button
          onClick={onJumpToInline}
          className="ml-auto rounded-md px-2 py-1 text-[12px] text-[#3370ff] transition hover:bg-[#eaf1ff]"
        >
          划词笔记 {inlineCount} 条 →
        </button>
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="rounded-md px-2 py-1 text-[12px] text-gray-400 transition hover:bg-gray-100"
        >
          {collapsed ? "展开" : "收起"}
        </button>
      </div>

      {!collapsed && (
        <>
          <Composer
            me={me}
            placeholder="粘贴 Markdown、LaTeX 公式或输入评论…"
            onSubmit={onSubmit}
          />

          <div className="mt-4 space-y-2.5">
            {threads.length === 0 && (
              <p className="py-6 text-center text-[12px] text-gray-300">
                还没有全文评论，来说两句
              </p>
            )}
            {threads.map((thread) => (
              <ThreadCard
                key={thread.id}
                thread={thread}
                me={me}
                variant="footer"
                active={activeIds.includes(thread.id)}
                onReply={onReply}
                onToggleResolved={onToggleResolved}
                onDelete={onDelete}
                onLike={onLike}
                onFocusCard={onFocusCard}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
