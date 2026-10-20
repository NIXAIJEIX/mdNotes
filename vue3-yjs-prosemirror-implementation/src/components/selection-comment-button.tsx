"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";

interface FloatPos {
  x: number;
  y: number;
  from: number;
  to: number;
  chars: number;
}

/**
 * 选中文字后浮现的「评论」按钮(飞书交互)。
 * 独立组件持有自身状态,避免每次移动光标都重渲染整个编辑器外壳。
 */
export default function SelectionCommentButton({
  editor,
  onComment,
  disabled,
}: {
  editor: Editor | null;
  onComment: (from: number, to: number) => void;
  disabled?: boolean;
}) {
  const [pos, setPos] = useState<FloatPos | null>(null);

  useEffect(() => {
    if (!editor) return;

    const update = () => {
      const { from, to, empty } = editor.state.selection;
      if (empty || from === to) {
        setPos(null);
        return;
      }
      // 选区跨节点时 coordsAtPos 可能抛错,兜底到末尾
      let rect: { top: number; right: number };
      try {
        rect = editor.view.coordsAtPos(to);
      } catch {
        setPos(null);
        return;
      }
      const width = 132;
      const x = Math.min(
        Math.max(12, rect.right + 10),
        window.innerWidth - width - 12,
      );
      setPos({
        x,
        y: Math.max(12, rect.top - 4),
        from,
        to,
        chars: to - from,
      });
    };

    const hide = () => setPos(null);
    editor.on("selectionUpdate", update);
    editor.on("blur", hide);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("blur", hide);
    };
  }, [editor]);

  useEffect(() => {
    if (disabled) setPos(null);
  }, [disabled]);

  if (!pos) return null;

  return (
    <div
      className="fixed z-50 flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-1.5 py-1 shadow-lg"
      style={{ left: pos.x, top: pos.y }}
    >
      <button
        // 阻止默认行为,保住当前选区
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          const { from, to } = pos;
          setPos(null);
          onComment(from, to);
        }}
        className="flex items-center gap-1.5 rounded-md bg-[#3370ff] px-2.5 py-1 text-[12px] font-medium text-white transition hover:bg-[#2b5fe0]"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path
            d="M2.5 3.5A1.5 1.5 0 0 1 4 2h8a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 12 11H6.5L3 13.8V11h-.5A1.5 1.5 0 0 1 1 9.5v-6Z"
            fill="currentColor"
          />
        </svg>
        评论
      </button>
      <span className="px-1 text-[11px] text-gray-300">
        {pos.chars > 120 ? "长选区" : `${pos.chars} 字符`}
      </span>
    </div>
  );
}
