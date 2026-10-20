import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { commentLikes, docComments } from "@/db/schema";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /api/comments/:id/like —— 点赞 / 取消点赞(toggle) */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const payload = (await req.json().catch(() => null)) as {
    clientId?: string;
  } | null;
  const userId = (payload?.clientId ?? "").slice(0, 64);
  if (!userId) {
    return NextResponse.json({ error: "clientId required" }, { status: 400 });
  }

  const [comment] = await db
    .select({ id: docComments.id })
    .from(docComments)
    .where(eq(docComments.id, id));
  if (!comment) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const [existing] = await db
    .select({ userId: commentLikes.userId })
    .from(commentLikes)
    .where(and(eq(commentLikes.commentId, id), eq(commentLikes.userId, userId)));

  if (existing) {
    await db
      .delete(commentLikes)
      .where(
        and(eq(commentLikes.commentId, id), eq(commentLikes.userId, userId)),
      );
  } else {
    await db
      .insert(commentLikes)
      .values({ commentId: id, userId })
      .onConflictDoNothing();
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(commentLikes)
    .where(eq(commentLikes.commentId, id));

  return NextResponse.json({ liked: !existing, likeCount: count });
}
