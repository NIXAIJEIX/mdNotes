import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { appendUpdate, fetchUpdatesAfter } from "@/lib/yjs-store";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/docs/:id/sync?after=<seq>
 * 等价于 ws 协议里的 SyncStep1/SyncStep2:
 * 客户端报出已消费位置,服务端回放之后的所有 update。
 */
export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const [doc] = await db
    .select({ id: documents.id, title: documents.title })
    .from(documents)
    .where(eq(documents.id, id));
  if (!doc) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const after = Number(url.searchParams.get("after") ?? "0");
  const updates = await fetchUpdatesAfter(
    id,
    Number.isFinite(after) && after > 0 ? after : 0,
  );

  return NextResponse.json({
    title: doc.title,
    updates,
    lastSeq: updates.length ? updates[updates.length - 1].seq : after,
  });
}

/**
 * POST /api/docs/:id/sync  body: { update: base64 }
 * 等价于 ws 协议里客户端上行的 update 帧,服务端落日志后"广播"
 * (其他客户端在下一次增量拉取时收到)。
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as {
    update?: string;
  } | null;
  if (!body?.update || typeof body.update !== "string") {
    return NextResponse.json({ error: "update required" }, { status: 400 });
  }
  if (body.update.length > 2_000_000) {
    return NextResponse.json({ error: "update too large" }, { status: 413 });
  }

  try {
    const seq = await appendUpdate(id, body.update);
    return NextResponse.json({ seq });
  } catch {
    return NextResponse.json({ error: "invalid yjs update" }, { status: 400 });
  }
}
