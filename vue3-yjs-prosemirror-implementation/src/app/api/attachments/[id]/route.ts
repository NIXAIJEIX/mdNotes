import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/attachments/:id —— 读图(内容不可变,长缓存) */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return new Response("invalid id", { status: 400 });

  const [row] = await db
    .select({
      mime: attachments.mime,
      data: attachments.data,
      size: attachments.size,
    })
    .from(attachments)
    .where(eq(attachments.id, id));

  if (!row) return new Response("not found", { status: 404 });

  const body = new Uint8Array(row.data);
  return new Response(body, {
    headers: {
      "Content-Type": row.mime,
      "Content-Length": String(row.size),
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
