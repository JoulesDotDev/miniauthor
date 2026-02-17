export interface SelectionOffsets {
  start: number;
  end: number;
}

export function normalizePlainText(text: string): string {
  return text.replace(/\r/g, "").replace(/\n$/, "");
}

export function normalizeBlockHtml(rawHtml: string): string {
  let normalized = rawHtml
    .replace(/\r/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/<div>/gi, "")
    .replace(/<\/div>/gi, "<br>")
    .replace(/<p>/gi, "")
    .replace(/<\/p>/gi, "<br>");

  if (/^(<br\s*\/?>|\s|&nbsp;)*$/i.test(normalized)) {
    return "";
  }

  normalized = normalized.replace(/(<br\s*\/?>)+$/gi, "");

  return normalized;
}

export function getSelectionOffsets(element: HTMLElement): SelectionOffsets | null {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);

  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) {
    return null;
  }

  const startRange = range.cloneRange();
  startRange.selectNodeContents(element);
  startRange.setEnd(range.startContainer, range.startOffset);

  const endRange = range.cloneRange();
  endRange.selectNodeContents(element);
  endRange.setEnd(range.endContainer, range.endOffset);

  return {
    start: startRange.toString().length,
    end: endRange.toString().length,
  };
}

function resolveTextPosition(root: HTMLElement, offset: number): { node: Node; offset: number } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let traversed = 0;
  let node = walker.nextNode();

  while (node) {
    const length = node.textContent?.length ?? 0;

    if (offset <= traversed + length) {
      return {
        node,
        offset: Math.max(0, Math.min(length, offset - traversed)),
      };
    }

    traversed += length;
    node = walker.nextNode();
  }

  return {
    node: root,
    offset: root.childNodes.length,
  };
}

export function setSelectionOffsets(element: HTMLElement, start: number, end = start): void {
  const selection = window.getSelection();

  if (!selection) {
    return;
  }

  const normalizedStart = Math.max(0, start);
  const normalizedEnd = Math.max(0, end);
  const startPosition = resolveTextPosition(element, normalizedStart);
  const endPosition = resolveTextPosition(element, normalizedEnd);

  const range = document.createRange();
  range.setStart(startPosition.node, startPosition.offset);
  range.setEnd(endPosition.node, endPosition.offset);

  selection.removeAllRanges();
  selection.addRange(range);
}

export function blockIdFromNode(node: Node | null): string | null {
  let current: Node | null = node;

  while (current) {
    if (current instanceof HTMLElement) {
      const blockId = current.dataset.blockId;

      if (blockId) {
        return blockId;
      }
    }

    current = current.parentNode;
  }

  return null;
}
