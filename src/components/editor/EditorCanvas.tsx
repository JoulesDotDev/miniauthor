import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { X } from "lucide-react";

import type { Block } from "@/lib/editor-types";

interface EditorCanvasProps {
  showChrome: boolean;
  menuLabel: string;
  currentPage: number;
  totalPages: number;
  blocks: Block[];
  onToggleChrome: () => void;
  onPaperRef: (element: HTMLElement | null) => void;
  onFocusBlock: (blockId: string) => void;
  onChangeBlock: (blockId: string, text: string) => void;
  onBlockKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>, block: Block) => void;
  onBlockRef: (blockId: string, element: HTMLDivElement | null) => void;
  onRemovePageBreak: (blockId: string) => void;
}

function placeholderForType(type: Block["type"]): string {
  if (type === "title") {
    return "Main headline";
  }

  if (type === "heading") {
    return "Section headline";
  }

  return "Start writing...";
}

export function EditorCanvas({
  showChrome,
  menuLabel,
  currentPage,
  totalPages,
  blocks,
  onToggleChrome,
  onPaperRef,
  onFocusBlock,
  onChangeBlock,
  onBlockKeyDown,
  onBlockRef,
  onRemovePageBreak,
}: EditorCanvasProps) {
  return (
    <main className="editor-shell">
      <button
        className="floating-toggle"
        type="button"
        onClick={onToggleChrome}
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
      >
        {blocks.map((block) => {
          if (block.type === "page-break") {
            return (
              <div
                key={block.id}
                className="page-break"
                data-page-break="true"
                contentEditable={false}
              >
                {showChrome ? (
                  <button
                    type="button"
                    className="page-break-remove"
                    onClick={() => onRemovePageBreak(block.id)}
                    title="Remove page break"
                    aria-label="Remove page break"
                  >
                    <X size={12} />
                  </button>
                ) : null}
              </div>
            );
          }

          return (
            <div
              key={block.id}
              ref={(element) => onBlockRef(block.id, element)}
              data-block-id={block.id}
              className={`editor-block block-${block.type}`}
              data-placeholder={placeholderForType(block.type)}
              tabIndex={-1}
              onFocus={() => onFocusBlock(block.id)}
              onInput={(event) => onChangeBlock(block.id, event.currentTarget.innerHTML)}
              onKeyDown={(event) => onBlockKeyDown(event, block)}
              dangerouslySetInnerHTML={{ __html: block.text }}
            />
          );
        })}
      </section>
    </main>
  );
}
