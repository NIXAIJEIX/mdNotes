"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  buildDocTree,
  getBreadcrumbs,
  type DocMeta,
  type DocTreeNode,
} from "@/lib/kb-tree";

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000 && d.getDate() === now.getDate()) {
    return `今天 ${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes(),
    ).padStart(2, "0")}`;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function HomePage() {
  const router = useRouter();
  const [docs, setDocs] = useState<DocMeta[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/docs", { cache: "no-store" });
      const json = (await res.json()) as { docs: DocMeta[] };
      setDocs(json.docs);
      // 默认展开所有含有子文档的父节点
      const parentIds = new Set<string>();
      for (const d of json.docs) {
        if (d.parentId) parentIds.add(d.parentId);
      }
      if (parentIds.size > 0) {
        setExpanded((prev) => {
          const next = new Set(prev);
          parentIds.forEach((id) => next.add(id));
          return next;
        });
      }
      // 预取前几篇文档的 RSC 负载,点击即开
      json.docs.slice(0, 4).forEach((d) => router.prefetch(`/doc/${d.id}`));
    } catch {
      setDocs([]);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const createDoc = async (parentId: string | null = null) => {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: parentId ? "新建子文档" : "无标题文档",
          parentId,
        }),
      });
      const json = (await res.json()) as { doc: DocMeta };
      router.push(`/doc/${json.doc.id}`);
    } catch {
      setCreating(false);
    }
  };

  const deleteDoc = async (id: string, hasChildren: boolean) => {
    const msg = hasChildren
      ? "确定删除该文档及其所有子文档？此操作不可恢复。"
      : "确定删除该文档？此操作不可恢复。";
    if (!confirm(msg)) return;
    await fetch(`/api/docs/${id}`, { method: "DELETE" }).catch(() => undefined);
    void load();
  };

  const submitRename = async (id: string) => {
    setRenaming(null);
    await fetch(`/api/docs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: renameValue }),
    }).catch(() => undefined);
    void load();
  };

  const tree = useMemo(() => buildDocTree(docs ?? []), [docs]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderMainTreeRows = (nodes: DocTreeNode[]): React.ReactNode => {
    const q = search.trim().toLowerCase();
    return nodes.map((node) => {
      const hasChildren = node.children.length > 0;
      const isExpanded = Boolean(q) || expanded.has(node.id);
      const matchesSearch =
        !q || (node.title || "无标题文档").toLowerCase().includes(q);
      const crumbs = docs ? getBreadcrumbs(docs, node.id).slice(0, -1) : [];

      return (
        <div key={node.id}>
          {matchesSearch && (
            <div
              style={{ paddingLeft: `${20 + Math.min(node.depth, 5) * 24}px` }}
              onClick={() => router.push(`/doc/${node.id}`)}
              onMouseEnter={() => router.prefetch(`/doc/${node.id}`)}
              className="group flex cursor-pointer items-center gap-3 pr-5 py-3 transition hover:bg-[#f8faff]"
            >
              <button
                type="button"
                aria-label={hasChildren ? "展开或折叠子文档" : "文档节点"}
                onClick={(e) => {
                  e.stopPropagation();
                  if (hasChildren) toggleExpand(node.id);
                }}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs transition ${
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

              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#eaf1ff]">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M3 2.5A1.5 1.5 0 0 1 4.5 1h5L13 4.5v9A1.5 1.5 0 0 1 11.5 15h-7A1.5 1.5 0 0 1 3 13.5v-11Z"
                    fill="#3370ff"
                  />
                  <path
                    d="M5.5 8h5M5.5 10.5h5M5.5 5.5h2"
                    stroke="#fff"
                    strokeLinecap="round"
                  />
                </svg>
              </span>

              <div className="min-w-0 flex-1">
                {renaming === node.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => void submitRename(node.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void submitRename(node.id);
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    className="w-full rounded border border-[#3370ff] px-2 py-0.5 text-sm outline-none"
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-gray-800">
                      {node.title || "无标题文档"}
                    </p>
                    {hasChildren && (
                      <span className="shrink-0 rounded bg-[#f0f4ff] px-1.5 py-0.5 text-[10px] font-medium text-[#3370ff]">
                        {node.children.length} 篇子文档
                      </span>
                    )}
                  </div>
                )}
                <p className="mt-0.5 truncate text-xs text-gray-400">
                  {crumbs.length > 0 && (
                    <span className="mr-2 text-gray-400">
                      路径：{crumbs.map((c) => c.title).join(" / ")}
                    </span>
                  )}
                  最近更新 {formatTime(node.updatedAt)}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                <button
                  type="button"
                  title="在此文档下新建子文档"
                  onClick={(e) => {
                    e.stopPropagation();
                    void createDoc(node.id);
                  }}
                  className="rounded-md px-2 py-1 text-xs text-[#3370ff] hover:bg-[#eaf1ff]"
                >
                  ＋ 子文档
                </button>
                <button
                  type="button"
                  title="重命名"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRenaming(node.id);
                    setRenameValue(node.title);
                  }}
                  className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
                >
                  重命名
                </button>
                <button
                  type="button"
                  title="删除"
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteDoc(node.id, hasChildren);
                  }}
                  className="rounded-md px-2 py-1 text-xs text-red-500 hover:bg-red-50"
                >
                  删除
                </button>
              </div>
            </div>
          )}

          {hasChildren && isExpanded && (
            <div className="divide-y divide-gray-50">
              {renderMainTreeRows(node.children)}
            </div>
          )}
        </div>
      );
    });
  };

  const sidebarContent = (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-gray-200 bg-white">
      <div className="flex items-center gap-2 px-5 py-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#3370ff]">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M3 2.5A1.5 1.5 0 0 1 4.5 1h5L13 4.5v9A1.5 1.5 0 0 1 11.5 15h-7A1.5 1.5 0 0 1 3 13.5v-11Z"
              fill="#fff"
            />
            <path
              d="M5.5 8h5M5.5 10.5h5M5.5 5.5h2"
              stroke="#3370ff"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <span className="text-[15px] font-semibold text-gray-900">
          飞书云文档 · 知识库
        </span>
      </div>

      <div className="px-4 pb-3">
        <button
          type="button"
          onClick={() => void createDoc(null)}
          disabled={creating}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#3370ff] py-2 text-sm font-medium text-white transition hover:bg-[#2b5fe0] disabled:opacity-60"
        >
          <span className="text-base leading-none">＋</span>
          {creating ? "创建中…" : "新建知识库文档"}
        </button>
      </div>

      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 rounded-lg bg-[#f0f4ff] px-3 py-2 text-sm font-medium text-[#3370ff]">
          <span>📚</span> 知识库目录树
        </div>
      </div>

      {/* 左侧知识库快捷树 */}
      <div className="flex-1 overflow-y-auto px-3 py-1 text-[13px]">
        {tree.map((root) => (
          <div key={root.id} className="mb-0.5">
            <div
              onClick={() => router.push(`/doc/${root.id}`)}
              className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-gray-700 transition hover:bg-gray-100"
            >
              <span className="text-xs">
                {root.children.length > 0 ? "📂" : "📄"}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {root.title || "无标题文档"}
              </span>
              <button
                type="button"
                title="新建子文档"
                onClick={(e) => {
                  e.stopPropagation();
                  void createDoc(root.id);
                }}
                className="rounded px-1 text-xs text-gray-400 hover:bg-white hover:text-[#3370ff]"
              >
                ＋
              </button>
            </div>
            {root.children.length > 0 && (
              <div className="ml-4 border-l border-gray-100 pl-2">
                {root.children.map((child) => (
                  <div
                    key={child.id}
                    onClick={() => router.push(`/doc/${child.id}`)}
                    className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-gray-600 transition hover:bg-gray-100"
                  >
                    <span>📄</span>
                    <span className="min-w-0 flex-1 truncate">
                      {child.title || "无标题文档"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="border-t border-gray-100 px-5 py-3.5 text-xs leading-5 text-gray-400">
        Yjs + ProseMirror 协同内核
        <br />
        知识库树 + 实时大纲 · 单租户独立部署
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#f5f6f7]">
      {/* 桌面端固定侧边栏 */}
      <div className="hidden md:block">{sidebarContent}</div>

      {/* 移动端/窄屏抽屉侧边栏 */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-30 flex md:hidden">
          <div
            className="fixed inset-0 bg-black/20"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="relative z-10 h-full">{sidebarContent}</div>
        </div>
      )}

      {/* 主区域 */}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8 sm:py-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 md:hidden"
                aria-label="打开知识库菜单"
              >
                ☰
              </button>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">
                  企业知识库
                </h1>
                <p className="mt-0.5 text-xs text-gray-400 sm:text-sm">
                  支持多级父子文档树、H1–H3 实时章节目录与多人协同编辑
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索文档…"
                className="w-44 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm outline-none transition focus:border-[#3370ff] sm:w-56"
              />
              <button
                type="button"
                onClick={() => void createDoc(null)}
                disabled={creating}
                className="rounded-lg bg-[#3370ff] px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-[#2b5fe0] disabled:opacity-60"
              >
                ＋ 新建文档
              </button>
            </div>
          </div>

          <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white">
            {docs === null ? (
              <div className="flex items-center justify-center gap-3 py-16 text-sm text-gray-400">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#3370ff] border-t-transparent" />
                加载中…
              </div>
            ) : docs.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-16">
                <span className="text-4xl">📚</span>
                <p className="text-sm text-gray-400">
                  还没有文档，点击「新建文档」构建你的知识库
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {renderMainTreeRows(tree)}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
