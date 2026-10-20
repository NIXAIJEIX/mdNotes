"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

/**
 * 评论正文渲染:Markdown(GFM)+ 数学公式(KaTeX)。
 *
 * 安全性:react-markdown 默认不渲染原始 HTML(未启用 rehype-raw),
 * 所以用户输入里的 <script>/<img onerror> 一律按纯文本处理,无 XSS 面。
 * 图片只允许站内 /api/attachments/ 与 http(s),其余一律降级为链接文本。
 */
function MarkdownViewImpl({
  content,
  compact = false,
}: {
  content: string;
  compact?: boolean;
}) {
  return (
    <div className={`md-body${compact ? " md-compact" : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              onClick={(e) => e.stopPropagation()}
            >
              {children}
            </a>
          ),
          img: ({ src, alt }) => {
            const url = typeof src === "string" ? src : "";
            const safe =
              url.startsWith("/api/attachments/") ||
              url.startsWith("https://") ||
              url.startsWith("http://");
            if (!safe) return <span>{alt || "图片"}</span>;
            return (
              // 评论图片尺寸不可预知,用原生 img 配 CSS 约束即可
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt={alt ?? "图片"}
                loading="lazy"
                className="md-img"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(url, "_blank", "noopener");
                }}
              />
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownView = memo(MarkdownViewImpl);
