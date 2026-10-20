import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { docComments } from "@/db/schema";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/** PATCH /api/comments/:id —— 标记已解决 / 编辑内容 */
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const payload = (await req.json().catch(() => null)) as {
    resolved?: boolean;
    body?: string;
  } | null;

  const patch: { resolved?: boolean; body?: string } = {};
  if (typeof payload?.resolved === "boolean") patch.resolved = payload.resolved;
  if (typeof payload?.body === "string" && payload.body.trim()) {
    patch.body = payload.body.trim().slice(0, 2000);
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const [row] = await db
    .update(docComments)
    .set(patch)
    .where(eq(docComments.id, id))
    .returning();

  if (!row) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ comment: row });
}

/** DELETE /api/comments/:id —— 删除(根评论级联删除其回复) */
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  await db.delete(docComments).where(eq(docComments.id, id));
  return NextResponse.json({ ok: true });
}
