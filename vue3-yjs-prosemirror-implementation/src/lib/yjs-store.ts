import * as Y from "yjs";
import { and, asc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { docUpdates, documents } from "@/db/schema";

/**
 * 服务端 Yjs 持久层 —— 对应你自写 ws 网关里的 "persistence adapter"。
 *
 * 协议约定(与 ws 版一致,只是传输层从 ws 帧换成 HTTP):
 *  - 客户端产生的每个 Y.Doc update 以 base64 追加写入 doc_updates(append-only log)
 *  - 客户端带上自己已消费到的 seq 来增量拉取(等价于 state-vector diff)
 *  - 日志超过阈值时服务端用 Y.mergeUpdates 压缩为单条快照,seq 继续单调递增
 */

const COMPACT_THRESHOLD = 80;

export interface UpdateRow {
  seq: number;
  data: string;
}

/** 拉取某文档在 seq 之后的所有增量 update */
export async function fetchUpdatesAfter(
  docId: string,
  after: number,
): Promise<UpdateRow[]> {
  const rows = await db
    .select({ seq: docUpdates.seq, data: docUpdates.data })
    .from(docUpdates)
    .where(and(eq(docUpdates.docId, docId), gt(docUpdates.seq, after)))
    .orderBy(asc(docUpdates.seq));
  return rows;
}

/** 追加一条客户端 update,必要时触发压缩 */
export async function appendUpdate(
  docId: string,
  base64Update: string,
): Promise<number> {
  // 校验是合法的 Yjs update,拒绝脏数据
  const bin = Buffer.from(base64Update, "base64");
  Y.decodeUpdate(bin);

  const [row] = await db
    .insert(docUpdates)
    .values({ docId, data: base64Update })
    .returning({ seq: docUpdates.seq });

  await db
    .update(documents)
    .set({ updatedAt: new Date() })
    .where(eq(documents.id, docId));

  void compactIfNeeded(docId).catch(() => {
    /* 压缩失败不影响写入路径,下次再试 */
  });

  return row.seq;
}

/** update 日志压缩:把 <= maxSeq 的所有 update merge 成一条快照 */
async function compactIfNeeded(docId: string): Promise<void> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(docUpdates)
    .where(eq(docUpdates.docId, docId));

  if (count < COMPACT_THRESHOLD) return;

  const rows = await db
    .select({ seq: docUpdates.seq, data: docUpdates.data })
    .from(docUpdates)
    .where(eq(docUpdates.docId, docId))
    .orderBy(asc(docUpdates.seq));

  if (rows.length < 2) return;

  const merged = Y.mergeUpdates(
    rows.map((r) => new Uint8Array(Buffer.from(r.data, "base64"))),
  );
  const maxSeq = rows[rows.length - 1].seq;
  const seqs = rows.map((r) => r.seq);

  await db.transaction(async (tx) => {
    await tx
      .delete(docUpdates)
      .where(
        and(
          eq(docUpdates.docId, docId),
          lte(docUpdates.seq, maxSeq),
          inArray(docUpdates.seq, seqs),
        ),
      );
    // 快照也是一条普通 update,新 seq 比历史都大;
    // 已经消费过这些 seq 的客户端重复 apply 快照是幂等的(CRDT 性质)。
    await tx.insert(docUpdates).values({
      docId,
      data: Buffer.from(merged).toString("base64"),
    });
  });
}

/** 新建文档时写入一条空的初始 update,保证首次 sync 有内容可拉 */
export function emptyDocUpdate(): string {
  const doc = new Y.Doc();
  // Collaboration 扩展默认使用 "default" 这个 XmlFragment
  doc.getXmlFragment("default");
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return Buffer.from(update).toString("base64");
}
