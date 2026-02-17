import { memo } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import { useEditorChrome } from "@/contexts/EditorChromeContext";
import type { Block } from "@/lib/editor-types";

interface EditorCanvasProps {
  currentPage: number;
  totalPages: number;
  pageStartHeadingIds: Set<string>;
  blocks: Block[];
  onPaperRef: (element: HTMLElement | null) => void;
  onPaperInput: () => void;
  onPaperKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  onFocusBlock: (blockId: string) => void;
  onBlockRef: (blockId: string, element: HTMLDivElement | null) => void;
}

function placeholderForType(type: Block["type"]): string {
  if (type === "title") {
    return "Title";
  }

  if (type === "heading") {
    return "Section headline";
  }

  return "Start writting...";
}

function isBlockTextEmpty(html: string): boolean {
  return html
    .replace(/<br\s*\/?>/gi, "")
    .replace(/<div>/gi, "")
    .replace(/<\/div>/gi, "")
    .replace(/<p>/gi, "")
    .replace(/<\/p>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim().length === 0;
}

function EditorCanvasComponent({
  currentPage,
  totalPages,
  pageStartHeadingIds,
  blocks,
  onPaperRef,
  onPaperInput,
  onPaperKeyDown,
  onFocusBlock,
  onBlockRef,
}: EditorCanvasProps) {
  const { showChrome, menuLabel, toggleChrome } = useEditorChrome();
  const hasSingleStarterParagraph = blocks.length === 2 && blocks[1]?.type === "paragraph";

  return (
    <main className="editor-shell">
      <button
        className="floating-toggle"
        type="button"
        onClick={toggleChrome}
        aria-label="Toggle menu panels"
      >
        {menuLabel}
      </button>

      {showChrome ? <div className="page-indicator">{`${currentPage}/${totalPages}`}</div> : null}

      <section
        className="paper-column"
        ref={onPaperRef}
        contentEditable
        suppressContentEditableWarning
        onInput={onPaperInput}
        onKeyDown={onPaperKeyDown}
      >
        {blocks.map((block, index) => {
          const isPageStart = block.type === "heading" && pageStartHeadingIds.has(block.id);
          const isEmpty = isBlockTextEmpty(block.text);
          const showPlaceholder =
            block.type === "title" ||
            block.type === "heading" ||
            (block.type === "paragraph" && hasSingleStarterParagraph && index === 1);

          return (
            <div
              key={block.id}
              ref={(element) => onBlockRef(block.id, element)}
              data-block-id={block.id}
              data-page-start={isPageStart ? "true" : undefined}
              data-empty={isEmpty ? "true" : undefined}
              className={`editor-block block-${block.type}`}
              data-placeholder={showPlaceholder ? placeholderForType(block.type) : undefined}
              tabIndex={-1}
              onFocus={() => onFocusBlock(block.id)}
              dangerouslySetInnerHTML={{ __html: block.text }}
            />
          );
        })}
      </section>
    </main>
  );
}

export const EditorCanvas = memo(EditorCanvasComponent);
EditorCanvas.displayName = "EditorCanvas";
