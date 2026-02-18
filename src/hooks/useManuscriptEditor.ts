import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { FORMAT_TEXT_COMMAND, type LexicalEditor } from "lexical";

import type { Block } from "@/lib/editor-types";
import {
  selectCurrentTopLevelBlockContent,
  selectTopLevelBlockStartByKey,
  selectionTouchesTitleBlock,
  setSelectedTopLevelBlocksToType,
} from "@/lib/lexical-manuscript";

interface UseManuscriptEditorArgs {
  blocks: Block[];
  setBlocks: Dispatch<SetStateAction<Block[]>>;
  setUpdatedAt: (value: number) => void;
}

export interface SelectionToolbarActiveState {
  bold: boolean;
  italic: boolean;
  heading1: boolean;
  heading2: boolean;
  paragraph: boolean;
}

const EMPTY_TOOLBAR_ACTIVE_STATE: SelectionToolbarActiveState = {
  bold: false,
  italic: false,
  heading1: false,
  heading2: false,
  paragraph: false,
};

interface UseManuscriptEditorResult {
  showSelectionToolbar: boolean;
  selectionToolbarActive: SelectionToolbarActiveState;
  setLexicalEditor: (editor: LexicalEditor | null) => void;
  handleEditorBlocksChange: (nextBlocks: Block[]) => void;
  handleSelectionToolbarChange: (visible: boolean) => void;
  handleSelectionToolbarActiveChange: (next: SelectionToolbarActiveState) => void;
  transformFocusedBlockType: (type: "heading1" | "heading2" | "paragraph") => void;
  applyInlineFormat: (command: "bold" | "italic") => void;
  selectFocusedBlockContent: () => void;
  jumpToBlockById: (blockId: string) => void;
}

export function useManuscriptEditor({
  blocks,
  setBlocks,
  setUpdatedAt,
}: UseManuscriptEditorArgs): UseManuscriptEditorResult {
  const [showSelectionToolbar, setShowSelectionToolbar] = useState<boolean>(false);
  const [selectionToolbarActive, setSelectionToolbarActive] = useState<SelectionToolbarActiveState>(
    EMPTY_TOOLBAR_ACTIVE_STATE,
  );

  const editorRef = useRef<LexicalEditor | null>(null);
  const lastBlocksRef = useRef<Block[]>(blocks);

  const setDirty = useCallback(() => {
    setUpdatedAt(Date.now());
  }, [setUpdatedAt]);

  const setLexicalEditor = useCallback((editor: LexicalEditor | null) => {
    editorRef.current = editor;
  }, []);

  const handleEditorBlocksChange = useCallback(
    (nextBlocks: Block[]) => {
      const previousBlocks = lastBlocksRef.current;

      if (previousBlocks === nextBlocks) {
        return;
      }

      if (previousBlocks.length === nextBlocks.length) {
        let changed = false;

        for (let index = 0; index < previousBlocks.length; index += 1) {
          const previous = previousBlocks[index];
          const next = nextBlocks[index];

          if (
            previous.id !== next.id ||
            previous.type !== next.type ||
            previous.text !== next.text
          ) {
            changed = true;
            break;
          }
        }

        if (!changed) {
          return;
        }
      }

      lastBlocksRef.current = nextBlocks;
      setBlocks(nextBlocks);
      setDirty();
    },
    [setBlocks, setDirty],
  );

  const handleSelectionToolbarChange = useCallback((visible: boolean) => {
    setShowSelectionToolbar(visible);
  }, []);

  const handleSelectionToolbarActiveChange = useCallback((next: SelectionToolbarActiveState) => {
    setSelectionToolbarActive((current) => {
      if (
        current.bold === next.bold &&
        current.italic === next.italic &&
        current.heading1 === next.heading1 &&
        current.heading2 === next.heading2 &&
        current.paragraph === next.paragraph
      ) {
        return current;
      }

      return next;
    });
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

  const transformFocusedBlockType = useCallback((type: "heading1" | "heading2" | "paragraph") => {
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

  const jumpToBlockById = useCallback((blockId: string) => {
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    editor.update(() => {
      selectTopLevelBlockStartByKey(blockId);
    });

    window.requestAnimationFrame(() => {
      const element = editor.getElementByKey(blockId);

      element?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    });
  }, []);

  useEffect(() => {
    lastBlocksRef.current = blocks;
  }, [blocks]);

  return {
    showSelectionToolbar,
    selectionToolbarActive,
    setLexicalEditor,
    handleEditorBlocksChange,
    handleSelectionToolbarChange,
    handleSelectionToolbarActiveChange,
    transformFocusedBlockType,
    applyInlineFormat,
    selectFocusedBlockContent,
    jumpToBlockById,
  };
}
