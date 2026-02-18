import { $createHeadingNode, $isHeadingNode } from "@lexical/rich-text";
import {
  $createRangeSelection,
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";

import type { Block } from "@/lib/editor-types";
import { createBlock, normalizeBlocksForEditor, serializeBlocksToMarkdown } from "@/lib/markdown";
import { normalizeBlockHtml } from "@/lib/editor-selection";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function isLexicalElementEmpty(node: ElementNode): boolean {
  return node.getTextContent().replace(/\u00a0/g, " ").trim().length === 0;
}

function resolveTopLevelBlockType(node: LexicalNode, index: number): Block["type"] {
  if (index === 0) {
    return "title";
  }

  if ($isHeadingNode(node)) {
    return node.getTag() === "h3" ? "heading2" : "heading1";
  }

  return "paragraph";
}

function applyInlineFormats(text: string, formats: { bold: boolean; italic: boolean; underline: boolean }): string {
  let formatted = escapeHtml(text);

  if (formats.bold) {
    formatted = `<strong>${formatted}</strong>`;
  }

  if (formats.italic) {
    formatted = `<em>${formatted}</em>`;
  }

  if (formats.underline) {
    formatted = `<u>${formatted}</u>`;
  }

  return formatted;
}

function inlineHtmlFromNode(node: LexicalNode): string {
  if ($isTextNode(node)) {
    return applyInlineFormats(node.getTextContent(), {
      bold: node.hasFormat("bold"),
      italic: node.hasFormat("italic"),
      underline: node.hasFormat("underline"),
    });
  }

  if ($isLineBreakNode(node)) {
    return "<br>";
  }

  if ($isElementNode(node)) {
    return node.getChildren().map((child) => inlineHtmlFromNode(child)).join("");
  }

  return "";
}

interface InlineFormatState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

const EMPTY_INLINE_FORMATS: InlineFormatState = {
  bold: false,
  italic: false,
  underline: false,
};

function appendTextWithFormats(parent: ElementNode, text: string, formats: InlineFormatState): void {
  const segments = text.replace(/\u00a0/g, " ").split("\n");

  segments.forEach((segment, index) => {
    if (segment.length > 0) {
      const textNode = $createTextNode(segment);

      if (formats.bold) {
        textNode.toggleFormat("bold");
      }

      if (formats.italic) {
        textNode.toggleFormat("italic");
      }

      if (formats.underline) {
        textNode.toggleFormat("underline");
      }

      parent.append(textNode);
    }

    if (index < segments.length - 1) {
      parent.append($createLineBreakNode());
    }
  });
}

function appendDomChildrenToElement(parent: ElementNode, children: NodeListOf<ChildNode>, formats: InlineFormatState): void {
  Array.from(children).forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      appendTextWithFormats(parent, child.textContent ?? "", formats);
      return;
    }

    if (child.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const element = child as HTMLElement;
    const tag = element.tagName.toLowerCase();

    if (tag === "br") {
      parent.append($createLineBreakNode());
      return;
    }

    const nextFormats: InlineFormatState = {
      bold: formats.bold || tag === "strong" || tag === "b",
      italic: formats.italic || tag === "em" || tag === "i",
      underline: formats.underline || tag === "u",
    };

    appendDomChildrenToElement(parent, element.childNodes, nextFormats);
  });
}

function topLevelNodeForBlockType(type: Block["type"]): ElementNode {
  if (type === "title") {
    return $createHeadingNode("h1");
  }

  if (type === "heading1") {
    return $createHeadingNode("h2");
  }

  if (type === "heading2") {
    return $createHeadingNode("h3");
  }

  return $createParagraphNode();
}

function blockTypeForHeadingTag(node: ElementNode, index: number): Block["type"] {
  if (index === 0) {
    return "title";
  }

  if ($isHeadingNode(node) && node.getTag() === "h3") {
    return "heading2";
  }

  return "heading1";
}

export function readBlocksFromLexicalRoot(): Block[] {
  const root = $getRoot();
  const blocks: Block[] = [];

  root.getChildren().forEach((node, index) => {
    if (!$isElementNode(node)) {
      return;
    }

    let type: Block["type"];
    if ($isHeadingNode(node)) {
      type = blockTypeForHeadingTag(node, index);
    } else {
      type = resolveTopLevelBlockType(node, index);
    }

    const inlineHtml = node.getChildren().map((child) => inlineHtmlFromNode(child)).join("");

    blocks.push({
      id: node.getKey(),
      type,
      text: normalizeBlockHtml(inlineHtml),
    });
  });

  return normalizeBlocksForEditor(blocks);
}

export function writeBlocksToLexicalRoot(inputBlocks: Block[]): void {
  const root = $getRoot();
  const blocks = normalizeBlocksForEditor(inputBlocks);
  root.clear();

  blocks.forEach((block) => {
    const topLevelNode = topLevelNodeForBlockType(block.type);

    if (typeof document !== "undefined" && block.text.trim().length > 0) {
      const parserHost = document.createElement("div");
      parserHost.innerHTML = block.text;
      appendDomChildrenToElement(topLevelNode, parserHost.childNodes, EMPTY_INLINE_FORMATS);
    }

    root.append(topLevelNode);
  });

  ensureLexicalManuscriptStructure();
}

function convertElementNodeType(node: ElementNode, type: "title" | "heading1" | "heading2" | "paragraph"): ElementNode {
  const replacement =
    type === "title"
      ? $createHeadingNode("h1")
      : type === "heading1"
        ? $createHeadingNode("h2")
        : type === "heading2"
          ? $createHeadingNode("h3")
        : $createParagraphNode();

  replacement.append(...node.getChildren());
  node.replace(replacement);
  return replacement;
}

export function lexicalManuscriptNeedsFix(): boolean {
  const root = $getRoot();
  const first = root.getFirstChild();

  if (!first || !$isElementNode(first)) {
    return true;
  }

  if (!$isHeadingNode(first) || first.getTag() !== "h1") {
    return true;
  }

  if (!first.getNextSibling()) {
    return true;
  }

  let sibling = first.getNextSibling();
  while (sibling) {
    if (!$isElementNode(sibling)) {
      return true;
    }

    if ($isHeadingNode(sibling) && sibling.getTag() === "h1") {
      return true;
    }

    sibling = sibling.getNextSibling();
  }

  return false;
}

export function ensureLexicalManuscriptStructure(): void {
  const root = $getRoot();

  root.getChildren().forEach((child) => {
    if (!$isElementNode(child)) {
      child.remove();
    }
  });

  let first = root.getFirstChild();

  if (!first || !$isElementNode(first)) {
    const title = $createHeadingNode("h1");
    root.clear();
    root.append(title);
    first = title;
  } else if (!$isHeadingNode(first) || first.getTag() !== "h1") {
    first = convertElementNodeType(first, "title");
  }

  let sibling = first.getNextSibling();
  while (sibling) {
    const current = sibling;
    sibling = sibling.getNextSibling();

    if (!$isElementNode(current)) {
      current.remove();
      continue;
    }

    if ($isHeadingNode(current) && current.getTag() === "h1") {
      convertElementNodeType(current, "heading1");
    }
  }

  if (!first.getNextSibling()) {
    first.insertAfter($createParagraphNode());
  }
}

function topLevelSelectionNodes(): ElementNode[] {
  const root = $getRoot();
  const selection = $getSelection();

  if (!$isRangeSelection(selection)) {
    return [];
  }

  const selected = new Map<string, ElementNode>();

  const markNode = (node: LexicalNode) => {
    const top = node.getTopLevelElement();

    if (!top || top.getParent() !== root || !$isElementNode(top)) {
      return;
    }

    selected.set(top.getKey(), top);
  };

  selection.getNodes().forEach(markNode);
  markNode(selection.anchor.getNode());
  markNode(selection.focus.getNode());

  return Array.from(selected.values());
}

export function setSelectedTopLevelBlocksToType(type: "heading1" | "heading2" | "paragraph"): void {
  const root = $getRoot();
  const first = root.getFirstChild();
  const topNodes = topLevelSelectionNodes();

  topNodes.forEach((node) => {
    if (first && node.is(first)) {
      return;
    }

    if (type === "heading1") {
      if ($isHeadingNode(node) && node.getTag() === "h2") {
        return;
      }

      convertElementNodeType(node, "heading1");
      return;
    }

    if (type === "heading2") {
      if ($isHeadingNode(node) && node.getTag() === "h3") {
        return;
      }

      convertElementNodeType(node, "heading2");
      return;
    }

    if ($isParagraphNode(node)) {
      return;
    }

    convertElementNodeType(node, "paragraph");
  });

  ensureLexicalManuscriptStructure();
}

export function selectionTouchesTitleBlock(): boolean {
  const selection = $getSelection();

  if (!$isRangeSelection(selection)) {
    return false;
  }

  const titleNode = $getRoot().getFirstChild();

  if (!titleNode || !$isElementNode(titleNode)) {
    return false;
  }

  const titleKey = titleNode.getKey();
  const topLevelMatchesTitle = (node: LexicalNode): boolean =>
    node.getTopLevelElement()?.getKey() === titleKey;

  if (topLevelMatchesTitle(selection.anchor.getNode()) || topLevelMatchesTitle(selection.focus.getNode())) {
    return true;
  }

  return selection.getNodes().some((node) => topLevelMatchesTitle(node));
}

export function tryHandleEnterInTitle(): boolean {
  const selection = $getSelection();

  if (!$isRangeSelection(selection)) {
    return false;
  }

  const root = $getRoot();
  const first = root.getFirstChild();

  if (!first || !$isElementNode(first)) {
    return false;
  }

  const activeTopLevel = selection.anchor.getNode().getTopLevelElement();

  if (!activeTopLevel || !activeTopLevel.is(first)) {
    return false;
  }

  const second = first.getNextSibling();
  const isOnlyStarterParagraph =
    !!second &&
    !second.getNextSibling() &&
    $isParagraphNode(second) &&
    isLexicalElementEmpty(second);

  if (isOnlyStarterParagraph) {
    second.selectStart();
    return true;
  }

  const nextParagraph = $createParagraphNode();
  if (second && $isElementNode(second)) {
    second.insertBefore(nextParagraph);
  } else {
    first.insertAfter(nextParagraph);
  }

  nextParagraph.selectStart();
  return true;
}

export function selectCurrentTopLevelBlockContent(editor: LexicalEditor): void {
  editor.update(() => {
    const selection = $getSelection();

    if (!$isRangeSelection(selection)) {
      return;
    }

    const top = selection.anchor.getNode().getTopLevelElement();
    if (!top || top.getParent() !== $getRoot() || !$isElementNode(top)) {
      return;
    }

    selectElementContent(top);
  });
}

function selectElementContent(element: ElementNode): void {
  const textNodes = element.getAllTextNodes();

  if (!textNodes.length) {
    element.selectStart();
    return;
  }

  const firstText = textNodes[0];
  const lastText = textNodes[textNodes.length - 1];
  const rangeSelection = $createRangeSelection();

  rangeSelection.anchor.set(firstText.getKey(), 0, "text");
  rangeSelection.focus.set(lastText.getKey(), lastText.getTextContentSize(), "text");
  $setSelection(rangeSelection);
}

export function selectTopLevelBlockContentByKey(blockKey: string): boolean {
  const root = $getRoot();
  const target = root.getChildren().find(
    (node): node is ElementNode => $isElementNode(node) && node.getKey() === blockKey,
  );

  if (!target) {
    return false;
  }

  selectElementContent(target);
  return true;
}

export function markdownFromBlocksForCompare(blocks: Block[]): string {
  return serializeBlocksToMarkdown(normalizeBlocksForEditor(blocks));
}

export function createInitialBlocks(): Block[] {
  return [createBlock("title"), createBlock("paragraph")];
}

export function titleBlockIsEmpty(): boolean {
  const first = $getRoot().getFirstChild();

  if (!first || !$isElementNode(first)) {
    return true;
  }

  return isLexicalElementEmpty(first);
}

export function restoreTitleBlockFromHtml(html: string): boolean {
  const first = $getRoot().getFirstChild();

  if (!first || !$isElementNode(first)) {
    return false;
  }

  let titleNode: ElementNode = first;
  if (!$isHeadingNode(first) || first.getTag() !== "h1") {
    titleNode = convertElementNodeType(first, "title");
  }

  titleNode.clear();

  if (typeof document !== "undefined" && html.trim().length > 0) {
    const parserHost = document.createElement("div");
    parserHost.innerHTML = html;
    appendDomChildrenToElement(titleNode, parserHost.childNodes, EMPTY_INLINE_FORMATS);
  }

  ensureLexicalManuscriptStructure();
  titleNode.selectEnd();
  return true;
}
