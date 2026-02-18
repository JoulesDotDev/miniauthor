import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { FORMAT_TEXT_COMMAND, type LexicalEditor } from "lexical";

import type { Block } from "@/lib/editor-types";
import {
  markdownFromBlocksForCompare,
  selectCurrentTopLevelBlockContent,
  selectionTouchesTitleBlock,
  setSelectedTopLevelBlocksToType,
} from "@/lib/lexical-manuscript";
import { serializeBlocksToMarkdown } from "@/lib/markdown";

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
  setLexicalEditor: (editor: LexicalEditor | null) => void;
  handleEditorBlocksChange: (nextBlocks: Block[]) => void;
  handleSelectionToolbarChange: (visible: boolean) => void;
  transformFocusedBlockType: (type: "heading" | "paragraph") => void;
  applyInlineFormat: (command: "bold" | "italic") => void;
  selectFocusedBlockContent: () => void;
}

export function useManuscriptEditor({
  blocks,
  setBlocks,
  setUpdatedAt,
}: UseManuscriptEditorArgs): UseManuscriptEditorResult {
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [showSelectionToolbar, setShowSelectionToolbar] = useState<boolean>(false);

  const editorRef = useRef<LexicalEditor | null>(null);
  const markdownRef = useRef<string>(markdownFromBlocksForCompare(blocks));

  const headingCount = useMemo(
    () => blocks.reduce((count, block) => (block.type === "heading" ? count + 1 : count), 0),
    [blocks],
  );
  const totalPages = useMemo(() => Math.max(1, headingCount + 1), [headingCount]);
  const markdownPreview = useMemo(() => serializeBlocksToMarkdown(blocks), [blocks]);

  const setDirty = useCallback(() => {
    setUpdatedAt(Date.now());
  }, [setUpdatedAt]);

  const setLexicalEditor = useCallback((editor: LexicalEditor | null) => {
    editorRef.current = editor;
  }, []);

  const handleEditorBlocksChange = useCallback(
    (nextBlocks: Block[]) => {
      const nextMarkdown = markdownFromBlocksForCompare(nextBlocks);

      if (nextMarkdown === markdownRef.current) {
        return;
      }

      markdownRef.current = nextMarkdown;
      setBlocks(nextBlocks);
      setDirty();
    },
    [setBlocks, setDirty],
  );

  const handleSelectionToolbarChange = useCallback((visible: boolean) => {
    setShowSelectionToolbar(visible);
  }, []);

  const applyInlineFormat = useCallback((command: "bold" | "italic") => {
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    const shouldBlock = editor.getEditorState().read(() => selectionTouchesTitleBlock());

    if (shouldBlock) {
      return;
    }

    editor.dispatchCommand(FORMAT_TEXT_COMMAND, command);
  }, []);

  const transformFocusedBlockType = useCallback((type: "heading" | "paragraph") => {
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    editor.update(() => {
      setSelectedTopLevelBlocksToType(type);
    });
  }, []);

  const selectFocusedBlockContent = useCallback(() => {
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    selectCurrentTopLevelBlockContent(editor);
  }, []);

  useEffect(() => {
    markdownRef.current = markdownFromBlocksForCompare(blocks);
  }, [blocks]);

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
  }, [totalPages, headingCount, blocks.length]);

  return {
    currentPage,
    totalPages,
    markdownPreview,
    showSelectionToolbar,
    setLexicalEditor,
    handleEditorBlocksChange,
    handleSelectionToolbarChange,
    transformFocusedBlockType,
    applyInlineFormat,
    selectFocusedBlockContent,
  };
}
