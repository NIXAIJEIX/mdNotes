import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "云文档 · 在线协同编辑",
  description: "基于 Yjs + ProseMirror 的多人实时协同文档",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-slate-100 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
