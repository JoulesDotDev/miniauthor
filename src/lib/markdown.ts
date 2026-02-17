import type { Block, BlockType } from "@/lib/editor-types";

export const PAGE_BREAK_TOKEN = "<!-- page-break -->";

export function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `block-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createBlock(type: BlockType, text = ""): Block {
  return {
    id: createId(),
    type,
    text,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeInlineMarkdown(markdown: string): string {
  const escaped = escapeHtml(markdown);
  const withUnderline = escaped.replace(/&lt;u&gt;([\s\S]*?)&lt;\/u&gt;/g, "<u>$1</u>");
  const withBoldTokens = withUnderline.replace(/\*\*([^*][\s\S]*?)\*\*/g, "@@BOLD@@$1@@/BOLD@@");
  const withItalicTokens = withBoldTokens.replace(/\*([^*][\s\S]*?)\*/g, "@@ITALIC@@$1@@/ITALIC@@");

  return withItalicTokens
    .replace(/@@BOLD@@/g, "<strong>")
    .replace(/@@\/BOLD@@/g, "</strong>")
    .replace(/@@ITALIC@@/g, "<em>")
    .replace(/@@\/ITALIC@@/g, "</em>")
    .replace(/\n/g, "<br>");
}

function htmlInlineToMarkdown(html: string): string {
  if (!html) {
    return "";
  }

  if (typeof document === "undefined") {
    return html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .trimEnd();
  }

  const container = document.createElement("div");
  container.innerHTML = html;

  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ?? "";
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const element = node as HTMLElement;
    const inner = Array.from(element.childNodes)
      .map((child) => walk(child))
      .join("");

    const tag = element.tagName.toLowerCase();

    if (tag === "br") {
      return "\n";
    }

    if (tag === "strong" || tag === "b") {
      return `**${inner}**`;
    }

    if (tag === "em" || tag === "i") {
      return `*${inner}*`;
    }

    if (tag === "u") {
      return `<u>${inner}</u>`;
    }

    if (tag === "div" || tag === "p") {
      return `${inner}\n`;
    }

    return inner;
  };

  return Array.from(container.childNodes)
    .map((child) => walk(child))
    .join("")
    .replace(/\u00a0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

export function parseMarkdownToBlocks(markdown: string): Block[] {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();

  if (!normalized) {
    return [createBlock("title"), createBlock("paragraph")];
  }

  const chunks = normalized.split(/\n{2,}/g);
  const blocks: Block[] = [];

  for (const chunk of chunks) {
    const trimmed = chunk.trim();

    if (!trimmed) {
      continue;
    }

    if (trimmed === PAGE_BREAK_TOKEN) {
      blocks.push(createBlock("page-break"));
      continue;
    }

    if (trimmed.startsWith("# ")) {
      blocks.push(createBlock("title", normalizeInlineMarkdown(trimmed.slice(2).trim())));
      continue;
    }

    if (trimmed.startsWith("## ")) {
      blocks.push(createBlock("heading", normalizeInlineMarkdown(trimmed.slice(3).trim())));
      continue;
    }

    blocks.push(createBlock("paragraph", normalizeInlineMarkdown(chunk)));
  }

  if (!blocks.length) {
    return [createBlock("title"), createBlock("paragraph")];
  }

  return blocks;
}

export function serializeBlocksToMarkdown(blocks: Block[]): string {
  const markdownBlocks = blocks.map((block) => {
    if (block.type === "page-break") {
      return PAGE_BREAK_TOKEN;
    }

    const markdownInline = htmlInlineToMarkdown(block.text).trim();

    if (block.type === "title") {
      return `# ${markdownInline}`.trim();
    }

    if (block.type === "heading") {
      return `## ${markdownInline}`.trim();
    }

    return markdownInline;
  });

  return markdownBlocks.join("\n\n").trimEnd();
}

export function splitBlocksToMarkdownPages(blocks: Block[]): string[] {
  const pages: string[] = [];
  let currentPage: Block[] = [];

  for (const block of blocks) {
    if (block.type === "page-break") {
      pages.push(serializeBlocksToMarkdown(currentPage));
      currentPage = [];
      continue;
    }

    currentPage.push(block);
  }

  pages.push(serializeBlocksToMarkdown(currentPage));

  return pages;
}

export function joinMarkdownPagesToDocument(pages: string[]): string {
  if (!pages.length) {
    return "";
  }

  return pages.join(`\n\n${PAGE_BREAK_TOKEN}\n\n`).trimEnd();
}
