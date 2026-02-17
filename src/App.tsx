import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  Bold,
  Heading1,
  Heading2,
  Italic,
  Minus,
  Pilcrow,
  Underline,
} from "lucide-react";

import { ConflictModal } from "@/components/editor/ConflictModal";
import { EditorCanvas } from "@/components/editor/EditorCanvas";
import { SyncPanel } from "@/components/editor/SyncPanel";
import { WritingPanel } from "@/components/editor/WritingPanel";
import { useDropboxSync } from "@/hooks/useDropboxSync";
import type { Block, BlockType } from "@/lib/editor-types";
import { buildSideBySideDiffRows } from "@/lib/merge";
import {
  createBlock,
  serializeBlocksToMarkdown,
  splitBlocksToMarkdownPages,
} from "@/lib/markdown";

interface SelectionOffsets {
  start: number;
  end: number;
}

function formatTime(timestamp: number | null): string {
  if (!timestamp) {
    return "Never";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

function normalizePlainText(text: string): string {
  return text.replace(/\r/g, "").replace(/\n$/, "");
}

function normalizeBlockHtml(rawHtml: string): string {
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

function getSelectionOffsets(element: HTMLElement): SelectionOffsets | null {
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

function setSelectionOffsets(element: HTMLElement, start: number, end = start): void {
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

function blockIdFromNode(node: Node | null): string | null {
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

export function App() {
  const dropboxAppKey = import.meta.env.VITE_DROPBOX_APP_KEY as string | undefined;
  const dropboxRedirectUri =
    (import.meta.env.VITE_DROPBOX_REDIRECT_URI as string | undefined) ??
    `${window.location.origin}${window.location.pathname}`;

  const [blocks, setBlocks] = useState<Block[]>([createBlock("title"), createBlock("paragraph")]);
  const [updatedAt, setUpdatedAt] = useState<number>(Date.now());
  const [showChrome, setShowChrome] = useState<boolean>(false);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [showSelectionToolbar, setShowSelectionToolbar] = useState<boolean>(false);
  const isMac = useMemo(() => {
    if (typeof navigator === "undefined") {
      return false;
    }

    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const platform = nav.userAgentData?.platform ?? navigator.platform ?? navigator.userAgent;

    return /Mac|iPhone|iPad|iPod/i.test(platform);
  }, []);
  const menuLabel = isMac ? "⌥ - Menu" : "Alt - Menu";

  const blockRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const paperRef = useRef<HTMLElement | null>(null);

  const {
    lastSyncedAt,
    syncNotice,
    isSyncing,
    dropboxToken,
    conflict,
    setConflict,
    syncWithDropbox,
    connectDropbox,
    disconnectDropbox,
    resolveConflict,
  } = useDropboxSync({
    blocks,
    setBlocks,
    updatedAt,
    setUpdatedAt,
    isOnline,
    dropboxAppKey,
    dropboxRedirectUri,
  });

  const totalPages = useMemo(
    () => blocks.reduce((count, block) => count + (block.type === "page-break" ? 1 : 0), 1),
    [blocks],
  );

  const diffRows = useMemo(() => {
    if (!conflict) {
      return [];
    }

    return buildSideBySideDiffRows(conflict.local, conflict.remote);
  }, [conflict]);

  const markdownPreview = useMemo(() => serializeBlocksToMarkdown(blocks), [blocks]);

  const setDirty = useCallback(() => {
    setUpdatedAt(Date.now());
  }, []);

  const handleBlockRef = useCallback((blockId: string, element: HTMLDivElement | null) => {
    blockRefs.current[blockId] = element;
  }, []);

  const focusBlock = useCallback((blockId: string, position: "start" | "end" = "end") => {
    requestAnimationFrame(() => {
      const element = blockRefs.current[blockId];

      if (!element) {
        return;
      }

      element.focus();
      const length = normalizePlainText(element.innerText).length;

      if (position === "start") {
        setSelectionOffsets(element, 0, 0);
      } else {
        setSelectionOffsets(element, length, length);
      }
    });
  }, []);

  const selectAllManuscript = useCallback(() => {
    const root = paperRef.current;

    if (!root) {
      return;
    }

    const selection = window.getSelection();

    if (!selection) {
      return;
    }

    const range = document.createRange();
    range.selectNodeContents(root);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  const findEditableSibling = useCallback(
    (blockId: string, direction: -1 | 1): string | null => {
      const currentIndex = blocks.findIndex((block) => block.id === blockId);

      if (currentIndex === -1) {
        return null;
      }

      for (
        let index = currentIndex + direction;
        index >= 0 && index < blocks.length;
        index += direction
      ) {
        if (blocks[index].type !== "page-break") {
          return blocks[index].id;
        }
      }

      return null;
    },
    [blocks],
  );

  const updateBlock = useCallback(
    (blockId: string, updater: (block: Block) => Block) => {
      setBlocks((prev) => prev.map((block) => (block.id === blockId ? updater(block) : block)));
      setDirty();
    },
    [setDirty],
  );

  const insertBlockAfter = useCallback(
    (anchorId: string | null, type: BlockType, text = ""): string => {
      const newBlock = createBlock(type, text);

      setBlocks((prev) => {
        const anchorIndex = anchorId ? prev.findIndex((block) => block.id === anchorId) : -1;
        const insertIndex = anchorIndex >= 0 ? anchorIndex + 1 : prev.length;
        const next = [...prev];

        next.splice(insertIndex, 0, newBlock);
        return next;
      });

      setDirty();
      return newBlock.id;
    },
    [setDirty],
  );

  const removeBlock = useCallback(
    (blockId: string) => {
      setBlocks((prev) => {
        if (prev.length <= 1) {
          return prev;
        }

        const next = prev.filter((block) => block.id !== blockId);

        if (!next.length) {
          return [createBlock("paragraph")];
        }

        if (next.every((block) => block.type === "page-break")) {
          next.push(createBlock("paragraph"));
        }

        return next;
      });

      setDirty();
    },
    [setDirty],
  );

  const insertPageBreakAfterFocus = useCallback(() => {
    const anchorId = focusedBlockId ?? blocks[blocks.length - 1]?.id ?? null;
    const pageBreak = createBlock("page-break");
    const paragraph = createBlock("paragraph");

    setBlocks((prev) => {
      const anchorIndex = anchorId ? prev.findIndex((block) => block.id === anchorId) : -1;
      const insertIndex = anchorIndex >= 0 ? anchorIndex + 1 : prev.length;
      const next = [...prev];

      next.splice(insertIndex, 0, pageBreak, paragraph);
      return next;
    });

    setDirty();
    focusBlock(paragraph.id, "start");
  }, [blocks, focusedBlockId, focusBlock, setDirty]);

  const transformFocusedBlockType = useCallback(
    (type: Exclude<BlockType, "page-break">) => {
      if (!focusedBlockId) {
        return;
      }

      updateBlock(focusedBlockId, (block) => {
        if (block.type === "page-break") {
          return block;
        }

        return { ...block, type };
      });
    },
    [focusedBlockId, updateBlock],
  );

  const applyInlineFormat = useCallback(
    (command: "bold" | "italic" | "underline") => {
      if (!focusedBlockId) {
        return;
      }

      const target = blockRefs.current[focusedBlockId];

      if (!target) {
        return;
      }

      target.focus();
      document.execCommand(command);

      const normalized = normalizeBlockHtml(target.innerHTML);
      updateBlock(focusedBlockId, (current) => ({ ...current, text: normalized }));
    },
    [focusedBlockId, updateBlock],
  );

  const addNewParagraphBlock = useCallback(() => {
    const anchorId = focusedBlockId ?? blocks[blocks.length - 1]?.id ?? null;
    const insertedId = insertBlockAfter(anchorId, "paragraph");
    focusBlock(insertedId, "start");
  }, [blocks, focusedBlockId, focusBlock, insertBlockAfter]);

  const removePageBreakBlock = useCallback(
    (blockId: string) => {
      const nextFocus = findEditableSibling(blockId, -1) ?? findEditableSibling(blockId, 1);
      removeBlock(blockId);

      if (nextFocus) {
        focusBlock(nextFocus, "end");
      }
    },
    [findEditableSibling, focusBlock, removeBlock],
  );

  const handleBlockFocus = useCallback((blockId: string) => {
    setFocusedBlockId(blockId);
  }, []);

  const handleBlockChange = useCallback(
    (blockId: string, html: string) => {
      const normalized = normalizeBlockHtml(html);
      setFocusedBlockId(blockId);
      updateBlock(blockId, (current) => ({ ...current, text: normalized }));
    },
    [updateBlock],
  );

  const handleBlockKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>, block: Block) => {
      const target = event.currentTarget;
      const selection = getSelectionOffsets(target);

      if (!selection) {
        return;
      }

      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();

        const plainText = normalizePlainText(target.innerText);
        const before = plainText.slice(0, selection.start);
        const after = plainText.slice(selection.end);
        const nextBlock = createBlock("paragraph", after);

        setBlocks((prev) => {
          const index = prev.findIndex((current) => current.id === block.id);

          if (index === -1) {
            return prev;
          }

          const next = [...prev];
          next[index] = { ...next[index], text: before };
          next.splice(index + 1, 0, nextBlock);

          return next;
        });

        setDirty();
        focusBlock(nextBlock.id, "start");
        return;
      }

      if (
        event.key === "Backspace" &&
        selection.start === 0 &&
        selection.end === 0 &&
        normalizePlainText(target.innerText).length === 0
      ) {
        event.preventDefault();

        const previousId = findEditableSibling(block.id, -1);
        const nextId = findEditableSibling(block.id, 1);

        removeBlock(block.id);

        if (previousId) {
          focusBlock(previousId, "end");
        } else if (nextId) {
          focusBlock(nextId, "start");
        }

        return;
      }

      if (event.key === "ArrowUp" && selection.start === 0 && selection.end === 0) {
        const previousId = findEditableSibling(block.id, -1);

        if (previousId) {
          event.preventDefault();
          focusBlock(previousId, "end");
        }

        return;
      }

      const blockLength = normalizePlainText(target.innerText).length;

      if (event.key === "ArrowDown" && selection.start === blockLength && selection.end === blockLength) {
        const nextId = findEditableSibling(block.id, 1);

        if (nextId) {
          event.preventDefault();
          focusBlock(nextId, "start");
        }
      }
    },
    [findEditableSibling, focusBlock, removeBlock, setDirty],
  );

  useEffect(() => {
    const updateToolbarState = () => {
      const selection = window.getSelection();
      const paper = paperRef.current;

      if (!selection || selection.rangeCount === 0 || !paper) {
        setShowSelectionToolbar(false);
        return;
      }

      const range = selection.getRangeAt(0);

      if (!paper.contains(range.commonAncestorContainer)) {
        setShowSelectionToolbar(false);
        return;
      }

      const selectedText = selection.toString();
      const hasSelection = Boolean(selectedText.trim());

      if (!hasSelection) {
        setShowSelectionToolbar(false);
        return;
      }

      const blockId = blockIdFromNode(selection.anchorNode);

      if (blockId) {
        setFocusedBlockId(blockId);
      }

      setShowSelectionToolbar(true);
    };

    const onPointerDown = () => {
      setShowSelectionToolbar(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("mouseup", updateToolbarState);
    document.addEventListener("keyup", updateToolbarState);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("mouseup", updateToolbarState);
      document.removeEventListener("keyup", updateToolbarState);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Alt" && !event.repeat) {
        event.preventDefault();
        setShowChrome((current) => !current);
        return;
      }

      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "a") {
        event.preventDefault();
        selectAllManuscript();
        return;
      }

      if (key === "s") {
        event.preventDefault();
        void syncWithDropbox();
        return;
      }

      if (key === "b") {
        event.preventDefault();
        applyInlineFormat("bold");
        return;
      }

      if (key === "i") {
        event.preventDefault();
        applyInlineFormat("italic");
        return;
      }

      if (key === "u") {
        event.preventDefault();
        applyInlineFormat("underline");
        return;
      }

      if (key === "1") {
        event.preventDefault();
        transformFocusedBlockType("title");
        return;
      }

      if (key === "2") {
        event.preventDefault();
        transformFocusedBlockType("heading");
        return;
      }

      if (key === "0") {
        event.preventDefault();
        transformFocusedBlockType("paragraph");
        return;
      }

      if (key === "enter") {
        event.preventDefault();
        addNewParagraphBlock();
        return;
      }

      if (event.shiftKey && key === "p") {
        event.preventDefault();
        insertPageBreakAfterFocus();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    addNewParagraphBlock,
    applyInlineFormat,
    insertPageBreakAfterFocus,
    selectAllManuscript,
    syncWithDropbox,
    transformFocusedBlockType,
  ]);

  useEffect(() => {
    const refreshOnlineState = () => {
      setIsOnline(navigator.onLine);
    };

    window.addEventListener("online", refreshOnlineState);
    window.addEventListener("offline", refreshOnlineState);

    return () => {
      window.removeEventListener("online", refreshOnlineState);
      window.removeEventListener("offline", refreshOnlineState);
    };
  }, []);

  useEffect(() => {
    const updatePageIndicator = () => {
      const markers = Array.from(document.querySelectorAll<HTMLElement>('[data-page-break="true"]'));
      const readingLine = window.scrollY + window.innerHeight * 0.35;
      let page = 1;

      for (const marker of markers) {
        const absoluteTop = window.scrollY + marker.getBoundingClientRect().top;

        if (absoluteTop < readingLine) {
          page += 1;
        }
      }

      setCurrentPage(Math.max(1, Math.min(page, totalPages)));
    };

    updatePageIndicator();

    window.addEventListener("scroll", updatePageIndicator, { passive: true });
    window.addEventListener("resize", updatePageIndicator);

    return () => {
      window.removeEventListener("scroll", updatePageIndicator);
      window.removeEventListener("resize", updatePageIndicator);
    };
  }, [totalPages, blocks]);

  const toolbarButtonProps = {
    type: "button" as const,
    onMouseDown: (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
    },
  };

  return (
    <div className={`app-shell ${showChrome ? "chrome-visible" : ""}`}>
      <WritingPanel
        open={showChrome}
        updatedAtText={formatTime(updatedAt)}
        lastSyncedAtText={formatTime(lastSyncedAt)}
        isOnline={isOnline}
        isMac={isMac}
      />

      {showSelectionToolbar ? (
        <div className="selection-toolbar" role="toolbar" aria-label="Text formatting">
          <button
            {...toolbarButtonProps}
            onClick={() => applyInlineFormat("bold")}
            title="Bold"
            aria-label="Bold"
          >
            <Bold size={16} />
          </button>
          <button
            {...toolbarButtonProps}
            onClick={() => applyInlineFormat("italic")}
            title="Italic"
            aria-label="Italic"
          >
            <Italic size={16} />
          </button>
          <button
            {...toolbarButtonProps}
            onClick={() => applyInlineFormat("underline")}
            title="Underline"
            aria-label="Underline"
          >
            <Underline size={16} />
          </button>
          <span className="selection-toolbar-sep" />
          <button
            {...toolbarButtonProps}
            onClick={() => transformFocusedBlockType("title")}
            title="Main headline"
            aria-label="Main headline"
          >
            <Heading1 size={16} />
          </button>
          <button
            {...toolbarButtonProps}
            onClick={() => transformFocusedBlockType("heading")}
            title="Section headline"
            aria-label="Section headline"
          >
            <Heading2 size={16} />
          </button>
          <button
            {...toolbarButtonProps}
            onClick={() => transformFocusedBlockType("paragraph")}
            title="Paragraph"
            aria-label="Paragraph"
          >
            <Pilcrow size={16} />
          </button>
          <button
            {...toolbarButtonProps}
            onClick={() => insertPageBreakAfterFocus()}
            title="Insert page break"
            aria-label="Insert page break"
          >
            <Minus size={16} />
          </button>
        </div>
      ) : null}

      <EditorCanvas
        showChrome={showChrome}
        menuLabel={menuLabel}
        currentPage={currentPage}
        totalPages={totalPages}
        blocks={blocks}
        onToggleChrome={() => setShowChrome((current) => !current)}
        onPaperRef={(element) => {
          paperRef.current = element;
        }}
        onFocusBlock={handleBlockFocus}
        onChangeBlock={handleBlockChange}
        onBlockKeyDown={handleBlockKeyDown}
        onBlockRef={handleBlockRef}
        onRemovePageBreak={removePageBreakBlock}
      />

      <SyncPanel
        open={showChrome}
        syncNotice={syncNotice}
        isConnected={Boolean(dropboxToken)}
        isSyncing={isSyncing}
        hasDropboxAppKey={Boolean(dropboxAppKey)}
        onConnect={() => {
          void connectDropbox();
        }}
        onDisconnect={disconnectDropbox}
        onSync={() => {
          void syncWithDropbox();
        }}
        onExportMarkdown={() => {
          downloadTextFile("manuscript.md", markdownPreview);
        }}
        onExportSplitPages={() => {
          const pages = splitBlocksToMarkdownPages(blocks);

          pages.forEach((page, index) => {
            downloadTextFile(`manuscript-page-${index + 1}.md`, page);
          });
        }}
      />

      <ConflictModal
        conflict={conflict}
        diffRows={diffRows}
        isSyncing={isSyncing}
        onChangeResolved={(text) => {
          setConflict((current) => (current ? { ...current, resolved: text } : current));
        }}
        onUseLocal={() => {
          setConflict((current) => (current ? { ...current, resolved: current.local } : current));
        }}
        onUseDropbox={() => {
          setConflict((current) => (current ? { ...current, resolved: current.remote } : current));
        }}
        onUseBase={() => {
          setConflict((current) => (current ? { ...current, resolved: current.base } : current));
        }}
        onSaveResolution={() => {
          void resolveConflict();
        }}
        onClose={() => {
          setConflict(null);
        }}
      />
    </div>
  );
}

export default App;
