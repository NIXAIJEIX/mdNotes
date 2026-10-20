"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Thread } from "@/lib/comments";
import type { LocalUser } from "@/lib/collab-provider";
import { DraftCard, ThreadCard } from "@/components/comment-thread";

export interface SidebarHandlers {
  onPublishDraft: (body: string) => Promise<void>;
  onCancelDraft: () => void;
  onReply: (threadId: string, body: string) => Promise<void>;
  onToggleResolved: (threadId: string, resolved: boolean) => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
  onLike: (commentId: string) => void;
  onLocate: (threadId: string) => void;
  onFocusCard: (threadId: string) => void;
}

const DEFAULT_WIDTH = 352;
const MIN_WIDTH = 280;
const MAX_WIDTH = 720;
const STORAGE_KEY = "collab-comment-sidebar-width";

export default function CommentSidebar({
  open,
  onClose,
  threads,
  docCommentCount,
  draft,
  activeIds,
  filter,
  onFilterChange,
  me,
  handlers,
  overlayMode = false,
  maxAllowedWidth,
}: {
  open: boolean;
  onClose: () => void;
  threads: Thread[];
  docCommentCount: number;
  draft: { quote: string } | null;
  busy?: boolean;
  activeIds: string[];
  filter: "all" | "open";
  onFilterChange: (filter: "all" | "open") => void;
  me: LocalUser;
  handlers: SidebarHandlers;
  /** 窄视口下自动转为抽屉浮层，不挤压正文编辑区 */
  overlayMode?: boolean;
  /** 父容器根据当前分辨率动态计算的上限宽度，保证正文始终保有舒适阅读宽度 */
  maxAllowedWidth?: number;
}) {
  const [preferredWidth, setPreferredWidth] = useState(DEFAULT_WIDTH);
  const [dragging, setDragging] = useState(false);
  const rafRef = useRef<number | null>(null);

  const clampWidth = useCallback(
    (value: number): number => {
      const viewportCap =
        typeof window === "undefined"
          ? MAX_WIDTH
          : Math.floor(window.innerWidth * (overlayMode ? 0.88 : 0.65));
      const dynamicCap = maxAllowedWidth
        ? Math.min(MAX_WIDTH, maxAllowedWidth, viewportCap)
        : Math.min(MAX_WIDTH, viewportCap);
      const effectiveMax = Math.max(MIN_WIDTH, dynamicCap);
      return Math.min(Math.max(Math.round(value), MIN_WIDTH), effectiveMax);
    },
    [maxAllowedWidth, overlayMode],
  );

  useEffect(() => {
    const saved = Number(window.localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(saved) && saved > 0) {
      setPreferredWidth(clampWidth(saved));
    }
  }, [clampWidth]);

  const effectiveWidth = clampWidth(preferredWidth);

  useEffect(() => {
    if (!dragging) return;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    let latestX = 0;
    const onMove = (event: PointerEvent) => {
      latestX = event.clientX;
      if (rafRef.current !== null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        setPreferredWidth(clampWidth(window.innerWidth - latestX));
      });
    };

    const onUp = () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setDragging(false);
      setPreferredWidth((current) => {
        const next = clampWidth(current);
        window.localStorage.setItem(STORAGE_KEY, String(next));
        return next;
      });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onUp, { once: true });
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [clampWidth, dragging]);

  if (!open) return null;

  const shown =
    filter === "open" ? threads.filter((thread) => !thread.resolved) : threads;
  const openCount = threads.filter((thread) => !thread.resolved).length;

  const panel = (
    <aside
      aria-label="评论侧栏"
      style={{ width: effectiveWidth }}
      className={`flex shrink-0 flex-col border-l border-gray-200 bg-[#fafbfc] ${
        dragging ? "transition-none" : "transition-[width] duration-150 ease-out"
      } ${
        overlayMode
          ? "fixed inset-y-0 right-0 z-30 h-full shadow-[0_8px_32px_rgba(15,23,42,0.16)]"
          : "relative h-full"
      }`}
    >
      {/* 左边缘拖拽手柄；双击恢复默认宽度 */}
      <div
        role="separator"
        aria-label="调整评论侧栏宽度"
        aria-orientation="vertical"
        title="拖动调整宽度，双击恢复默认"
        onPointerDown={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDoubleClick={() => {
          const reset = clampWidth(DEFAULT_WIDTH);
          setPreferredWidth(reset);
          window.localStorage.setItem(STORAGE_KEY, String(DEFAULT_WIDTH));
        }}
        className={`absolute top-0 bottom-0 left-[-4px] z-20 w-2 cursor-col-resize transition-colors ${
          dragging ? "bg-[#3370ff]/30" : "hover:bg-[#3370ff]/15"
        }`}
      />

      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-gray-200 px-4">
        <h2 className="text-[14px] font-semibold text-gray-900">评论</h2>
        <span className="rounded-full bg-[#eaf1ff] px-2 py-0.5 text-[11px] font-medium text-[#3370ff]">
          {threads.length}
        </span>
        {openCount > 0 && (
          <span className="text-[11px] text-gray-400">{openCount} 条待解决</span>
        )}
        <span className="ml-auto font-mono text-[10px] text-gray-300">
          {effectiveWidth}px
        </span>
        <button
          onClick={onClose}
          title="收起评论面板"
          className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-200/60 hover:text-gray-600"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>

      <div className="flex shrink-0 items-center gap-1 border-b border-gray-200 px-4 py-2">
        {(
          [
            { key: "all", label: `划词笔记 ${threads.length}` },
            { key: "open", label: `未解决 ${openCount}` },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            onClick={() => onFilterChange(tab.key)}
            className={`rounded-md px-2.5 py-1 text-[12px] transition ${
              filter === tab.key
                ? "bg-white text-[#3370ff] shadow-sm ring-1 ring-gray-200"
                : "text-gray-500 hover:bg-gray-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
        {draft && (
          <DraftCard
            quote={draft.quote}
            me={me}
            onPublish={handlers.onPublishDraft}
            onCancel={handlers.onCancelDraft}
          />
        )}

        {shown.length === 0 && !draft && (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <span className="text-3xl">💬</span>
            <p className="text-[13px] text-gray-400">
              {filter === "open" ? "没有待解决的评论" : "还没有划词笔记"}
            </p>
            <p className="text-[12px] leading-5 text-gray-300">
              选中正文任意一句话，点击浮现的「评论」按钮
            </p>
          </div>
        )}

        {shown.map((thread) => (
          <ThreadCard
            key={thread.id}
            thread={thread}
            me={me}
            variant="sidebar"
            active={activeIds.includes(thread.id)}
            onReply={handlers.onReply}
            onToggleResolved={handlers.onToggleResolved}
            onDelete={handlers.onDelete}
            onLike={handlers.onLike}
            onLocate={handlers.onLocate}
            onFocusCard={handlers.onFocusCard}
          />
        ))}
      </div>

      <footer className="shrink-0 border-t border-gray-200 px-4 py-2.5 text-[11px] leading-4 text-gray-400">
        文末还有 {docCommentCount} 条全文评论
      </footer>
    </aside>
  );

  if (!overlayMode) return panel;

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-20 bg-black/15 backdrop-blur-[1px]"
      />
      {panel}
    </>
  );
}
