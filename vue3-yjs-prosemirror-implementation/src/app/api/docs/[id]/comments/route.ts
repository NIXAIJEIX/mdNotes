import { NextResponse } from "next/server";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { commentLikes, docComments, documents } from "@/db/schema";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/** GET /api/docs/:id/comments —— 全部评论(扁平,客户端按 parentId 组树) */
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  // me 用于标记"我是否点过赞";聚合点赞数,悬浮卡按热度排序要用
  const me = new URL(_req.url).searchParams.get("me") ?? "";
  const rows = await db
    .select({
      id: docComments.id,
      docId: docComments.docId,
      parentId: docComments.parentId,
      kind: docComments.kind,
      anchor: docComments.anchor,
      quote: docComments.quote,
      authorId: docComments.authorId,
      authorName: docComments.authorName,
      authorColor: docComments.authorColor,
      body: docComments.body,
      resolved: docComments.resolved,
      createdAt: docComments.createdAt,
      likeCount: sql<number>`count(${commentLikes.userId})::int`,
      likedByMe: sql<boolean>`coalesce(bool_or(${commentLikes.userId} = ${me}), false)`,
    })
    .from(docComments)
    .leftJoin(commentLikes, eq(commentLikes.commentId, docComments.id))
    .where(eq(docComments.docId, id))
    .groupBy(docComments.id)
    .orderBy(asc(docComments.createdAt));
  return NextResponse.json({ comments: rows });
}

/**
 * POST /api/docs/:id/comments —— 发表评论 / 读书笔记
 * body: {
 *   body, kind: 'inline'|'doc', parentId?,
 *   anchor?: { from: b64RelativePos, to: b64RelativePos, quote },
 *   author: { clientId, name, color }
 * }
 * anchor 使用 Yjs 相对位置,多人并发编辑时锚点自动跟随文字移动。
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const [doc] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.id, id));
  if (!doc) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const payload = (await req.json().catch(() => null)) as {
    body?: string;
    kind?: string;
    parentId?: string;
    anchor?: { from?: string; to?: string; quote?: string };
    author?: { clientId?: string; name?: string; color?: string };
  } | null;

  const text = (payload?.body ?? "").trim().slice(0, 2000);
  if (!text) {
    return NextResponse.json({ error: "body required" }, { status: 400 });
  }

  const author = payload?.author ?? {};
  const authorId = (author.clientId ?? "anonymous").slice(0, 64);
  const authorName = (author.name ?? "访客").slice(0, 40);
  const authorColor = /^#[0-9a-fA-F]{6}$/.test(author.color ?? "")
    ? (author.color as string)
    : "#3370ff";

  let parentId: string | null = null;
  let parent: {
    id: string;
    kind: string;
    anchor: string | null;
    quote: string | null;
  } | undefined;
  if (payload?.parentId) {
    if (!UUID_RE.test(payload.parentId)) {
      return NextResponse.json({ error: "invalid parentId" }, { status: 400 });
    }
    [parent] = await db
      .select({
        id: docComments.id,
        kind: docComments.kind,
        anchor: docComments.anchor,
        quote: docComments.quote,
      })
      .from(docComments)
      .where(
        and(eq(docComments.id, payload.parentId), eq(docComments.docId, id)),
      );
    if (!parent) {
      return NextResponse.json({ error: "parent not found" }, { status: 404 });
    }
    parentId = parent.id;
  }

  // 回复继承父评论的类型与锚点,不再要求客户端重复传 anchor
  const kind = parent
    ? (parent.kind === "doc" ? "doc" : "inline")
    : payload?.kind === "doc"
      ? "doc"
      : "inline";

  if (parent) {
    const [row] = await db
      .insert(docComments)
      .values({
        docId: id,
        parentId,
        kind,
        anchor: parent.anchor,
        quote: parent.quote,
        authorId,
        authorName,
        authorColor,
        body: text,
      })
      .returning();
    return NextResponse.json({ comment: row }, { status: 201 });
  }

  let anchor: string | null = null;
  let quote: string | null = null;
  if (kind === "inline") {
    const a = payload?.anchor;
    if (!a?.from || !a?.to || typeof a.from !== "string") {
      return NextResponse.json({ error: "anchor required" }, { status: 400 });
    }
    if (a.from.length > 4000 || a.to.length > 4000) {
      return NextResponse.json({ error: "anchor too large" }, { status: 413 });
    }
    quote = (a.quote ?? "").slice(0, 500) || null;
    anchor = JSON.stringify({
      from: a.from,
      to: a.to,
      quote,
    });
  }

  const [row] = await db
    .insert(docComments)
    .values({
      docId: id,
      parentId,
      kind,
      anchor,
      quote,
      authorId,
      authorName,
      authorColor,
      body: text,
    })
    .returning();

  return NextResponse.json({ comment: row }, { status: 201 });
}

/** 供其它路由复用:统计某文档未解决评论数 */
export async function countOpenComments(docId: string): Promise<number> {
  const rows = await db
    .select({ id: docComments.id })
    .from(docComments)
    .where(
      and(
        eq(docComments.docId, docId),
        eq(docComments.resolved, false),
        isNull(docComments.parentId),
      ),
    );
  return rows.length;
}
