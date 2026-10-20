"use client";

import { useCallback, useRef, useState } from "react";

async function uploadImage(file: File): Promise<string> {
  const res = await fetch("/api/uploads", {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!res.ok) {
    const info = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(info.error ?? `上传失败 (${res.status})`);
  }
  const json = (await res.json()) as { url: string };
  return json.url;
}

/**
 * 评论输入框。
 *
 * 刻意保持为纯 textarea:没有 Markdown 工具栏、预览按钮或公式按钮。
 * 用户可直接粘贴 AI 生成的 Markdown / LaTeX 原文,发布后由 MarkdownView 渲染。
 * 粘贴/拖入图片仍自动上传并在光标处写入 Markdown 图片语法。
 */
export default function CommentComposer({
  autoFocus,
  placeholder,
  submitLabel = "发布",
  onSubmit,
  onCancel,
}: {
  autoFocus?: boolean;
  placeholder: string;
  submitLabel?: string;
  onSubmit: (body: string) => Promise<void> | void;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  const insertAtCaret = useCallback((text: string) => {
    const ta = ref.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    setValue((prev) => {
      const next = prev.slice(0, start) + text + prev.slice(end);
      requestAnimationFrame(() => {
        ta.focus();
        const caret = start + text.length;
        ta.setSelectionRange(caret, caret);
      });
      return next;
    });
  }, []);

  const handleFiles = useCallback(
    async (files: File[]) => {
      const images = files.filter((file) => file.type.startsWith("image/"));
      if (images.length === 0) return;
      setError(null);
      setUploading((count) => count + images.length);

      for (const file of images) {
        const token = `![上传中 ${file.name || "图片"}…]()`;
        insertAtCaret(`${token}\n`);
        try {
          const url = await uploadImage(file);
          setValue((prev) =>
            prev.replace(token, `![${file.name || "图片"}](${url})`),
          );
        } catch (reason) {
          setValue((prev) => prev.replace(`${token}\n`, ""));
          setError(reason instanceof Error ? reason.message : "图片上传失败");
        } finally {
          setUploading((count) => Math.max(0, count - 1));
        }
      }
    },
    [insertAtCaret],
  );

  const submit = async () => {
    const body = value.trim();
    if (!body || busy || uploading > 0) return;
    setBusy(true);
    try {
      await onSubmit(body);
      setValue("");
      setError(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2">
      <textarea
        ref={ref}
        autoFocus={autoFocus}
        value={value}
        rows={3}
        placeholder={placeholder}
        onChange={(event) => setValue(event.target.value)}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files);
          if (!files.some((file) => file.type.startsWith("image/"))) return;
          event.preventDefault();
          void handleFiles(files);
        }}
        onDrop={(event) => {
          const files = Array.from(event.dataTransfer.files);
          if (!files.some((file) => file.type.startsWith("image/"))) return;
          event.preventDefault();
          void handleFiles(files);
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
          if (event.key === "Escape" && onCancel) onCancel();
        }}
        className="w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] leading-5 outline-none transition focus:border-[#3370ff] focus:ring-2 focus:ring-[#3370ff]/10"
      />

      {error && <p className="mt-1 text-[11px] text-red-500">{error}</p>}

      <div className="mt-1.5 flex items-center justify-between gap-3">
        <span className="truncate text-[11px] text-gray-300">
          {uploading > 0
            ? `正在上传 ${uploading} 张图片…`
            : "可直接粘贴 Markdown、LaTeX 公式或图片"}
        </span>
        <div className="flex shrink-0 gap-2">
          {onCancel && (
            <button
              onClick={onCancel}
              className="rounded-md px-2.5 py-1 text-[12px] text-gray-500 transition hover:bg-gray-100"
            >
              取消
            </button>
          )}
          <button
            onClick={() => void submit()}
            disabled={!value.trim() || busy || uploading > 0}
            className="rounded-md bg-[#3370ff] px-3 py-1 text-[12px] font-medium text-white transition hover:bg-[#2b5fe0] disabled:opacity-40"
          >
            {busy ? "发布中…" : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
