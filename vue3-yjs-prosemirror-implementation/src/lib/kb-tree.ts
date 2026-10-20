import type { Editor } from "@tiptap/react";

export interface DocMeta {
  id: string;
  parentId: string | null;
  sortOrder: number;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocTreeNode extends DocMeta {
  depth: number;
  children: DocTreeNode[];
}

export interface OutlineItem {
  id: string;
  level: 1 | 2 | 3;
  text: string;
  pos: number;
  index: number;
}

/**
 * 将扁平文档列表构建为飞书知识库树形结构。
 * 若父节点不存在或存在异常环路，自动兜底挂载到根级，保证树渲染稳定。
 */
export function buildDocTree(docs: DocMeta[]): DocTreeNode[] {
  const sorted = [...docs].sort((a, b) => {
    if ((a.sortOrder ?? 0) !== (b.sortOrder ?? 0)) {
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    }
    return a.createdAt.localeCompare(b.createdAt);
  });

  const map = new Map<string, DocTreeNode>();
  for (const doc of sorted) {
    map.set(doc.id, { ...doc, depth: 0, children: [] });
  }

  const roots: DocTreeNode[] = [];
  for (const node of map.values()) {
    if (node.parentId && node.parentId !== node.id && map.has(node.parentId)) {
      // 环路保护
      let cursor: string | null = node.parentId;
      let cycle = false;
      const visited = new Set<string>([node.id]);
      while (cursor) {
        if (visited.has(cursor)) {
          cycle = true;
          break;
        }
        visited.add(cursor);
        cursor = map.get(cursor)?.parentId ?? null;
      }
      if (!cycle) {
        map.get(node.parentId)!.children.push(node);
        continue;
      }
    }
    roots.push(node);
  }

  const assignDepth = (nodes: DocTreeNode[], depth: number) => {
    for (const n of nodes) {
      n.depth = depth;
      if (n.children.length > 0) assignDepth(n.children, depth + 1);
    }
  };
  assignDepth(roots, 0);

  return roots;
}

/**
 * 计算某篇文档在知识库中的完整面包屑路径：[根文档, ..., 父文档, 当前文档]
 */
export function getBreadcrumbs(docs: DocMeta[], docId: string): DocMeta[] {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const chain: DocMeta[] = [];
  const seen = new Set<string>();
  let cursor = byId.get(docId) ?? null;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.unshift(cursor);
    cursor = cursor.parentId ? (byId.get(cursor.parentId) ?? null) : null;
  }
  return chain;
}

/**
 * 获取某个节点的全部子孙节点 ID（含自身），用于移动层级时排除自身子树
 */
export function collectSubtreeIds(docs: DocMeta[], rootId: string): Set<string> {
  const result = new Set<string>([rootId]);
  let added = true;
  while (added) {
    added = false;
    for (const d of docs) {
      if (d.parentId && result.has(d.parentId) && !result.has(d.id)) {
        result.add(d.id);
        added = true;
      }
    }
  }
  return result;
}

/**
 * 从 ProseMirror 文档状态实时提取 H1 / H2 / H3 标题目录
 */
export function extractHeadings(editor: Editor | null): OutlineItem[] {
  if (!editor || editor.isDestroyed) return [];
  const items: OutlineItem[] = [];
  let idx = 0;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      const rawLevel = Number(node.attrs.level ?? 1);
      const level = (rawLevel === 2 ? 2 : rawLevel >= 3 ? 3 : 1) as 1 | 2 | 3;
      const text = node.textContent.trim() || "（无标题段落）";
      items.push({
        id: `heading-${pos}-${idx}`,
        level,
        text,
        pos,
        index: idx,
      });
      idx++;
    }
    return true;
  });
  return items;
}
