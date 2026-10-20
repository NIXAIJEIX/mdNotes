"use client";

import { useState } from "react";
import type { CommentRow, Thread } from "@/lib/comments";
import { timeAgo } from "@/lib/comments";
import type { LocalUser } from "@/lib/collab-provider";
import CommentComposer from "@/components/comment-composer";
import { MarkdownView } from "@/components/markdown-view";

export function Avatar({
  name,
  color,
  size = 24,
}: {
  name: string;
  color: string;
  size?: number;
}) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-medium text-white"
      style={{
        backgroundColor: color,
        width: size,
        height: size,
        fontSize: size * 0.42,
      }}
    >
      {name.slice(-2)}
    </span>
  );
}

export function LikeButton({
  row,
  onLike,
  compact,
}: {
  row: CommentRow;
  onLike: (commentId: string) => void;
  compact?: boolean;
}) {
  return (
    <button
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.stopPropagation();
        onLike(row.id);
      }}
      title={row.likedByMe ? "取消点赞" : "点赞"}
      className={`flex items-center gap-1 rounded-md transition ${
        compact ? "px-1 py-0.5 text-[11px]" : "px-2 py-1 text-[12px]"
      } ${
        row.likedByMe
          ? "bg-[#eaf1ff] text-[#3370ff]"
          : "text-gray-400 hover:bg-gray-100 hover:text-[#3370ff]"
      }`}
    >
      <span>👍</span>
      {row.likeCount > 0 && <span>{row.likeCount}</span>}
    </button>
  );
}

function CommentItem({
  row,
  me,
  onDelete,
  onLike,
}: {
  row: CommentRow;
  me: LocalUser;
  onDelete: (id: string) => void;
  onLike: (id: string) => void;
}) {
  return (
    <div className="group/item flex gap-2 py-1.5">
      <Avatar name={row.authorName} color={row.authorColor} />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[12px] font-medium text-gray-800">
            {row.authorName}
            {row.authorId === me.clientId && (
              <span className="ml-1 text-[10px] text-gray-300">我</span>
            )}
          </span>
          <span className="text-[11px] text-gray-300">
            {timeAgo(row.createdAt)}
          </span>
          {row.authorId === me.clientId && (
            <button
              onClick={() => onDelete(row.id)}
              className="ml-auto hidden text-[11px] text-gray-300 transition hover:text-red-500 group-hover/item:block"
            >
              删除
            </button>
          )}
        </div>

        <MarkdownView content={row.body} />

        <div className="mt-0.5 flex items-center">
          <LikeButton row={row} onLike={onLike} compact />
        </div>
      </div>
    </div>
  );
}

export function ThreadCard({
  thread,
  me,
  active,
  variant,
  onReply,
  onToggleResolved,
  onDelete,
  onLike,
  onLocate,
  onFocusCard,
}: {
  thread: Thread;
  me: LocalUser;
  active?: boolean;
  variant: "sidebar" | "footer";
  onReply: (threadId: string, body: string) => Promise<void>;
  onToggleResolved: (threadId: string, resolved: boolean) => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
  onLike: (commentId: string) => void;
  onLocate?: (threadId: string) => void;
  onFocusCard?: (threadId: string) => void;
}) {
  const [replying, setReplying] = useState(false);
  const root = thread.items[0];
  const replies = thread.items.slice(1);

  return (
    <article
      data-thread-card={thread.id}
      onMouseEnter={() => onFocusCard?.(thread.id)}
      className={`rounded-xl border bg-white transition ${
        active
          ? "border-[#3370ff] shadow-[0_2px_10px_rgba(51,112,255,0.10)]"
          : "border-gray-200 hover:border-gray-300"
      } ${thread.resolved ? "opacity-60" : ""} ${
        variant === "sidebar" ? "p-3" : "p-4"
      }`}
    >
      {thread.kind === "inline" && thread.quote && (
        <button
          onClick={() => onLocate?.(thread.id)}
          title="点击定位到原文"
          className="mb-2 block w-full border-l-2 border-gray-300 px-2 text-left text-[12px] leading-5 text-gray-500 transition hover:border-[#3370ff]"
        >
          <span className="line-clamp-2">{thread.quote}</span>
        </button>
      )}

      <div className="divide-y divide-gray-50">
        <CommentItem
          row={root}
          me={me}
          onDelete={(id) => void onDelete(id)}
          onLike={onLike}
        />
        {replies.map((row) => (
          <div key={row.id} className="pl-1">
            <CommentItem
              row={row}
              me={me}
              onDelete={(id) => void onDelete(id)}
              onLike={onLike}
            />
          </div>
        ))}
      </div>

      {replying ? (
        <CommentComposer
          autoFocus
          placeholder={`回复 ${root.authorName}…`}
          onCancel={() => setReplying(false)}
          onSubmit={async (body) => {
            await onReply(thread.id, body);
            setReplying(false);
          }}
        />
      ) : (
        <div className="mt-2 flex items-center gap-1 border-t border-gray-50 pt-2">
          <button
            onClick={() => setReplying(true)}
            className="rounded-md px-2 py-1 text-[12px] text-gray-500 transition hover:bg-gray-100 hover:text-[#3370ff]"
          >
            回复
          </button>
          <button
            onClick={() => void onToggleResolved(thread.id, !thread.resolved)}
            className="rounded-md px-2 py-1 text-[12px] text-gray-500 transition hover:bg-gray-100 hover:text-emerald-600"
          >
            {thread.resolved ? "重新打开" : "标记已解决"}
          </button>
          {thread.kind === "inline" && onLocate && (
            <button
              onClick={() => onLocate(thread.id)}
              className="ml-auto rounded-md px-2 py-1 text-[12px] text-gray-400 transition hover:bg-gray-100 hover:text-[#3370ff]"
            >
              定位
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export function DraftCard({
  quote,
  me,
  onPublish,
  onCancel,
}: {
  quote: string;
  me: LocalUser;
  busy?: boolean;
  onPublish: (body: string) => Promise<void>;
  onCancel: () => void;
}) {
  return (
    <article className="rounded-xl border border-[#3370ff] bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11px] font-medium text-[#3370ff]">新笔记</span>
        <button
          onClick={onCancel}
          className="ml-auto text-[11px] text-gray-400 hover:text-gray-600"
        >
          取消
        </button>
      </div>
      <div className="mb-2 border-l-2 border-gray-300 px-2 text-[12px] leading-5 text-gray-500">
        <span className="line-clamp-3">{quote}</span>
      </div>
      <div className="flex gap-2">
        <Avatar name={me.name} color={me.color} />
        <div className="min-w-0 flex-1">
          <CommentComposer
            autoFocus
            placeholder="直接粘贴 Markdown、公式或图片…"
            onCancel={onCancel}
            onSubmit={onPublish}
          />
        </div>
      </div>
    </article>
  );
}

export function Composer({
  me,
  placeholder,
  onSubmit,
}: {
  me: LocalUser;
  placeholder: string;
  busy?: boolean;
  onSubmit: (body: string) => Promise<void>;
}) {
  return (
    <div className="flex gap-2.5">
      <Avatar name={me.name} color={me.color} size={28} />
      <div className="min-w-0 flex-1">
        <CommentComposer placeholder={placeholder} onSubmit={onSubmit} />
      </div>
    </div>
  );
}
