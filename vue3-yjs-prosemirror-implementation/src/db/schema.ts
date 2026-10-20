import {
  type AnyPgColumn,
  bigserial,
  boolean,
  customType,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** Postgres bytea <-> Node Buffer */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/**
 * 文档元信息。
 * 正文内容不存这里 —— 正文是 Yjs CRDT,存在 doc_updates 的增量日志里,
 * 服务端定期把日志 merge 成快照(同样是一条 update 记录)。
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentId: uuid("parent_id").references(
      (): AnyPgColumn => documents.id,
      { onDelete: "cascade" },
    ),
    sortOrder: integer("sort_order").notNull().default(0),
    title: text("title").notNull().default("无标题文档"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("documents_parent_sort_idx").on(t.parentId, t.sortOrder)],
);

/**
 * Yjs update 追加日志(等价于 ws 网关里广播的二进制 update 帧)。
 * seq 单调递增,客户端用 "after=seq" 增量拉取,等价于基于 state vector 的 diff。
 * data 为 base64 编码的 Yjs update。
 */
export const docUpdates = pgTable(
  "doc_updates",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    docId: uuid("doc_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    data: text("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("doc_updates_doc_id_seq_idx").on(t.docId, t.seq)],
);

/**
 * 评论 / 读书笔记(飞书式)。
 *  - kind = "inline": 划词锚定评论,anchor 存 Yjs 相对位置(base64),
 *    并发编辑下锚点自动跟随文字移动,不会漂移
 *  - kind = "doc": 文末的全文评论
 *  - parentId 非空即为楼中楼回复(同一条锚点上可挂多条评论)
 */
export const docComments = pgTable(
  "doc_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    docId: uuid("doc_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references(
      (): AnyPgColumn => docComments.id,
      { onDelete: "cascade" },
    ),
    kind: text("kind").notNull().default("inline"),
    anchor: text("anchor"),
    quote: text("quote"),
    authorId: text("author_id").notNull(),
    authorName: text("author_name").notNull(),
    authorColor: text("author_color").notNull(),
    body: text("body").notNull(),
    resolved: boolean("resolved").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("doc_comments_doc_created_idx").on(t.docId, t.createdAt),
    index("doc_comments_parent_idx").on(t.parentId),
  ],
);

/**
 * 在线协作者(awareness 的持久化替身)。
 * ws 网关场景下这是内存态,这里用心跳表模拟。
 */
export const docPresence = pgTable(
  "doc_presence",
  {
    docId: uuid("doc_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    name: text("name").notNull(),
    color: text("color").notNull(),
    lastSeen: timestamp("last_seen", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.docId, t.clientId] })],
);

/**
 * 评论点赞。一人一评论一次,PK 天然去重,toggle 即 insert/delete。
 */
export const commentLikes = pgTable(
  "comment_likes",
  {
    commentId: uuid("comment_id")
      .notNull()
      .references(() => docComments.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.commentId, t.userId] })],
);

/**
 * 评论里粘贴/拖入的图片。
 *
 * 单租户独立部署下先落 Postgres(bytea),省掉对象存储依赖;
 * 接 S3 时只要把 data 换成 objectKey、在 /api/attachments/[id] 里改成
 * 302 到预签名 URL 即可,上层调用方不用动。
 */
export const attachments = pgTable("attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  data: bytea("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
