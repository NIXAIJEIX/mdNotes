"use client";

import { createLowlight } from "lowlight";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import python from "highlight.js/lib/languages/python";
import java from "highlight.js/lib/languages/java";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import php from "highlight.js/lib/languages/php";
import ruby from "highlight.js/lib/languages/ruby";
import sql from "highlight.js/lib/languages/sql";
import yaml from "highlight.js/lib/languages/yaml";
import markdown from "highlight.js/lib/languages/markdown";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import nginx from "highlight.js/lib/languages/nginx";
import plaintext from "highlight.js/lib/languages/plaintext";

/**
 * 语法高亮实例。只注册常用语言(而不是 lowlight/all),
 * 让首屏 JS 体积可控 —— 打开速度优先。
 */
export const lowlight = createLowlight({
  javascript,
  typescript,
  xml,
  css,
  json,
  bash,
  python,
  java,
  go,
  rust,
  c,
  cpp,
  csharp,
  php,
  ruby,
  sql,
  yaml,
  markdown,
  dockerfile,
  nginx,
  plaintext,
});

/** 代码块语言选择器(与上面注册的语言一一对应) */
export const CODE_LANGUAGES: { value: string; label: string }[] = [
  { value: "plaintext", label: "纯文本" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "xml", label: "HTML / XML" },
  { value: "css", label: "CSS" },
  { value: "json", label: "JSON" },
  { value: "bash", label: "Shell / Bash" },
  { value: "python", label: "Python" },
  { value: "java", label: "Java" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
  { value: "c", label: "C" },
  { value: "cpp", label: "C++" },
  { value: "csharp", label: "C#" },
  { value: "php", label: "PHP" },
  { value: "ruby", label: "Ruby" },
  { value: "sql", label: "SQL" },
  { value: "yaml", label: "YAML" },
  { value: "markdown", label: "Markdown" },
  { value: "dockerfile", label: "Dockerfile" },
  { value: "nginx", label: "Nginx" },
];

export const LANGUAGE_LABEL: Record<string, string> = Object.fromEntries(
  CODE_LANGUAGES.map((l) => [l.value, l.label]),
);
