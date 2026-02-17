import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, KeyboardEvent as ReactKeyboardEvent, SetStateAction } from "react";

import type { Block } from "@/lib/editor-types";
import {
  blockIdFromNode,
  getSelectionOffsets,
  normalizeBlockHtml,
  normalizePlainText,
  setSelectionOffsets,
} from "@/lib/editor-selection";
import {
  createBlock,
  normalizeBlocksForEditor,
  serializeBlocksToMarkdown,
} from "@/lib/markdown";

function isHtmlContentEmpty(html: string): boolean {
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

interface UseManuscriptEditorArgs {
  blocks: Block[];
  setBlocks: Dispatch<SetStateAction<Block[]>>;
  setUpdatedAt: (value: number) => void;
}

interface UseManuscriptEditorResult {
  currentPage: number;
  totalPages: number;
  markdownPreview: string;
  showSelectionToolbar: boolean;
  pageStartHeadingIds: Set<string>;
  setPaperRef: (element: HTMLElement | null) => void;
  handlePaperInput: () => void;
  handlePaperKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  handleBlockRef: (blockId: string, element: HTMLDivElement | null) => void;
  handleBlockFocus: (blockId: string) => void;
  transformFocusedBlockType: (type: "heading" | "paragraph") => void;
  applyInlineFormat: (command: "bold" | "italic" | "underline") => void;
  selectFocusedBlockContent: () => void;
  selectAllManuscript: () => void;
}

export function useManuscriptEditor({
  blocks,
  setBlocks,
  setUpdatedAt,
}: UseManuscriptEditorArgs): UseManuscriptEditorResult {
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const [showSelectionToolbar, setShowSelectionToolbar] = useState<boolean>(false);

  const blockRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const paperRef = useRef<HTMLElement | null>(null);
  const focusedBlockIdRef = useRef<string | null>(null);
  const selectionRestoreSeqRef = useRef<number>(0);
  const commitTimeoutRef = useRef<number | null>(null);
  const firstBlockId = blocks[0]?.id ?? null;

  const pageStartHeadingIds = useMemo(() => {
    const ids = new Set<string>();

    for (const block of blocks) {
      if (block.type === "heading") {
        ids.add(block.id);
      }
    }

    return ids;
  }, [blocks]);

  const totalPages = useMemo(() => Math.max(1, pageStartHeadingIds.size + 1), [pageStartHeadingIds]);
  const markdownPreview = useMemo(() => serializeBlocksToMarkdown(blocks), [blocks]);

  const setDirty = useCallback(() => {
    setUpdatedAt(Date.now());
  }, [setUpdatedAt]);

  const setPaperRef = useCallback((element: HTMLElement | null) => {
    paperRef.current = element;
  }, []);

  const handleBlockRef = useCallback((blockId: string, element: HTMLDivElement | null) => {
    blockRefs.current[blockId] = element;
  }, []);

  const focusBlock = useCallback((blockId: string, position: "start" | "end" = "end") => {
    const tryFocus = (attemptsLeft: number) => {
      const element = blockRefs.current[blockId];

      if (!element) {
        if (attemptsLeft > 0) {
          requestAnimationFrame(() => tryFocus(attemptsLeft - 1));
        }

        return;
      }

      element.focus();
      const length = normalizePlainText(element.innerText).length;

      if (position === "start") {
        setSelectionOffsets(element, 0, 0);
      } else {
        setSelectionOffsets(element, length, length);
      }
    };

    requestAnimationFrame(() => tryFocus(4));
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

  const selectFocusedBlockContent = useCallback(() => {
    const selection = window.getSelection();

    if (!selection) {
      return;
    }

    const blockIdFromSelection = blockIdFromNode(selection.anchorNode);
    const targetBlockId = blockIdFromSelection ?? focusedBlockIdRef.current;

    if (!targetBlockId) {
      selectAllManuscript();
      return;
    }

    const target = blockRefs.current[targetBlockId];

    if (!target) {
      selectAllManuscript();
      return;
    }

    const range = document.createRange();
    range.selectNodeContents(target);
    selection.removeAllRanges();
    selection.addRange(range);
    focusedBlockIdRef.current = targetBlockId;
    setFocusedBlockId(targetBlockId);
  }, [selectAllManuscript]);

  const findEditableSibling = useCallback(
    (blockId: string, direction: -1 | 1): string | null => {
      const currentIndex = blocks.findIndex((block) => block.id === blockId);

      if (currentIndex === -1) {
        return null;
      }

      const sibling = blocks[currentIndex + direction];
      return sibling?.id ?? null;
    },
    [blocks],
  );

  const updateBlock = useCallback(
    (blockId: string, updater: (block: Block) => Block) => {
      setBlocks((prev) => {
        const next = prev.map((block) => (block.id === blockId ? updater(block) : block));
        return normalizeBlocksForEditor(next);
      });
      setDirty();
    },
    [setBlocks, setDirty],
  );

  const removeBlock = useCallback(
    (blockId: string) => {
      setBlocks((prev) => {
        const target = prev.find((block) => block.id === blockId);
        const isOnlyBodyBlock =
          prev.length === 2 &&
          prev[0]?.id === firstBlockId &&
          prev[1]?.id === blockId;

        if (!target || blockId === prev[0]?.id || prev.length <= 1 || isOnlyBodyBlock) {
          return prev;
        }

        const next = prev.filter((block) => block.id !== blockId);
        return normalizeBlocksForEditor(next);
      });

      setDirty();
    },
    [firstBlockId, setBlocks, setDirty],
  );

  const transformFocusedBlockType = useCallback(
    (type: "heading" | "paragraph") => {
      if (!focusedBlockId || focusedBlockId === firstBlockId) {
        return;
      }

      updateBlock(focusedBlockId, (block) => {
        if (block.id === firstBlockId || block.type === "title") {
          return block;
        }

        return { ...block, type };
      });
    },
    [firstBlockId, focusedBlockId, updateBlock],
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

  const handleBlockFocus = useCallback((blockId: string) => {
    focusedBlockIdRef.current = blockId;
    setFocusedBlockId(blockId);
  }, []);

  const clearPendingCommit = useCallback(() => {
    if (commitTimeoutRef.current !== null) {
      window.clearTimeout(commitTimeoutRef.current);
      commitTimeoutRef.current = null;
    }
  }, []);

  const flushPaperToBlocks = useCallback(() => {
    const paper = paperRef.current;

    if (!paper) {
      return;
    }

    const selection = window.getSelection();
    const activeBlockId = blockIdFromNode(selection?.anchorNode ?? null) ?? focusedBlockIdRef.current;
    let selectionToRestore: { blockId: string; start: number; end: number } | null = null;

    if (activeBlockId) {
      const activeElement = blockRefs.current[activeBlockId];

      if (activeElement) {
        const offsets = getSelectionOffsets(activeElement);

        if (offsets) {
          selectionToRestore = {
            blockId: activeBlockId,
            start: offsets.start,
            end: offsets.end,
          };
        }
      }
    }

    let changed = false;
    let activeBlockChanged = false;

    setBlocks((prev) => {
      const next = prev.map((block) => {
        const blockElement = paper.querySelector<HTMLElement>(`[data-block-id="${block.id}"]`);

        if (!blockElement) {
          return block;
        }

        const normalized = normalizeBlockHtml(blockElement.innerHTML);

        if (normalized === block.text) {
          return block;
        }

        changed = true;

        if (activeBlockId && block.id === activeBlockId) {
          activeBlockChanged = true;
        }

        return { ...block, text: normalized };
      });

      if (!changed) {
        return prev;
      }

      return next;
    });

    if (changed) {
      setDirty();

      if (selectionToRestore && activeBlockChanged) {
        const seq = selectionRestoreSeqRef.current + 1;
        selectionRestoreSeqRef.current = seq;

        requestAnimationFrame(() => {
          if (selectionRestoreSeqRef.current !== seq) {
            return;
          }

          const target = blockRefs.current[selectionToRestore.blockId];

          if (!target) {
            return;
          }

          target.focus();
          setSelectionOffsets(target, selectionToRestore.start, selectionToRestore.end);
        });
      }
    }
  }, [setBlocks, setDirty]);

  const handlePaperInput = useCallback(
    () => {
      const selection = window.getSelection();
      const activeBlockId = blockIdFromNode(selection?.anchorNode ?? null) ?? focusedBlockIdRef.current;

      if (activeBlockId) {
        if (activeBlockId !== focusedBlockIdRef.current) {
          focusedBlockIdRef.current = activeBlockId;
          setFocusedBlockId(activeBlockId);
        }

        const activeElement = blockRefs.current[activeBlockId];
        if (activeElement) {
          if (isHtmlContentEmpty(activeElement.innerHTML)) {
            activeElement.dataset.empty = "true";
          } else {
            delete activeElement.dataset.empty;
          }
        }
      }

      clearPendingCommit();
      commitTimeoutRef.current = window.setTimeout(() => {
        commitTimeoutRef.current = null;
        flushPaperToBlocks();
      }, 180);
    },
    [clearPendingCommit, flushPaperToBlocks],
  );

  const handlePaperKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const paper = event.currentTarget;
      const selection = window.getSelection();

      if (!selection || selection.rangeCount === 0) {
        return;
      }

      const activeBlockId = blockIdFromNode(selection.anchorNode) ?? focusedBlockIdRef.current;

      if (!activeBlockId) {
        return;
      }

      const block = blocks.find((item) => item.id === activeBlockId);

      if (!block) {
        return;
      }

      const target = paper.querySelector<HTMLElement>(`[data-block-id="${activeBlockId}"]`);

      if (!target) {
        return;
      }

      if (event.key === "Enter" && !event.shiftKey) {
        clearPendingCommit();

        if (block.id === firstBlockId) {
          event.preventDefault();

          const titleHtml = normalizeBlockHtml(target.innerHTML);
          const starterBlock = blocks[1];
          const hasOnlyStarterBlock =
            blocks.length === 2 &&
            starterBlock?.type === "paragraph" &&
            isHtmlContentEmpty(starterBlock.text);

          if (hasOnlyStarterBlock && starterBlock) {
            setBlocks((prev) => {
              const index = prev.findIndex((current) => current.id === block.id);

              if (index === -1) {
                return prev;
              }

              const next = [...prev];
              next[index] = { ...next[index], text: titleHtml };

              return normalizeBlocksForEditor(next);
            });

            setDirty();
            setFocusedBlockId(starterBlock.id);
            focusBlock(starterBlock.id, "start");
            return;
          }

          const nextBlock = createBlock("paragraph", "");

          setBlocks((prev) => {
            const index = prev.findIndex((current) => current.id === block.id);

            if (index === -1) {
              return prev;
            }

            const next = [...prev];
            next[index] = { ...next[index], text: titleHtml };
            next.splice(index + 1, 0, nextBlock);

            return normalizeBlocksForEditor(next);
          });

          setDirty();
          setFocusedBlockId(nextBlock.id);
          focusBlock(nextBlock.id, "start");
          return;
        }

        const offsets = getSelectionOffsets(target);

        if (!offsets) {
          return;
        }

        event.preventDefault();

        const plainText = normalizePlainText(target.innerText);
        const before = plainText.slice(0, offsets.start);
        const after = plainText.slice(offsets.end);

        const nextBlock = createBlock("paragraph", after);

        setBlocks((prev) => {
          const index = prev.findIndex((current) => current.id === block.id);

          if (index === -1) {
            return prev;
          }

          const next = [...prev];
          next[index] = { ...next[index], text: before };
          next.splice(index + 1, 0, nextBlock);

          return normalizeBlocksForEditor(next);
        });

        setDirty();
        setFocusedBlockId(nextBlock.id);
        focusBlock(nextBlock.id, "start");
        return;
      }

      const offsets = getSelectionOffsets(target);

      if (!offsets) {
        return;
      }

      const isDeletionKey = event.key === "Backspace" || event.key === "Delete";
      const blockLength = normalizePlainText(target.innerText).length;
      const isCaretDeletionPoint =
        offsets.start === offsets.end &&
        (offsets.start === 0 || offsets.start === blockLength);

      if (isDeletionKey && isCaretDeletionPoint && isHtmlContentEmpty(target.innerHTML)) {
        clearPendingCommit();
        event.preventDefault();

        if (block.id === firstBlockId || block.type === "title") {
          return;
        }

        const isOnlyBodyBlock =
          blocks.length === 2 &&
          blocks[0]?.id === firstBlockId &&
          blocks[1]?.id === block.id;

        if (isOnlyBodyBlock) {
          return;
        }

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

      if (event.key === "ArrowUp" && offsets.start === 0 && offsets.end === 0) {
        const previousId = findEditableSibling(block.id, -1);

        if (previousId) {
          event.preventDefault();
          focusBlock(previousId, "end");
        }

        return;
      }

      if (event.key === "ArrowDown" && offsets.start === blockLength && offsets.end === blockLength) {
        const nextId = findEditableSibling(block.id, 1);

        if (nextId) {
          event.preventDefault();
          focusBlock(nextId, "start");
        }
      }
    },
    [
      blocks,
      clearPendingCommit,
      findEditableSibling,
      firstBlockId,
      focusBlock,
      removeBlock,
      setBlocks,
      setDirty,
    ],
  );

  useEffect(() => {
    focusedBlockIdRef.current = focusedBlockId;
  }, [focusedBlockId]);

  useEffect(() => {
    return () => {
      clearPendingCommit();
      flushPaperToBlocks();
    };
  }, [clearPendingCommit, flushPaperToBlocks]);

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

      if (!selectedText.trim()) {
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
    const updatePageIndicator = () => {
      const markers = Array.from(document.querySelectorAll<HTMLElement>('[data-page-start="true"]'));
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
  }, [totalPages, pageStartHeadingIds]);

  return {
    currentPage,
    totalPages,
    markdownPreview,
    showSelectionToolbar,
    pageStartHeadingIds,
    setPaperRef,
    handlePaperInput,
    handlePaperKeyDown,
    handleBlockRef,
    handleBlockFocus,
    transformFocusedBlockType,
    applyInlineFormat,
    selectFocusedBlockContent,
    selectAllManuscript,
  };
}
