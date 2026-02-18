import type { Block, BlockType } from "@/lib/editor-types";

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

export function normalizeBlocksForEditor(blocks: Block[]): Block[] {
  if (!blocks.length) {
    return [createBlock("title"), createBlock("paragraph")];
  }

  let changed = false;
  let titleSeen = false;

  const sanitized: Block[] = [];

  for (const block of blocks as Array<{ id?: string; type?: string; text?: string }>) {
    const rawType = block.type;
    let nextType: BlockType | null = null;

    if (
      rawType === "title" ||
      rawType === "heading1" ||
      rawType === "heading2" ||
      rawType === "paragraph"
    ) {
      nextType = rawType;
    } else if (rawType === "heading") {
      // Backward compatibility with early development snapshots.
      nextType = "heading1";
      changed = true;
    } else {
      changed = true;
      continue;
    }

    if (nextType === "title") {
      if (titleSeen) {
        nextType = "heading1";
        changed = true;
      } else {
        titleSeen = true;
      }
    }

    const id = typeof block.id === "string" ? block.id : createId();
    const text = typeof block.text === "string" ? block.text : "";

    if (id !== block.id || text !== block.text || nextType !== rawType) {
      changed = true;
    }

    sanitized.push({
      id,
      type: nextType,
      text,
    });
  }

  const titleIndex = sanitized.findIndex((block) => block.type === "title");

  if (titleIndex === -1) {
    sanitized.unshift(createBlock("title"));
    changed = true;
  } else if (titleIndex > 0) {
    const [title] = sanitized.splice(titleIndex, 1);
    sanitized.unshift(title);
    changed = true;
  }

  if (sanitized.length === 1) {
    sanitized.push(createBlock("paragraph"));
    changed = true;
  }

  if (!changed && sanitized.length === blocks.length) {
    return blocks;
  }

  return sanitized;
}

function serializeBlocks(blocks: Block[], ensureSingleTitle: boolean): string {
  const source = ensureSingleTitle ? normalizeBlocksForEditor(blocks) : blocks;

  const markdownBlocks = source.map((block) => {
    const markdownInline = htmlInlineToMarkdown(block.text).trim();

    if (block.type === "title") {
      return `# ${markdownInline}`.trim();
    }

    if (block.type === "heading1") {
      return `## ${markdownInline}`.trim();
    }

    if (block.type === "heading2") {
      return `### ${markdownInline}`.trim();
    }

    return markdownInline;
  });

  return markdownBlocks.join("\n\n").trimEnd();
}

export function parseMarkdownToBlocks(markdown: string): Block[] {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();

  if (!normalized) {
    return [createBlock("title"), createBlock("paragraph")];
  }

  const chunks = normalized.split(/\n{2,}/g);
  const blocks: Block[] = [];
  let titleSeen = false;

  for (const chunk of chunks) {
    const trimmed = chunk.trim();

    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith("# ")) {
      const titleText = normalizeInlineMarkdown(trimmed.slice(2).trim());

      if (!titleSeen) {
        blocks.push(createBlock("title", titleText));
        titleSeen = true;
      } else {
        blocks.push(createBlock("heading1", titleText));
      }

      continue;
    }

    if (trimmed.startsWith("### ")) {
      blocks.push(createBlock("heading2", normalizeInlineMarkdown(trimmed.slice(4).trim())));
      continue;
    }

    if (trimmed.startsWith("## ")) {
      blocks.push(createBlock("heading1", normalizeInlineMarkdown(trimmed.slice(3).trim())));
      continue;
    }

    blocks.push(createBlock("paragraph", normalizeInlineMarkdown(chunk)));
  }

  return normalizeBlocksForEditor(blocks);
}

export function serializeBlocksToMarkdown(blocks: Block[]): string {
  return serializeBlocks(blocks, true);
}

export function splitBlocksToMarkdownPages(blocks: Block[]): string[] {
  const normalized = normalizeBlocksForEditor(blocks);
  const pages: string[] = [];
  let currentPage: Block[] = [];

  for (const block of normalized) {
    if (block.type === "heading1" && currentPage.length > 0) {
      pages.push(serializeBlocks(currentPage, false));
      currentPage = [];
    }

    currentPage.push(block);
  }

  if (currentPage.length) {
    pages.push(serializeBlocks(currentPage, false));
  }

  return pages.length ? pages : [serializeBlocks(normalized, true)];
}

export function joinMarkdownPagesToDocument(pages: string[]): string {
  if (!pages.length) {
    return "";
  }

  return pages.join("\n\n").trimEnd();
}
