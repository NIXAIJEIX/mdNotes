"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  buildDocTree,
  collectSubtreeIds,
  getBreadcrumbs,
  type DocMeta,
  type DocTreeNode,
  type OutlineItem,
} from "@/lib/kb-tree";

const DEFAULT_WIDTH = 268;
const MIN_WIDTH = 220;
const MAX_WIDTH = 420;
const STORAGE_KEY = "collab-kb-sidebar-width";

export type LeftPanelMode = "split" | "kb" | "toc";

export default function KbOutlineSidebar({
  open,
  onClose,
  docs,
  currentDocId,
  headings,
  activeHeadingIndex,
  onJumpToHeading,
  onInsertSampleOutline,
  onDocsChange,
  onRenameCurrentDoc,
  mode,
  onModeChange,
  overlayMode = false,
  maxAllowedWidth,
}: {
  open: boolean;
  onClose: () => void;
  docs: DocMeta[];
  currentDocId: string;
  headings: OutlineItem[];
  activeHeadingIndex: number;
  onJumpToHeading: (item: OutlineItem) => void;
  onInsertSampleOutline?: () => void;
  onDocsChange: () => Promise<void> | void;
  onRenameCurrentDoc?: (title: string) => void;
  mode: LeftPanelMode;
  onModeChange: (mode: LeftPanelMode) => void;
  overlayMode?: boolean;
  maxAllowedWidth?: number;
}) {
  const router = useRouter();
  const [preferredWidth, setPreferredWidth] = useState(DEFAULT_WIDTH);
  const [dragging, setDragging] = useState(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [creatingParentId, setCreatingParentId] = useState<
    string | "root" | null
  >(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [movingId, setMovingId] = useState<string | null>(null);
  const rafRef = useRef<number | null>(null);

  const clampWidth = useCallback(
    (value: number): number => {
      const viewportCap =
        typeof window === "undefined"
          ? MAX_WIDTH
          : Math.floor(window.innerWidth * (overlayMode ? 0.84 : 0.4));
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

  // 自动展开当前文档的所有祖先节点
  useEffect(() => {
    if (!currentDocId || docs.length === 0) return;
    const crumbs = getBreadcrumbs(docs, currentDocId);
    if (crumbs.length <= 1) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const item of crumbs.slice(0, -1)) {
        if (!next.has(item.id)) {
          next.add(item.id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [currentDocId, docs]);

  const effectiveWidth = clampWidth(preferredWidth);

  useEffect(() => {
    if (!dragging) return;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    let latestX = 0;
    const onMove = (event: PointerEvent) => {
      latestX = event.clientX;
      if (rafRef.current !== null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        setPreferredWidth(clampWidth(latestX));
      });
    };

    const onUp = () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setDragging(false);
      setPreferredWidth((curr) => {
        const next = clampWidth(curr);
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
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [clampWidth, dragging]);

  const tree = useMemo(() => buildDocTree(docs), [docs]);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const createDoc = useCallback(
    async (parentId: string | null) => {
      if (creatingParentId !== null) return;
      setCreatingParentId(parentId ?? "root");
      try {
        const res = await fetch("/api/docs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: parentId ? "新建子文档" : "无标题文档",
            parentId,
          }),
        });
        if (!res.ok) return;
        const json = (await res.json()) as { doc: DocMeta };
        if (parentId) {
          setExpanded((prev) => new Set(prev).add(parentId));
        }
        await onDocsChange();
        router.push(`/doc/${json.doc.id}`);
        if (overlayMode) onClose();
      } finally {
        setCreatingParentId(null);
      }
    },
    [creatingParentId, onClose, onDocsChange, overlayMode, router],
  );

  const submitRename = useCallback(
    async (id: string) => {
      const title = renameVal.trim() || "无标题文档";
      setRenamingId(null);
      await fetch(`/api/docs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      }).catch(() => undefined);
      if (id === currentDocId) {
        onRenameCurrentDoc?.(title);
      }
      await onDocsChange();
    },
    [currentDocId, onDocsChange, onRenameCurrentDoc, renameVal],
  );

  const moveDoc = useCallback(
    async (id: string, newParentId: string | null) => {
      setMovingId(null);
      await fetch(`/api/docs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: newParentId }),
      }).catch(() => undefined);
      if (newParentId) {
        setExpanded((prev) => new Set(prev).add(newParentId));
      }
      await onDocsChange();
    },
    [onDocsChange],
  );

  const deleteDoc = useCallback(
    async (id: string, hasChildren: boolean) => {
      const msg = hasChildren
        ? "确定删除该文档及其所有子文档？此操作不可恢复。"
        : "确定删除该文档？此操作不可恢复。";
      if (!confirm(msg)) return;
      await fetch(`/api/docs/${id}`, { method: "DELETE" }).catch(
        () => undefined,
      );
      await onDocsChange();
      if (id === currentDocId) {
        router.push("/");
      }
    },
    [currentDocId, onDocsChange, router],
  );

  // 搜索过滤：命中节点或其祖先保留
  const filteredIds = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    const keep = new Set<string>();
    const byId = new Map(docs.map((d) => [d.id, d]));
    for (const d of docs) {
      if ((d.title || "无标题文档").toLowerCase().includes(q)) {
        let cur: DocMeta | undefined = d;
        const guard = new Set<string>();
        while (cur && !guard.has(cur.id)) {
          guard.add(cur.id);
          keep.add(cur.id);
          cur = cur.parentId ? byId.get(cur.parentId) : undefined;
        }
      }
    }
    return keep;
  }, [docs, search]);

  if (!open) return null;

  const renderTreeNodes = (nodes: DocTreeNode[]): React.ReactNode => {
    return nodes.map((node) => {
      if (filteredIds && !filteredIds.has(node.id)) return null;
      const hasChildren = node.children.length > 0;
      const isExpanded = Boolean(search.trim()) || expanded.has(node.id);
      const isCurrent = node.id === currentDocId;
      const isMoving = movingId === node.id;
      const invalidTargets = isMoving
        ? collectSubtreeIds(docs, node.id)
        : new Set<string>();

      return (
        <div key={node.id} data-kb-node={node.id}>
          <div
            style={{ paddingLeft: `${8 + Math.min(node.depth, 6) * 14}px` }}
            onClick={() => {
              if (renamingId === node.id) return;
              router.push(`/doc/${node.id}`);
              if (overlayMode) onClose();
            }}
            onMouseEnter={() => router.prefetch(`/doc/${node.id}`)}
            className={`group flex min-h-[30px] cursor-pointer items-center gap-1 rounded-md pr-1.5 py-1 text-[13px] transition ${
              isCurrent
                ? "bg-[#eaf1ff] font-medium text-[#3370ff]"
                : "text-gray-700 hover:bg-gray-100/90"
            }`}
          >
            {/* 展开/收起箭头 */}
            <button
              type="button"
              aria-label={
                hasChildren ? (isExpanded ? "折叠子文档" : "展开子文档") : "文档节点"
              }
              onClick={(e) => {
                e.stopPropagation();
                if (hasChildren) toggleExpand(node.id);
              }}
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] transition ${
                hasChildren
                  ? "text-gray-400 hover:bg-gray-200/70 hover:text-gray-700"
                  : "pointer-events-none opacity-0"
              }`}
            >
              <span
                className={`inline-block transition-transform duration-150 ${
                  isExpanded ? "rotate-90" : ""
                }`}
              >
                ▸
              </span>
            </button>

            {/* 图标 */}
            <span className="shrink-0 text-[12px] leading-none">
              {hasChildren ? (isExpanded ? "📂" : "📁") : "📄"}
            </span>

            {/* 标题 / 内联重命名 */}
            {renamingId === node.id ? (
              <input
                autoFocus
                value={renameVal}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setRenameVal(e.target.value)}
                onBlur={() => void submitRename(node.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitRename(node.id);
                  if (e.key === "Escape") setRenamingId(null);
                }}
                className="min-w-0 flex-1 rounded border border-[#3370ff] bg-white px-1.5 py-0.5 text-[12px] text-gray-800 outline-none"
              />
            ) : (
              <span className="min-w-0 flex-1 truncate">
                {node.title || "无标题文档"}
              </span>
            )}

            {/* 折叠时显示子文档数 */}
            {hasChildren && !isExpanded && (
              <span className="rounded bg-gray-200/70 px-1 text-[10px] text-gray-500 group-hover:hidden">
                {node.children.length}
              </span>
            )}

            {/* 节点悬浮操作：新建子文档 / 重命名 / 移动层级 / 删除 */}
            <div
              onClick={(e) => e.stopPropagation()}
              className="hidden shrink-0 items-center gap-0.5 group-hover:flex"
            >
              <button
                type="button"
                title="新建子文档"
                onClick={() => void createDoc(node.id)}
                className="flex h-5 w-5 items-center justify-center rounded text-[12px] text-gray-500 hover:bg-white hover:text-[#3370ff]"
              >
                ＋
              </button>
              <button
                type="button"
                title="重命名"
                onClick={() => {
                  setRenamingId(node.id);
                  setRenameVal(node.title || "无标题文档");
                }}
                className="flex h-5 w-5 items-center justify-center rounded text-[11px] text-gray-500 hover:bg-white hover:text-[#3370ff]"
              >
                ✎
              </button>
              <button
                type="button"
                title="移动所属父文档"
                onClick={() =>
                  setMovingId((cur) => (cur === node.id ? null : node.id))
                }
                className="flex h-5 w-5 items-center justify-center rounded text-[11px] text-gray-500 hover:bg-white hover:text-[#3370ff]"
              >
                ⇄
              </button>
              <button
                type="button"
                title="删除文档"
                onClick={() => void deleteDoc(node.id, hasChildren)}
                className="flex h-5 w-5 items-center justify-center rounded text-[11px] text-gray-400 hover:bg-white hover:text-red-500"
              >
                ×
              </button>
            </div>
          </div>

          {/* 移动层级选择器 */}
          {isMoving && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="my-1 ml-6 mr-2 rounded-lg border border-gray-200 bg-white p-2 text-[11px] shadow-sm"
            >
              <div className="mb-1 flex items-center justify-between text-gray-500">
                <span>移动到：</span>
                <button
                  type="button"
                  onClick={() => setMovingId(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  取消
                </button>
              </div>
              <select
                value={node.parentId ?? ""}
                onChange={(e) =>
                  void moveDoc(node.id, e.target.value || null)
                }
                className="w-full rounded border border-gray-200 px-1.5 py-1 text-[12px] text-gray-700 outline-none focus:border-[#3370ff]"
              >
                <option value="">📚 知识库根目录（顶级）</option>
                {docs
                  .filter((d) => !invalidTargets.has(d.id))
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      📄 {d.title || "无标题文档"}
                    </option>
                  ))}
              </select>
            </div>
          )}

          {hasChildren && isExpanded && (
            <div>{renderTreeNodes(node.children)}</div>
          )}
        </div>
      );
    });
  };

  const kbSection = (
    <div
      className={`flex min-h-0 flex-col ${
        mode === "split" ? "flex-1 border-b border-gray-200" : "flex-1"
      }`}
    >
      <div className="flex shrink-0 items-center justify-between px-3 pt-2.5 pb-1.5">
        <span className="text-[11px] font-semibold tracking-wide text-gray-400">
          知识库结构 ({docs.length})
        </span>
        <button
          type="button"
          onClick={() => void createDoc(null)}
          disabled={creatingParentId !== null}
          title="在知识库根目录新建文档"
          className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-[#3370ff] transition hover:bg-[#eaf1ff] disabled:opacity-50"
        >
          <span>＋</span> 新建文档
        </button>
      </div>

      <div className="px-3 pb-1.5">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索知识库文档…"
          className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1 text-[12px] text-gray-700 outline-none transition focus:border-[#3370ff]"
        />
      </div>

      <div
        role="tree"
        aria-label="知识库文档树"
        className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2"
      >
        {tree.length === 0 ? (
          <div className="py-8 text-center text-[12px] text-gray-400">
            暂无文档，点击右上角「＋ 新建文档」
          </div>
        ) : (
          renderTreeNodes(tree)
        )}
      </div>
    </div>
  );

  const tocSection = (
    <div
      className={`flex min-h-0 flex-col ${
        mode === "split" ? "h-[44%] shrink-0" : "flex-1"
      }`}
    >
      <div className="flex shrink-0 items-center justify-between px-3 pt-2.5 pb-1.5">
        <span className="text-[11px] font-semibold tracking-wide text-gray-400">
          文档目录 ({headings.length})
        </span>
        {headings.length > 0 && (
          <span className="text-[10px] text-gray-300">点击跳转章节</span>
        )}
      </div>

      <nav
        aria-label="文档目录大纲"
        className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3"
      >
        {headings.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-6 text-center">
            <p className="text-[12px] leading-5 text-gray-400">
              在正文中使用 H1 / H2 / H3 标题，此处会实时生成文档目录
            </p>
            {onInsertSampleOutline && (
              <button
                type="button"
                onClick={onInsertSampleOutline}
                className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-[11px] text-[#3370ff] transition hover:border-[#3370ff] hover:bg-[#f0f4ff]"
              >
                ＋ 插入章节目录模板
              </button>
            )}
          </div>
        ) : (
          headings.map((item) => {
            const isActive = item.index === activeHeadingIndex;
            const indent =
              item.level === 1
                ? "pl-2.5 font-medium"
                : item.level === 2
                  ? "pl-6"
                  : "pl-9 text-[12px]";
            return (
              <button
                key={item.id}
                type="button"
                data-toc-item={item.index}
                onClick={() => {
                  onJumpToHeading(item);
                  if (overlayMode) onClose();
                }}
                className={`group flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-[13px] transition ${indent} ${
                  isActive
                    ? "bg-[#eaf1ff] text-[#3370ff]"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    isActive
                      ? "bg-[#3370ff]"
                      : "bg-gray-300 group-hover:bg-gray-400"
                  }`}
                />
                <span className="min-w-0 flex-1 truncate">{item.text}</span>
                <span className="shrink-0 font-mono text-[10px] text-gray-300">
                  H{item.level}
                </span>
              </button>
            );
          })
        )}
      </nav>
    </div>
  );

  const panel = (
    <aside
      aria-label="知识库与目录侧栏"
      style={{ width: effectiveWidth }}
      className={`flex shrink-0 flex-col border-r border-gray-200 bg-[#fafbfc] ${
        dragging ? "transition-none" : "transition-[width] duration-150 ease-out"
      } ${
        overlayMode
          ? "fixed inset-y-0 left-0 z-30 h-full shadow-[0_8px_32px_rgba(15,23,42,0.16)]"
          : "relative h-full"
      }`}
    >
      {/* 右边缘拖拽手柄；双击恢复默认宽度 */}
      <div
        role="separator"
        aria-label="调整知识库侧栏宽度"
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
        className={`absolute top-0 right-[-4px] bottom-0 z-20 w-2 cursor-col-resize transition-colors ${
          dragging ? "bg-[#3370ff]/30" : "hover:bg-[#3370ff]/15"
        }`}
      />

      {/* 顶部模式切换栏 */}
      <div className="flex h-[44px] shrink-0 items-center gap-1 border-b border-gray-200 px-3">
        <div className="flex rounded-lg bg-gray-200/60 p-0.5 text-[11px]">
          {(
            [
              { key: "split", label: "同屏" },
              { key: "kb", label: "知识库" },
              { key: "toc", label: "目录" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onModeChange(tab.key)}
              className={`rounded-md px-2 py-1 transition ${
                mode === tab.key
                  ? "bg-white font-medium text-[#3370ff] shadow-xs"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <span className="ml-auto font-mono text-[10px] text-gray-300">
          {effectiveWidth}px
        </span>
        <button
          type="button"
          onClick={onClose}
          title="收起左侧栏 (⌘/Ctrl + \)"
          className="flex h-6 w-6 items-center justify-center rounded text-gray-400 transition hover:bg-gray-200/60 hover:text-gray-700"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path
              d="M10 3 5 8l5 5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {mode === "split" && (
        <>
          {kbSection}
          {tocSection}
        </>
      )}
      {mode === "kb" && kbSection}
      {mode === "toc" && tocSection}
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
