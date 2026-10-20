import { NextResponse } from "next/server";
import { db } from "@/db";
import { attachments } from "@/db/schema";

export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
]);

/**
 * POST /api/uploads —— 评论里粘贴/拖入图片
 * body: 原始二进制,Content-Type 即图片 mime
 *
 * 换 S3 时:这里改成 putObject + 返回公开/预签名 URL,其余代码不用动。
 */
export async function POST(req: Request) {
  const mime = (req.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!ALLOWED.has(mime)) {
    return NextResponse.json(
      { error: `unsupported type: ${mime || "unknown"}` },
      { status: 415 },
    );
  }

  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0) {
    return NextResponse.json({ error: "empty body" }, { status: 400 });
  }
  if (buf.length > MAX_BYTES) {
    return NextResponse.json({ error: "image too large (>5MB)" }, { status: 413 });
  }

  const [row] = await db
    .insert(attachments)
    .values({ mime, size: buf.length, data: buf })
    .returning({ id: attachments.id });

  return NextResponse.json(
    { id: row.id, url: `/api/attachments/${row.id}`, size: buf.length },
    { status: 201 },
  );
}
