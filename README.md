# mdNotes
类飞书的在线知识库
### 云文档 · 在线协同编辑器

一个飞书风格的实时协同文档系统，核心技术栈是 **Yjs + ProseMirror**，前端 Vue3 方向，后端 Node.js。

| 能力 | 技术实现 |
| :--- | :--- |
| 多人实时协同 | Yjs CRDT + 自写 WebSocket 网关，单调递增 `seq` 做增量同步 |
| 打开即写 | 服务端内联 update 日志 + 本地 Yjs 快照，首屏不阻塞、接近本地速度 |
| 富文本 | ProseMirror + Tiptap：标题 / 列表 / 引用 / 链接 / 荧光高亮 / 21 种语言代码高亮 |
| **同步块** | 同一 `syncId` 共享一份 `Y.Text`，任一处编辑全局同步（类似变量引用） |
| **划词笔记** | 评论锚点存 Yjs 相对位置，并发编辑下自动跟随，**永不漂移** |
| 评论 | 文末评论 + 划词评论，支持 Markdown / LaTeX 公式 / 粘贴图片 / 点赞 |
| 离线可编辑 | localStorage 快照 + 断线重试，恢复后自动合并 |
| 对象存储 | 评论图片走 S3 兼容接口，附件长期缓存 |

**工程亮点**

- 评论数据与协同正文**完全解耦**：评论不写进 CRDT，用 ProseMirror `Decoration` 本地渲染，因此评论操作不产生任何同步广播
- 评论锚点用 CRDT 相对位置，别人在前后插入文字，锚点自动跟随
- update 日志自动压缩（`Y.mergeUpdates`），快照幂等，长文档不会无限膨胀
- 我主要负责运维侧：Postgres 更新日志索引、压缩策略、S3 生命周期、单租户部署编排

**技术栈**：`Vue3` · `Yjs` · `ProseMirror / Tiptap` · `Node.js` · `PostgreSQL` · `Drizzle ORM` · `S3` · `WebSocket` · `Docker`

## 🛠 技术栈

- **前端**：Vue3 / TypeScript / Vite / ProseMirror / Tiptap / Yjs
- **后端**：Node.js · PostgreSQL · Drizzle ORM · REST API
- **协同**：Yjs CRDT · WebSocket 网关 · ProseMirror 插件
- **基础设施**：S3 兼容对象存储 · Docker · Nginx

## 💭 关注方向

- CRDT 在真实协作场景下的性能与一致性边界
- 协同编辑的持久化设计（增量日志 + 快照压缩）
- 前端「本地级」打开速度优化
- 单租户私有化部署与可观测性

---

📫 欢迎交流协同编辑、CRDT、或者任何有趣的问题。
