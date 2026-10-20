import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { fetchUpdatesAfter } from "@/lib/yjs-store";
import DocEditor from "@/components/doc-editor";
import type { DocMeta } from "@/lib/kb-tree";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DocPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  // 元信息 + 初始 update 日志 + 知识库列表并行返回，首屏零额外请求
  const [[doc], updates, allDocs] = await Promise.all([
    db.select().from(documents).where(eq(documents.id, id)),
    fetchUpdatesAfter(id, 0),
    db
      .select()
      .from(documents)
      .orderBy(asc(documents.sortOrder), asc(documents.createdAt)),
  ]);
  if (!doc) notFound();

  const initialSeq = updates.length ? updates[updates.length - 1].seq : 0;
  const serializedDocs: DocMeta[] = allDocs.map((d) => ({
    id: d.id,
    parentId: d.parentId ?? null,
    sortOrder: d.sortOrder ?? 0,
    title: d.title,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  }));

  return (
    <DocEditor
      docId={doc.id}
      initialTitle={doc.title}
      initialUpdates={updates}
      initialSeq={initialSeq}
      initialDocs={serializedDocs}
    />
  );
}
