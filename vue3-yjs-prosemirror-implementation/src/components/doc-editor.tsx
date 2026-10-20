"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import * as Y from "yjs";
import { Extension } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import LinkExtension from "@tiptap/extension-link";
import Highlight from "@tiptap/extension-highlight";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Placeholder } from "@tiptap/extensions";
import {
  b64ToU8,
  HttpCollabProvider,
  useLocalUser,
  u8ToB64,
  type CollabStatus,
  type LocalUser,
} from "@/lib/collab-provider";
import { readSnapshot, writeSnapshot } from "@/lib/local-cache";
import { lowlight, CODE_LANGUAGES } from "@/lib/syntax";
import {
  buildThreads,
  encodeAnchor,
  fetchComments,
  resolveAnchor,
  type Anchor,
  type CommentRow,
  type Thread,
} from "@/lib/comments";
import {
  extractHeadings,
  getBreadcrumbs,
  type DocMeta,
  type OutlineItem,
} from "@/lib/kb-tree";
import {
  SyncBlock,
  YDocContext,
  getSyncTextMap,
  newSyncId,
} from "@/components/sync-block";
import {
  CommentHighlight,
  refreshCommentDecorations,
  resetDecorationSignature,
  type ThreadRange,
} from "@/components/comment-plugin";
import CommentSidebar from "@/components/comment-sidebar";
import CommentHoverCard, {
  type HoverTarget,
} from "@/components/comment-hover-card";
import DocCommentFooter from "@/components/doc-comment-footer";
import KbOutlineSidebar, {
  type LeftPanelMode,
} from "@/components/kb-outline-sidebar";
import SelectionCommentButton from "@/components/selection-comment-button";

interface PresenceUser {
  clientId: string;
  name: string;
  color: string;
}

export interface InitialUpdate {
  seq: number;
  data: string;
}

const STATUS_TEXT: Record<CollabStatus, string> = {
  connecting: "连接中…",
  saving: "正在保存…",
  synced: "已保存到云端",
  offline: "连接断开，重试中…",
};

const STATUS_DOT: Record<CollabStatus, string> = {
  connecting: "bg-amber-400",
  saving: "bg-amber-400",
  synced: "bg-emerald-500",
  offline: "bg-red-500",
};

const COMMENT_POLL_MS = 4000;
const MIN_EDITOR_CANVAS = 520;

function sameComments(a: CommentRow[], b: CommentRow[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.resolved !== y.resolved ||
      x.body !== y.body ||
      x.likeCount !== y.likeCount ||
      x.likedByMe !== y.likedByMe
    )
      return false;
  }
  return true;
}

const EDITOR_PROPS = { attributes: { class: "tiptap" } };

function seedYDoc(docId: string, initialUpdates: InitialUpdate[]): Y.Doc {
  const ydoc = new Y.Doc();
  const cached = readSnapshot(docId);
  if (cached) {
    try {
      Y.applyUpdate(ydoc, b64ToU8(cached.data));
    } catch {
      /* 缓存损坏,忽略 */
    }
  }
  for (const u of initialUpdates) {
    try {
      Y.applyUpdate(ydoc, b64ToU8(u.data));
    } catch {
      /* 跳过坏帧 */
    }
  }
  return ydoc;
}

export default function DocEditor({
  docId,
  initialTitle,
  initialUpdates,
  initialSeq,
  initialDocs = [],
}: {
  docId: string;
  initialTitle: string;
  initialUpdates: InitialUpdate[];
  initialSeq: number;
  initialDocs?: DocMeta[];
}) {
  const [ydoc] = useState(() => seedYDoc(docId, initialUpdates));
  const [provider, setProvider] = useState<HttpCollabProvider | null>(null);
  const user = useLocalUser();

  useEffect(() => {
    const p = new HttpCollabProvider(docId, ydoc, initialSeq);
    setProvider(p);
    void p.connect();
    return () => {
      p.destroy();
      ydoc.destroy();
    };
  }, [docId, ydoc, initialSeq]);

  return (
    <EditorShell
      key={docId}
      docId={docId}
      initialTitle={initialTitle}
      initialDocs={initialDocs}
      ydoc={ydoc}
      provider={provider}
      user={user}
    />
  );
}

/** 插入 / 编辑 / 移除链接(工具栏与 Mod-K 共用) */
function promptLink(editor: Editor) {
  const prev = (editor.getAttributes("link").href as string) ?? "";
  const url = window.prompt(
    "输入链接地址（留空则移除链接）",
    prev || "https://",
  );
  if (url === null) return;
  const trimmed = url.trim();
  if (!trimmed) {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    return;
  }
  const href = /^(https?:\/\/|mailto:|tel:)/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
}

const LinkShortcut = Extension.create({
  name: "linkShortcut",
  addKeyboardShortcuts() {
    return {
      "Mod-k": () => {
        promptLink(this.editor as Editor);
        return true;
      },
    };
  },
});

/** ⌘/Ctrl + ⌥ + M：把当前选区变成一条划词笔记 */
const CommentShortcut = Extension.create<{ onComment: () => void }>({
  name: "commentShortcut",
  addOptions() {
    return { onComment: () => undefined };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Alt-m": () => {
        this.options.onComment();
        return true;
      },
    };
  },
});

function EditorShell({
  docId,
  initialTitle,
  initialDocs,
  ydoc,
  provider,
  user,
}: {
  docId: string;
  initialTitle: string;
  initialDocs: DocMeta[];
  ydoc: Y.Doc;
  provider: HttpCollabProvider | null;
  user: LocalUser;
}) {
  const [status, setStatus] = useState<CollabStatus>("connecting");
  const [title, setTitle] = useState(initialTitle);
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mainScrollRef = useRef<HTMLElement | null>(null);

  /* ================= 视口宽度与企业级响应式布局 ================= */
  const [viewportWidth, setViewportWidth] = useState<number>(1440);
  const [kbOpen, setKbOpen] = useState<boolean>(true);
  const [leftMode, setLeftMode] = useState<LeftPanelMode>("split");
  const didInitViewport = useRef(false);

  useEffect(() => {
    let raf: number | null = null;
    const syncViewport = () => {
      const w = window.innerWidth;
      setViewportWidth(w);
      if (!didInitViewport.current) {
        didInitViewport.current = true;
        // 窄屏初始收起左侧抽屉，避免遮挡正文；桌面端默认展开知识库与目录
        if (w < 1024) setKbOpen(false);
      }
    };
    syncViewport();

    const onResize = () => {
      if (raf !== null) return;
      raf = window.requestAnimationFrame(() => {
        raf = null;
        setViewportWidth(window.innerWidth);
      });
    };
    window.addEventListener("resize", onResize);
    return () => {
      if (raf !== null) window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  /* ================= 知识库文档树与实时目录大纲 ================= */
  const [docs, setDocs] = useState<DocMeta[]>(initialDocs);
  const [headings, setHeadings] = useState<OutlineItem[]>([]);
  const [activeHeadingIndex, setActiveHeadingIndex] = useState<number>(0);
  const headingSigRef = useRef<string>("");

  const reloadDocs = useCallback(async () => {
    try {
      const res = await fetch("/api/docs", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { docs: DocMeta[] };
      setDocs(json.docs);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (initialDocs.length === 0) {
      void reloadDocs();
    }
  }, [initialDocs.length, reloadDocs]);

  // 快捷键 ⌘/Ctrl + \ 切换知识库/目录侧栏
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setKbOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /* ================= 评论状态 ================= */
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeIds, setActiveIds] = useState<string[]>([]);
  const [filter, setFilter] = useState<"all" | "open">("all");
  const [draft, setDraft] = useState<{ anchor: Anchor; quote: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState<HoverTarget | null>(null);

  // 窄视口与双栏避让策略
  const leftOverlay = viewportWidth < 960;
  const rightOverlay =
    viewportWidth < 960 || (kbOpen && viewportWidth < 1140);

  const openLeftSidebar = useCallback(
    (mode?: LeftPanelMode) => {
      if (mode) setLeftMode(mode);
      setKbOpen(true);
      if (viewportWidth < 960) setSidebarOpen(false);
    },
    [viewportWidth],
  );

  const openRightSidebar = useCallback(() => {
    setSidebarOpen(true);
    if (viewportWidth < 960) setKbOpen(false);
  }, [viewportWidth]);

  // 动态计算左右停靠栏最大可用宽度，确保中央编辑区至少保有 MIN_EDITOR_CANVAS 宽度
  const maxAllowedLeftWidth = useMemo(() => {
    if (leftOverlay) return Math.floor(viewportWidth * 0.84);
    const reservedRight = sidebarOpen && !rightOverlay ? 300 : 0;
    return Math.max(
      220,
      Math.min(420, viewportWidth - MIN_EDITOR_CANVAS - reservedRight),
    );
  }, [leftOverlay, rightOverlay, sidebarOpen, viewportWidth]);

  const maxAllowedRightWidth = useMemo(() => {
    if (rightOverlay) return Math.floor(viewportWidth * 0.88);
    const reservedLeft = kbOpen && !leftOverlay ? 250 : 0;
    return Math.max(
      280,
      Math.min(720, viewportWidth - MIN_EDITOR_CANVAS - reservedLeft),
    );
  }, [kbOpen, leftOverlay, rightOverlay, viewportWidth]);

  // 回调通过 ref 传给扩展,避免闭包过期(扩展只创建一次)
  const openThreadRef = useRef<(ids: string[]) => void>(() => undefined);
  const startDraftRef = useRef<() => void>(() => undefined);
  const hoverThreadRef = useRef<(ids: string[] | null) => void>(() => undefined);

  const extensions = useMemo(
    () => [
      StarterKit.configure({ undoRedo: false, codeBlock: false, link: false }),
      LinkExtension.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: {
          rel: "noopener noreferrer nofollow",
          target: "_blank",
        },
      }),
      Highlight.configure({ multicolor: true }),
      CodeBlockLowlight.configure({ lowlight, defaultLanguage: "javascript" }),
      Collaboration.configure({ document: ydoc }),
      Placeholder.configure({
        placeholder:
          "输入正文，支持多人同时编辑…（H1–H3 自动生成目录，``` 代码块，⌘/Ctrl+⌥+M 划词做笔记）",
      }),
      SyncBlock,
      LinkShortcut,
      CommentShortcut.configure({ onComment: () => startDraftRef.current() }),
      CommentHighlight.configure({
        onOpenThread: (ids: string[]) => openThreadRef.current(ids),
        onHoverThread: (ids: string[] | null) => hoverThreadRef.current(ids),
      }),
    ],
    [ydoc],
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    editorProps: EDITOR_PROPS,
  });

  /* ================= 实时提取文档目录 (H1/H2/H3) ================= */
  useEffect(() => {
    if (!editor) return;
    const syncHeadings = () => {
      const next = extractHeadings(editor);
      const sig = next.map((h) => `${h.level}:${h.pos}:${h.text}`).join("|");
      if (sig === headingSigRef.current) return;
      headingSigRef.current = sig;
      setHeadings(next);
      setActiveHeadingIndex((prev) =>
        next.length === 0 ? 0 : Math.min(prev, next.length - 1),
      );
    };
    syncHeadings();
    editor.on("update", syncHeadings);
    return () => {
      editor.off("update", syncHeadings);
    };
  }, [editor]);

  // 滚动正文时高亮当前所在章节目录项
  useEffect(() => {
    const container = mainScrollRef.current;
    if (!container || headings.length === 0) return;
    let raf: number | null = null;
    const onScroll = () => {
      if (raf !== null) return;
      raf = window.requestAnimationFrame(() => {
        raf = null;
        const domNodes = container.querySelectorAll(
          ".tiptap h1, .tiptap h2, .tiptap h3",
        );
        if (domNodes.length === 0) return;
        const containerTop = container.getBoundingClientRect().top;
        let currentIdx = 0;
        domNodes.forEach((node, idx) => {
          const top = node.getBoundingClientRect().top - containerTop;
          if (top <= 120) currentIdx = idx;
        });
        setActiveHeadingIndex(currentIdx);
      });
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (raf !== null) window.cancelAnimationFrame(raf);
      container.removeEventListener("scroll", onScroll);
    };
  }, [headings.length]);

  const jumpToHeading = useCallback(
    (item: OutlineItem) => {
      if (!editor) return;
      setActiveHeadingIndex(item.index);
      const container = mainScrollRef.current ?? document;
      const domNodes = container.querySelectorAll(
        ".tiptap h1, .tiptap h2, .tiptap h3",
      );
      const target = domNodes[item.index] as HTMLElement | undefined;
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      const docSize = editor.state.doc.content.size;
      const safePos = Math.min(Math.max(1, item.pos + 1), docSize);
      editor.chain().focus().setTextSelection(safePos).run();
    },
    [editor],
  );

  const insertSampleOutline = useCallback(() => {
    if (!editor) return;
    editor
      .chain()
      .focus("end")
      .insertContent([
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "一、背景与目标" }],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "在这里记录业务背景、核心指标与整体演进方向。",
            },
          ],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "1.1 核心架构设计" }],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "基于 Yjs CRDT 与 ProseMirror 实现无冲突实时协同。",
            },
          ],
        },
        {
          type: "heading",
          attrs: { level: 3 },
          content: [{ type: "text", text: "1.1.1 增量同步与快照压缩" }],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "服务端按阈值自动合并 update 日志，兼顾打开速度与历史回放。",
            },
          ],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "1.2 运维与监控指标" }],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "重点关注连接数、单文档 update 吞吐、快照压缩耗时与对象存储带宽。",
            },
          ],
        },
      ])
      .run();
  }, [editor]);

  const threads = useMemo<Thread[]>(() => buildThreads(comments), [comments]);
  const inlineThreads = useMemo(
    () => threads.filter((t) => t.kind === "inline" && t.anchor),
    [threads],
  );
  const docThreads = useMemo(
    () => threads.filter((t) => t.kind === "doc"),
    [threads],
  );
  // 文档里已有评论时,首次加载自动展开评论面板(仅在宽屏下自动展开,窄屏不遮挡正文)
  const didAutoOpen = useRef(false);
  useEffect(() => {
    if (didAutoOpen.current || comments.length === 0) return;
    didAutoOpen.current = true;
    if (window.innerWidth >= 1024) {
      setSidebarOpen(true);
    }
  }, [comments.length]);

  const threadsRef = useRef<Thread[]>(threads);
  threadsRef.current = threads;
  const inlineThreadsRef = useRef<Thread[]>(inlineThreads);
  inlineThreadsRef.current = inlineThreads;
  const activeIdsRef = useRef<string[]>(activeIds);
  activeIdsRef.current = activeIds;

  /* ================= 拉取评论(不阻塞首屏) ================= */
  const reload = useCallback(async () => {
    const rows = await fetchComments(docId, user.clientId);
    setComments((prev) => (sameComments(prev, rows) ? prev : rows));
    return rows;
  }, [docId, user.clientId]);

  useEffect(() => {
    let stopped = false;
    void reload();
    const timer = setInterval(() => {
      if (stopped || document.visibilityState === "hidden") return;
      void reload();
    }, COMMENT_POLL_MS);
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [reload]);

  /* ================= 装饰刷新高亮 ================= */
  useEffect(() => {
    if (!editor) return;
    resetDecorationSignature();

    const compute = (): ThreadRange[] =>
      inlineThreadsRef.current.flatMap((t) => {
        if (!t.anchor) return [];
        const range = resolveAnchor(editor, t.anchor);
        if (!range) return [];
        return [
          {
            threadId: t.id,
            from: range.from,
            to: range.to,
            count: t.items.length,
            resolved: t.resolved,
            active: activeIdsRef.current.includes(t.id),
          },
        ];
      });

    const apply = () => refreshCommentDecorations(editor, compute());
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        apply();
      }, 120);
    };

    apply();
    editor.on("update", schedule);
    return () => {
      editor.off("update", schedule);
      if (timer) clearTimeout(timer);
    };
  }, [editor, inlineThreads, activeIds]);

  /* ================= 评论交互 ================= */
  const scrollCardIntoView = useCallback((threadId: string) => {
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-thread-card="${threadId}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, []);

  const startDraft = useCallback(
    (from?: number, to?: number) => {
      if (!editor) return;
      const sel = editor.state.selection;
      const f = from ?? sel.from;
      const t = to ?? sel.to;
      if (f === t) return;
      const anchor = encodeAnchor(editor, f, t);
      if (!anchor) return;
      const quote =
        anchor.quote ?? editor.state.doc.textBetween(f, t, " ").trim();
      setDraft({ anchor, quote });
      openRightSidebar();
    },
    [editor, openRightSidebar],
  );

  /* ---- 悬浮预览:测量被评论句子的联合矩形,卡片与之等宽 ---- */
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overCardRef = useRef(false);

  const measureThreads = useCallback(
    (threadIds: string[]): HoverTarget | null => {
      const firstId = threadIds[0];
      if (!firstId) return null;
      const nodes = Array.from(
        document.querySelectorAll(`.tiptap [data-thread-id="${firstId}"]`),
      );
      if (nodes.length === 0) return null;
      const rects = nodes.map((node) => node.getBoundingClientRect());
      const left = Math.min(...rects.map((rect) => rect.left));
      const right = Math.max(...rects.map((rect) => rect.right));
      const top = Math.min(...rects.map((rect) => rect.top));
      const bottom = Math.max(...rects.map((rect) => rect.bottom));
      return {
        threadIds,
        rect: { left, top, bottom, width: right - left },
      };
    },
    [],
  );

  const scheduleHide = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      if (!overCardRef.current) setHover(null);
    }, 180);
  }, []);

  useEffect(() => {
    hoverThreadRef.current = (ids) => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      if (!ids || ids.length === 0) {
        scheduleHide();
        return;
      }
      hoverTimer.current = setTimeout(() => {
        const target = measureThreads(ids);
        if (target) setHover(target);
      }, 140);
    };
  }, [measureThreads, scheduleHide]);

  useEffect(() => {
    if (!hover) return;
    const close = () => setHover(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [hover]);

  useEffect(() => {
    openThreadRef.current = (ids) => {
      setActiveIds(ids);
      openRightSidebar();
      if (ids[0]) scrollCardIntoView(ids[0]);
    };
    startDraftRef.current = () => startDraft();
  });

  const postComment = useCallback(
    async (payload: {
      body: string;
      kind: "inline" | "doc";
      parentId?: string;
      anchor?: Anchor;
    }) => {
      const res = await fetch(`/api/docs/${docId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, author: user }),
      });
      if (!res.ok) throw new Error(`post comment failed: ${res.status}`);
      const json = (await res.json()) as { comment: CommentRow };
      await reload();
      return json.comment;
    },
    [docId, reload, user],
  );

  const publishDraft = useCallback(
    async (body: string) => {
      if (!draft) return;
      setBusy(true);
      try {
        const comment = await postComment({
          body,
          kind: "inline",
          anchor: draft.anchor,
        });
        setDraft(null);
        setActiveIds([comment.parentId ?? comment.id]);
        scrollCardIntoView(comment.parentId ?? comment.id);
      } finally {
        setBusy(false);
      }
    },
    [draft, postComment, scrollCardIntoView],
  );

  const reply = useCallback(
    async (threadId: string, body: string) => {
      setBusy(true);
      try {
        await postComment({ body, kind: "inline", parentId: threadId });
      } finally {
        setBusy(false);
      }
    },
    [postComment],
  );

  const postDocComment = useCallback(
    async (body: string) => {
      setBusy(true);
      try {
        await postComment({ body, kind: "doc" });
      } finally {
        setBusy(false);
      }
    },
    [postComment],
  );

  const toggleResolved = useCallback(
    async (threadId: string, resolved: boolean) => {
      await fetch(`/api/comments/${threadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolved }),
      }).catch(() => undefined);
      await reload();
    },
    [reload],
  );

  const deleteComment = useCallback(
    async (commentId: string) => {
      if (!confirm("删除这条评论？其回复也会一并删除。")) return;
      await fetch(`/api/comments/${commentId}`, { method: "DELETE" }).catch(
        () => undefined,
      );
      await reload();
    },
    [reload],
  );

  const like = useCallback(
    (commentId: string) => {
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? {
                ...c,
                likedByMe: !c.likedByMe,
                likeCount: c.likeCount + (c.likedByMe ? -1 : 1),
              }
            : c,
        ),
      );
      void fetch(`/api/comments/${commentId}/like`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: user.clientId }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((json: { liked: boolean; likeCount: number } | null) => {
          if (!json) return;
          setComments((prev) =>
            prev.map((c) =>
              c.id === commentId
                ? { ...c, likedByMe: json.liked, likeCount: json.likeCount }
                : c,
            ),
          );
        })
        .catch(() => void reload());
    },
    [reload, user.clientId],
  );

  const locate = useCallback(
    (threadId: string) => {
      if (!editor) return;
      const thread = threadsRef.current.find((t) => t.id === threadId);
      if (!thread?.anchor) return;
      const range = resolveAnchor(editor, thread.anchor);
      if (!range) {
        alert("原文已被删除，锚点已失效");
        return;
      }
      setActiveIds([threadId]);
      editor.chain().focus().setTextSelection(range).run();
      editor.commands.scrollIntoView();
    },
    [editor],
  );

  /* ================= 本地快照 ================= */
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSnapshot = useCallback(() => {
    if (snapTimer.current) clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(() => {
      try {
        writeSnapshot(
          docId,
          provider?.getLastSeq() ?? 0,
          u8ToB64(Y.encodeStateAsUpdate(ydoc)),
        );
      } catch {
        /* ignore */
      }
    }, 400);
  }, [docId, provider, ydoc]);

  useEffect(() => {
    const onUpdate = () => scheduleSnapshot();
    ydoc.on("update", onUpdate);
    const persist = () => {
      try {
        writeSnapshot(
          docId,
          provider?.getLastSeq() ?? 0,
          u8ToB64(Y.encodeStateAsUpdate(ydoc)),
        );
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("pagehide", persist);
    return () => {
      ydoc.off("update", onUpdate);
      window.removeEventListener("pagehide", persist);
      if (snapTimer.current) clearTimeout(snapTimer.current);
      persist();
    };
  }, [docId, provider, scheduleSnapshot, ydoc]);

  /* ================= 同步状态 / presence / 标题 ================= */
  useEffect(() => {
    if (!provider) return;
    return provider.onStatus(setStatus);
  }, [provider]);

  useEffect(() => {
    if (user.clientId === "ssr") return;
    let stopped = false;
    const beat = async () => {
      try {
        const res = await fetch(`/api/docs/${docId}/presence`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(user),
        });
        if (res.ok && !stopped) {
          const json = (await res.json()) as { users: PresenceUser[] };
          setUsers((prev) =>
            prev.length === json.users.length &&
            prev.every(
              (u, i) =>
                u.clientId === json.users[i].clientId &&
                u.name === json.users[i].name,
            )
              ? prev
              : json.users,
          );
        }
      } catch {
        /* 心跳失败忽略 */
      }
    };
    void beat();
    const timer = setInterval(() => void beat(), 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
      void fetch(`/api/docs/${docId}/presence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: user.clientId, leaving: true }),
        keepalive: true,
      }).catch(() => undefined);
    };
  }, [docId, user]);

  const onTitleChange = useCallback(
    (value: string) => {
      setTitle(value);
      setDocs((prev) =>
        prev.map((d) =>
          d.id === docId ? { ...d, title: value || "无标题文档" } : d,
        ),
      );
      if (titleTimer.current) clearTimeout(titleTimer.current);
      titleTimer.current = setTimeout(() => {
        void fetch(`/api/docs/${docId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: value }),
        })
          .then(() => reloadDocs())
          .catch(() => undefined);
      }, 600);
    },
    [docId, reloadDocs],
  );

  const stats = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return { chars: 0, blocks: 0 };
      return {
        chars: e.state.doc.textContent.replace(/\s/g, "").length,
        blocks: e.state.doc.childCount,
      };
    },
  });

  const breadcrumbs = useMemo(
    () => getBreadcrumbs(docs, docId),
    [docs, docId],
  );
  const ancestorCrumbs = breadcrumbs.slice(0, -1);

  const others = users.filter((u) => u.clientId !== user.clientId);
  const totalComments = threads.length;
  const openComments = threads.filter((t) => !t.resolved).length;

  const sidebarHandlers = useMemo(
    () => ({
      onPublishDraft: publishDraft,
      onCancelDraft: () => setDraft(null),
      onReply: reply,
      onToggleResolved: toggleResolved,
      onDelete: deleteComment,
      onLike: like,
      onLocate: locate,
      onFocusCard: (id: string) => setActiveIds([id]),
    }),
    [publishDraft, reply, toggleResolved, deleteComment, like, locate],
  );

  return (
    <YDocContext.Provider value={ydoc}>
      <div className="flex h-screen w-screen overflow-hidden flex-col bg-white">
        {/* 顶栏：知识库开关 + 面包屑导航 + 标题 + 协同状态 + 评论开关 */}
        <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-gray-100 px-3 sm:gap-2.5 sm:px-4">
          <button
            type="button"
            onClick={() => {
              if (kbOpen) setKbOpen(false);
              else openLeftSidebar();
            }}
            title="展开/收起知识库与目录 (⌘/Ctrl + \)"
            className={`flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] transition ${
              kbOpen
                ? "bg-[#eaf1ff] text-[#3370ff]"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <rect
                x="1.8"
                y="2.5"
                width="12.4"
                height="11"
                rx="1.8"
                stroke="currentColor"
                strokeWidth="1.3"
              />
              <path
                d="M6 2.8v10.4"
                stroke="currentColor"
                strokeWidth="1.3"
              />
            </svg>
            <span className="hidden md:inline">知识库 / 目录</span>
          </button>

          {/* 面包屑路径：知识库首页 / 父级文档 / 当前文档 */}
          <nav
            aria-label="知识库面包屑"
            className="flex min-w-0 flex-1 items-center gap-1 text-[13px]"
          >
            <Link
              href="/"
              prefetch
              className="hidden shrink-0 rounded px-1.5 py-0.5 text-gray-500 transition hover:bg-gray-100 hover:text-[#3370ff] sm:inline"
              title="返回知识库主页"
            >
              知识库
            </Link>
            {ancestorCrumbs.length > 0 && (
              <span className="hidden text-gray-300 sm:inline">/</span>
            )}
            {ancestorCrumbs.length > 2 && (
              <>
                <span className="hidden text-gray-400 lg:inline">…</span>
                <span className="hidden text-gray-300 lg:inline">/</span>
              </>
            )}
            {ancestorCrumbs.slice(-2).map((crumb) => (
              <span
                key={crumb.id}
                className="hidden min-w-0 max-w-[140px] items-center gap-1 md:flex"
              >
                <Link
                  href={`/doc/${crumb.id}`}
                  prefetch
                  className="truncate rounded px-1.5 py-0.5 text-gray-500 transition hover:bg-gray-100 hover:text-[#3370ff]"
                  title={crumb.title}
                >
                  {crumb.title || "无标题文档"}
                </Link>
                <span className="text-gray-300">/</span>
              </span>
            ))}

            <DocIcon />
            <input
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder="无标题文档"
              className="min-w-[100px] flex-1 truncate bg-transparent text-[15px] font-medium text-gray-900 outline-none placeholder:text-gray-300"
            />
          </nav>

          <div className="hidden shrink-0 items-center gap-1.5 text-xs text-gray-400 lg:flex">
            <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
            {STATUS_TEXT[status]}
          </div>

          {/* 目录快捷按钮（窄屏或左侧栏收起时一键看目录） */}
          <button
            type="button"
            onClick={() => {
              if (kbOpen && leftMode === "toc") {
                setKbOpen(false);
              } else {
                openLeftSidebar("toc");
              }
            }}
            title="查看本页章节目录"
            className={`flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] transition ${
              kbOpen && leftMode === "toc"
                ? "bg-[#eaf1ff] text-[#3370ff]"
                : "text-gray-500 hover:bg-gray-100"
            }`}
          >
            <span>☰</span>
            <span className="hidden sm:inline">目录</span>
            {headings.length > 0 && (
              <span className="rounded-full bg-gray-100 px-1.5 text-[10px] text-gray-500">
                {headings.length}
              </span>
            )}
          </button>

          {/* 评论开关 */}
          <button
            type="button"
            onClick={() => {
              if (sidebarOpen) setSidebarOpen(false);
              else openRightSidebar();
            }}
            title="评论 / 读书笔记"
            className={`relative flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] transition ${
              sidebarOpen
                ? "bg-[#eaf1ff] text-[#3370ff]"
                : "text-gray-500 hover:bg-gray-100"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M2.5 3.5A1.5 1.5 0 0 1 4 2h8a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 12 11H6.5L3 13.8V11h-.5A1.5 1.5 0 0 1 1 9.5v-6Z"
                stroke="currentColor"
                strokeWidth="1.3"
              />
            </svg>
            <span className="hidden sm:inline">评论</span>
            {totalComments > 0 && (
              <span
                className={`rounded-full px-1.5 text-[10px] font-medium ${
                  openComments > 0
                    ? "bg-[#3370ff] text-white"
                    : "bg-gray-200 text-gray-500"
                }`}
              >
                {openComments > 0 ? openComments : totalComments}
              </span>
            )}
          </button>

          <div className="hidden items-center -space-x-2 sm:flex">
            {[user, ...others].slice(0, 4).map((u) => (
              <span
                key={u.clientId}
                title={u.clientId === user.clientId ? `${u.name}（我）` : u.name}
                className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-[11px] font-medium text-white"
                style={{ backgroundColor: u.color }}
              >
                {u.name.slice(-2)}
              </span>
            ))}
            {others.length > 3 && (
              <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-gray-200 text-[10px] text-gray-600">
                +{others.length - 3}
              </span>
            )}
          </div>

          <button
            type="button"
            className="shrink-0 rounded-md bg-[#3370ff] px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-[#2b5fe0]"
            onClick={() => {
              void navigator.clipboard
                .writeText(window.location.href)
                .catch(() => undefined);
              alert("链接已复制，发给其他人即可协同编辑");
            }}
          >
            分享
          </button>
        </header>

        <FormatToolbar
          editor={editor}
          ydoc={ydoc}
          onComment={() => {
            if (!editor) return;
            const { from, to } = editor.state.selection;
            if (from === to) {
              alert("先选中一段文字，再添加笔记");
              return;
            }
            startDraft(from, to);
          }}
        />

        {/* 主工作区：左（知识库+目录）+ 中（自适应正文画布）+ 右（评论侧栏） */}
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <KbOutlineSidebar
            open={kbOpen}
            onClose={() => setKbOpen(false)}
            docs={docs}
            currentDocId={docId}
            headings={headings}
            activeHeadingIndex={activeHeadingIndex}
            onJumpToHeading={jumpToHeading}
            onInsertSampleOutline={insertSampleOutline}
            onDocsChange={reloadDocs}
            onRenameCurrentDoc={(newTitle) => setTitle(newTitle)}
            mode={leftMode}
            onModeChange={setLeftMode}
            overlayMode={leftOverlay}
            maxAllowedWidth={maxAllowedLeftWidth}
          />

          <main
            ref={mainScrollRef}
            className="relative min-w-0 flex-1 overflow-y-auto scroll-smooth"
          >
            <div className="mx-auto w-full max-w-[860px] px-4 py-8 sm:px-8 md:px-12 lg:px-16 2xl:max-w-[940px]">
              <EditorContent editor={editor} />

              <DocCommentFooter
                threads={docThreads}
                me={user}
                busy={busy}
                activeIds={activeIds}
                inlineCount={inlineThreads.length}
                onSubmit={postDocComment}
                onReply={reply}
                onToggleResolved={toggleResolved}
                onDelete={deleteComment}
                onLike={like}
                onFocusCard={(id) => setActiveIds([id])}
                onJumpToInline={openRightSidebar}
              />
            </div>
          </main>

          <CommentSidebar
            open={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            threads={inlineThreads}
            docCommentCount={docThreads.length}
            draft={draft}
            busy={busy}
            activeIds={activeIds}
            filter={filter}
            onFilterChange={setFilter}
            me={user}
            handlers={sidebarHandlers}
            overlayMode={rightOverlay}
            maxAllowedWidth={maxAllowedRightWidth}
          />
        </div>

        <footer className="flex h-8 shrink-0 items-center justify-between gap-2 border-t border-gray-100 px-4 text-[11px] text-gray-400">
          <span className="truncate">
            Yjs CRDT · 知识库 {docs.length} 篇 · 目录 {headings.length} 节 ·
            ⌘/Ctrl+\ 切换侧栏
          </span>
          <span className="shrink-0">
            {stats?.chars ?? 0} 字 · {stats?.blocks ?? 0} 块 · 评论{" "}
            {totalComments}
          </span>
        </footer>

        <CommentHoverCard
          target={hover}
          threads={inlineThreads}
          onMouseEnter={() => {
            overCardRef.current = true;
            if (hoverTimer.current) clearTimeout(hoverTimer.current);
          }}
          onMouseLeave={() => {
            overCardRef.current = false;
            scheduleHide();
          }}
        />

        <SelectionCommentButton
          editor={editor}
          disabled={!!draft}
          onComment={(from, to) => startDraft(from, to)}
        />
      </div>
    </YDocContext.Provider>
  );
}

/* ---------------- 主工具栏(飞书风格) ---------------- */

type Btn = {
  key: string;
  label: React.ReactNode;
  title: string;
  active?: boolean;
  run: () => void;
  cls?: string;
};

function FormatToolbar({
  editor,
  ydoc,
  onComment,
}: {
  editor: Editor | null;
  ydoc: Y.Doc;
  onComment: () => void;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive("bold") ?? false,
      italic: e?.isActive("italic") ?? false,
      underline: e?.isActive("underline") ?? false,
      strike: e?.isActive("strike") ?? false,
      highlight: e?.isActive("highlight") ?? false,
      code: e?.isActive("code") ?? false,
      link: e?.isActive("link") ?? false,
      h1: e?.isActive("heading", { level: 1 }) ?? false,
      h2: e?.isActive("heading", { level: 2 }) ?? false,
      h3: e?.isActive("heading", { level: 3 }) ?? false,
      bulletList: e?.isActive("bulletList") ?? false,
      orderedList: e?.isActive("orderedList") ?? false,
      blockquote: e?.isActive("blockquote") ?? false,
      codeBlock: e?.isActive("codeBlock") ?? false,
      language:
        (e?.getAttributes("codeBlock").language as string) ?? "plaintext",
    }),
  });

  if (!editor) {
    return <div className="h-[42px] shrink-0 border-b border-gray-100" />;
  }
  // ⚠️ 必须是函数:chain().focus() 在"调用时"就会排队 view.focus(),
  // 若在渲染期调用,每次重渲染都会把焦点从评论框/标题框抢回正文。
  const c = () => editor.chain().focus();

  const setLink = () => promptLink(editor);

  const insertSyncBlock = () => {
    const { from, to } = editor.state.selection;
    const selected = editor.state.doc.textBetween(from, to, " ").trim();
    const syncId = newSyncId();
    const text = new Y.Text();
    if (selected) text.insert(0, selected);
    getSyncTextMap(ydoc).set(syncId, text);
    editor
      .chain()
      .focus()
      .insertContentAt({ from, to }, { type: "syncBlock", attrs: { syncId } })
      .run();
  };

  const groups: Btn[][] = [
    [
      {
        key: "undo",
        label: "↩",
        title: "撤销 (Ctrl+Z)",
        run: () => c().undo().run(),
      },
      {
        key: "redo",
        label: "↪",
        title: "重做 (Ctrl+Shift+Z)",
        run: () => c().redo().run(),
      },
    ],
    [
      {
        key: "h1",
        label: "H1",
        title: "一级标题",
        active: state?.h1,
        run: () => c().toggleHeading({ level: 1 }).run(),
      },
      {
        key: "h2",
        label: "H2",
        title: "二级标题",
        active: state?.h2,
        run: () => c().toggleHeading({ level: 2 }).run(),
      },
      {
        key: "h3",
        label: "H3",
        title: "三级标题",
        active: state?.h3,
        run: () => c().toggleHeading({ level: 3 }).run(),
      },
    ],
    [
      {
        key: "bold",
        label: "B",
        title: "加粗 (Ctrl+B)",
        active: state?.bold,
        run: () => c().toggleBold().run(),
        cls: "font-bold",
      },
      {
        key: "italic",
        label: "I",
        title: "斜体 (Ctrl+I)",
        active: state?.italic,
        run: () => c().toggleItalic().run(),
        cls: "italic",
      },
      {
        key: "underline",
        label: "U",
        title: "下划线 (Ctrl+U)",
        active: state?.underline,
        run: () => c().toggleUnderline().run(),
        cls: "underline",
      },
      {
        key: "strike",
        label: "S",
        title: "删除线",
        active: state?.strike,
        run: () => c().toggleStrike().run(),
        cls: "line-through",
      },
      {
        key: "highlight",
        label: "🖍",
        title: "高亮",
        active: state?.highlight,
        run: () =>
          state?.highlight
            ? c().unsetHighlight().run()
            : c().setHighlight({ color: "#fff1b8" }).run(),
      },
      {
        key: "code",
        label: "</>",
        title: "行内代码",
        active: state?.code,
        run: () => c().toggleCode().run(),
      },
    ],
    [
      {
        key: "bullet",
        label: "•≡",
        title: "无序列表",
        active: state?.bulletList,
        run: () => c().toggleBulletList().run(),
      },
      {
        key: "ordered",
        label: "1≡",
        title: "有序列表",
        active: state?.orderedList,
        run: () => c().toggleOrderedList().run(),
      },
      {
        key: "quote",
        label: "❝",
        title: "引用",
        active: state?.blockquote,
        run: () => c().toggleBlockquote().run(),
      },
      {
        key: "codeblock",
        label: "{ }",
        title: "代码块",
        active: state?.codeBlock,
        run: () => c().toggleCodeBlock().run(),
      },
      {
        key: "hr",
        label: "—",
        title: "分割线",
        run: () => c().setHorizontalRule().run(),
      },
    ],
    [
      {
        key: "link",
        label: "🔗",
        title: "插入/编辑链接 (Ctrl+K)",
        active: state?.link,
        run: setLink,
      },
      {
        key: "sync",
        label: "⇄ 同步块",
        title: "插入同步块：多处引用共享同一内容",
        run: insertSyncBlock,
        cls: "px-2",
      },
      {
        key: "comment",
        label: "💬 笔记",
        title: "把选区变成划词笔记 (Ctrl+⌥+M)",
        run: onComment,
        cls: "px-2",
      },
    ],
  ];

  return (
    <div className="flex h-[42px] shrink-0 items-center gap-1 overflow-x-auto border-b border-gray-100 px-3 sm:px-4">
      {groups.map((group, gi) => (
        <div key={gi} className="flex shrink-0 items-center gap-0.5">
          {gi > 0 && <span className="mx-1 h-4 w-px bg-gray-200 sm:mx-1.5" />}
          {group.map((item) => (
            <button
              key={item.key}
              type="button"
              title={item.title}
              onMouseDown={(e) => e.preventDefault()}
              onClick={item.run}
              className={`flex h-7 min-w-7 shrink-0 items-center justify-center rounded px-1.5 text-[13px] transition ${
                item.active
                  ? "bg-[#f0f4ff] text-[#3370ff]"
                  : "text-gray-600 hover:bg-gray-100"
              } ${item.cls ?? ""} ${
                item.key === "sync" || item.key === "comment"
                  ? "text-[11px] text-[#3370ff] hover:bg-[#eaf1ff]"
                  : ""
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      ))}

      {state?.codeBlock ? (
        <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
          <span className="hidden text-[11px] text-gray-400 sm:inline">
            代码语言
          </span>
          <select
            value={state.language}
            onChange={(e) =>
              editor
                .chain()
                .focus()
                .updateAttributes("codeBlock", { language: e.target.value })
                .run()
            }
            className="h-7 rounded border border-gray-200 bg-white px-1.5 text-[12px] text-gray-700 outline-none"
          >
            {CODE_LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <span className="ml-auto hidden shrink-0 text-[11px] text-gray-300 xl:block">
          {CODE_LANGUAGES.length - 1} 种语言高亮 · H1–H3 实时目录 · 划词可加笔记
        </span>
      )}
    </div>
  );
}

function DocIcon() {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#3370ff]">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
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
  );
}
