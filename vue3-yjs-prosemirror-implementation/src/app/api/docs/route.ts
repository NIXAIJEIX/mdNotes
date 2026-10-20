import { NextResponse } from "next/server";
import { asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { docUpdates, documents } from "@/db/schema";
import { emptyDocUpdate } from "@/lib/yjs-store";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/docs —— 知识库全部文档(按层级排序字段 + 创建时间返回) */
export async function GET() {
  const rows = await db
    .select()
    .from(documents)
    .orderBy(asc(documents.sortOrder), asc(documents.createdAt));
  return NextResponse.json({ docs: rows });
}

/** POST /api/docs —— 新建根文档或子文档(支持 parentId) */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    parentId?: string | null;
  };
  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim().slice(0, 200)
      : "无标题文档";

  let parentId: string | null = null;
  if (typeof body.parentId === "string" && body.parentId.trim()) {
    if (!UUID_RE.test(body.parentId)) {
      return NextResponse.json({ error: "invalid parentId" }, { status: 400 });
    }
    const [parent] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.id, body.parentId));
    if (!parent) {
      return NextResponse.json({ error: "parent not found" }, { status: 404 });
    }
    parentId = parent.id;
  }

  const [{ maxOrder }] = await db
    .select({
      maxOrder: sql<number>`coalesce(max(${documents.sortOrder}), -1)::int`,
    })
    .from(documents)
    .where(
      parentId ? eq(documents.parentId, parentId) : isNull(documents.parentId),
    );

  const [doc] = await db
    .insert(documents)
    .values({
      title,
      parentId,
      sortOrder: (maxOrder ?? -1) + 1,
    })
    .returning();

  await db.insert(docUpdates).values({ docId: doc.id, data: emptyDocUpdate() });

  return NextResponse.json({ doc }, { status: 201 });
}
