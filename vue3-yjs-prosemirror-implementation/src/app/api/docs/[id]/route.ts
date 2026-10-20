import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/** GET /api/docs/:id —— 文档元信息 */
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const [doc] = await db.select().from(documents).where(eq(documents.id, id));
  if (!doc) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ doc });
}

/** PATCH /api/docs/:id —— 重命名 / 移动知识库层级 / 调整排序 */
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    parentId?: string | null;
    sortOrder?: number;
  };

  const patch: {
    title?: string;
    parentId?: string | null;
    sortOrder?: number;
    updatedAt: Date;
  } = { updatedAt: new Date() };

  if (typeof body.title === "string") {
    patch.title = body.title.trim().slice(0, 200) || "无标题文档";
  }

  if (body.parentId !== undefined) {
    if (body.parentId === null || body.parentId === "") {
      patch.parentId = null;
    } else {
      if (!UUID_RE.test(body.parentId) || body.parentId === id) {
        return NextResponse.json({ error: "invalid parentId" }, { status: 400 });
      }
      // 防止把节点移动到自己的子孙节点下形成环路
      const all = await db
        .select({ id: documents.id, parentId: documents.parentId })
        .from(documents);
      const parentMap = new Map(all.map((row) => [row.id, row.parentId]));
      if (!parentMap.has(body.parentId)) {
        return NextResponse.json({ error: "parent not found" }, { status: 404 });
      }
      let cursor: string | null = body.parentId;
      while (cursor) {
        if (cursor === id) {
          return NextResponse.json(
            { error: "cannot move document into its own descendant" },
            { status: 400 },
          );
        }
        cursor = parentMap.get(cursor) ?? null;
      }
      patch.parentId = body.parentId;
    }
  }

  if (typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)) {
    patch.sortOrder = Math.max(0, Math.floor(body.sortOrder));
  }

  const [doc] = await db
    .update(documents)
    .set(patch)
    .where(eq(documents.id, id))
    .returning();

  if (!doc) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ doc });
}

/** DELETE /api/docs/:id —— 删除(级联清掉子文档、update 日志与评论) */
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  await db.delete(documents).where(eq(documents.id, id));
  return NextResponse.json({ ok: true });
}
