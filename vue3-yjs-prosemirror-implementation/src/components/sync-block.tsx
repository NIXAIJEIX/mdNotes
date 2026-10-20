"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import * as Y from "yjs";

/** 当前编辑器的 Y.Doc,供同步块读写共享内容 */
export const YDocContext = createContext<Y.Doc | null>(null);
export const Y_MAP_SYNC_BLOCKS = "syncBlocks";

/** 兼容非安全上下文(http 内网部署)的 uuid 生成 */
export function newSyncId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `sb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getSyncTextMap(ydoc: Y.Doc): Y.Map<Y.Text> {
  return ydoc.getMap<Y.Text>(Y_MAP_SYNC_BLOCKS);
}

/**
 * 同步块(★ 飞书同名能力)
 * 同一 syncId 的多个节点共享一份 Y.Text:在任意一处输入,
 * 其它位置(包括其它协作者窗口)实时同步;删除引用不影响共享内容。
 */
export const SyncBlock = Node.create({
  name: "syncBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      syncId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-sync-block"),
        renderHTML: (attrs) => ({ "data-sync-block": attrs.syncId as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-sync-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { class: "sync-block-static" }),
      "同步块",
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SyncBlockView);
  },
});

function commonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

/** 最小 diff 写回 Y.Text,保留 CRDT 并发合并能力 */
function writeText(ytext: Y.Text, prev: string, next: string) {
  let start = commonPrefix(prev, next);
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--;
    endNext--;
  }
  const insert = next.slice(start, endNext);
  const remove = endPrev - start;
  if (remove === 0 && !insert) return;
  ytext.doc?.transact(() => {
    if (remove > 0) ytext.delete(start, remove);
    if (insert) ytext.insert(start, insert);
  });
}

function SyncBlockView({ node, editor, getPos, deleteNode }: NodeViewProps) {
  const ydoc = useContext(YDocContext);
  const syncId = (node.attrs.syncId as string) ?? "missing";
  const map = useMemo(() => (ydoc ? getSyncTextMap(ydoc) : null), [ydoc]);
  const ytext = useMemo(() => {
    if (!map) return null;
    const existing = map.get(syncId);
    if (existing instanceof Y.Text) return existing;
    const fresh = new Y.Text();
    map.set(syncId, fresh);
    return fresh;
  }, [map, syncId]);

  const [value, setValue] = useState(() => ytext?.toString() ?? "");
  const valueRef = useRef(value);
  valueRef.current = value;
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 订阅共享文本:任何一处(或远端)修改都在这里同步
  useEffect(() => {
    if (!ytext) return;
    const update = () => {
      const next = ytext.toString();
      if (next === valueRef.current) return;
      const ta = taRef.current;
      const focused = ta && document.activeElement === ta;
      const caret = ta?.selectionStart ?? 0;
      const oldLen = valueRef.current.length;
      const prefix = commonPrefix(valueRef.current, next);
      valueRef.current = next;
      setValue(next);
      if (focused && ta) {
        requestAnimationFrame(() => {
          const pos =
            caret <= prefix
              ? caret
              : Math.max(prefix, caret + (next.length - oldLen));
          ta.setSelectionRange(Math.min(pos, next.length), Math.min(pos, next.length));
        });
      }
    };
    ytext.observe(update);
    update();
    return () => ytext.unobserve(update);
  }, [ytext]);

  // 自适应高度
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.max(40, ta.scrollHeight)}px`;
  }, [value]);

  const insertRef = () => {
    const pos = typeof getPos === "function" ? getPos() : undefined;
    const content = { type: "syncBlock", attrs: { syncId } };
    if (typeof pos === "number") {
      editor
        .chain()
        .focus()
        .insertContentAt(pos + node.nodeSize, content)
        .run();
    } else {
      editor.chain().focus().insertContent(content).run();
    }
  };

  return (
    <NodeViewWrapper className="sync-block">
      <div className="mb-1 flex select-none items-center gap-2 text-[11px] font-medium text-[#3370ff]">
        <span className="rounded bg-[#eaf1ff] px-1.5 py-0.5">⇄ 同步块</span>
        <span className="text-gray-400">任一处编辑，全部引用同步</span>
      </div>
      <textarea
        ref={taRef}
        value={value}
        placeholder="输入同步内容…"
        onChange={(e) => {
          const next = e.target.value;
          const prev = valueRef.current;
          valueRef.current = next;
          setValue(next);
          if (ytext) writeText(ytext, prev, next);
        }}
        rows={1}
        className="w-full resize-none bg-transparent text-[15px] leading-7 text-[#1f2329] outline-none placeholder:text-gray-300"
      />
      <div className="mt-1 flex select-none items-center gap-2 text-[11px] text-gray-400">
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={insertRef}
          className="rounded px-1.5 py-0.5 transition hover:bg-[#eaf1ff] hover:text-[#3370ff]"
        >
          插入引用
        </button>
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => deleteNode()}
          className="rounded px-1.5 py-0.5 transition hover:bg-red-50 hover:text-red-500"
        >
          删除此引用
        </button>
        <span className="ml-auto font-mono text-[10px] text-gray-300">
          #{syncId.slice(0, 8)}
        </span>
      </div>
    </NodeViewWrapper>
  );
}
