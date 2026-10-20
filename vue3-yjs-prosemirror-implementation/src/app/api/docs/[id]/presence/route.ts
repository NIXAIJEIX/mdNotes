import { NextResponse } from "next/server";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { docPresence } from "@/db/schema";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ACTIVE_WINDOW_MS = 15_000;

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/docs/:id/presence —— awareness 心跳。
 * ws 场景下 awareness 存网关内存;这里用心跳表 + 过期窗口模拟。
 * body: { clientId, name, color },返回当前在线协作者列表。
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as {
    clientId?: string;
    name?: string;
    color?: string;
    leaving?: boolean;
  } | null;

  if (!body?.clientId) {
    return NextResponse.json({ error: "clientId required" }, { status: 400 });
  }

  const clientId = String(body.clientId).slice(0, 64);

  if (body.leaving) {
    await db
      .delete(docPresence)
      .where(
        and(eq(docPresence.docId, id), eq(docPresence.clientId, clientId)),
      );
    return NextResponse.json({ users: [] });
  }

  const name = (body.name || "访客").slice(0, 40);
  const color = /^#[0-9a-fA-F]{6}$/.test(body.color || "")
    ? (body.color as string)
    : "#3370ff";

  await db
    .insert(docPresence)
    .values({ docId: id, clientId, name, color })
    .onConflictDoUpdate({
      target: [docPresence.docId, docPresence.clientId],
      set: { name, color, lastSeen: sql`now()` },
    });

  const cutoff = new Date(Date.now() - ACTIVE_WINDOW_MS);

  // 顺手清理过期会话
  await db
    .delete(docPresence)
    .where(and(eq(docPresence.docId, id), lt(docPresence.lastSeen, cutoff)));

  const users = await db
    .select({
      clientId: docPresence.clientId,
      name: docPresence.name,
      color: docPresence.color,
    })
    .from(docPresence)
    .where(and(eq(docPresence.docId, id), gt(docPresence.lastSeen, cutoff)));

  return NextResponse.json({ users });
}
