import { memo, useEffect, useMemo, useRef } from "react";

import { $createParagraphNode, $getRoot, $getSelection, $isElementNode, $isParagraphNode, $isRangeSelection, COMMAND_PRIORITY_CRITICAL, COMMAND_PRIORITY_HIGH, FORMAT_TEXT_COMMAND, KEY_DOWN_COMMAND, KEY_ENTER_COMMAND, type LexicalEditor } from "lexical";
import { HeadingNode, $isHeadingNode } from "@lexical/rich-text";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";

import { useEditorChrome } from "@/contexts/EditorChromeContext";
import type { Block } from "@/lib/editor-types";
import {
  ensureLexicalManuscriptStructure,
  isLexicalElementEmpty,
  lexicalManuscriptNeedsFix,
  markdownFromBlocksForCompare,
  readBlocksFromLexicalRoot,
  selectCurrentTopLevelBlockContent,
  selectionTouchesTitleBlock,
  setSelectedTopLevelBlocksToType,
  tryHandleEnterInTitle,
  writeBlocksToLexicalRoot,
} from "@/lib/lexical-manuscript";

interface EditorCanvasProps {
  currentPage: number;
  totalPages: number;
  blocks: Block[];
  onEditorReady: (editor: LexicalEditor | null) => void;
  onBlocksChange: (nextBlocks: Block[]) => void;
  onSelectionToolbarChange: (visible: boolean) => void;
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

function decorateEditorBlocks(editor: LexicalEditor): void {
  editor.getEditorState().read(() => {
    const root = $getRoot();
    const children = root.getChildren().filter((node) => $isElementNode(node));
    const hasSingleStarterParagraph =
      children.length === 2 &&
      $isParagraphNode(children[1]) &&
      isLexicalElementEmpty(children[1]);

    children.forEach((node, index) => {
      const element = editor.getElementByKey(node.getKey());

      if (!element) {
        return;
      }

      const type: Block["type"] =
        index === 0 ? "title" : $isHeadingNode(node) ? "heading" : "paragraph";
      const isEmpty = isLexicalElementEmpty(node);
      const showPlaceholder =
        type === "title" ||
        type === "heading" ||
        (type === "paragraph" && hasSingleStarterParagraph && index === 1);

      element.dataset.blockId = node.getKey();

      if (isEmpty) {
        element.dataset.empty = "true";
      } else {
        delete element.dataset.empty;
      }

      if (showPlaceholder) {
        element.dataset.placeholder = placeholderForType(type);
      } else {
        delete element.dataset.placeholder;
      }

      if (type === "heading") {
        element.dataset.pageStart = "true";
      } else {
        delete element.dataset.pageStart;
      }
    });
  });
}

function EditorReadyPlugin({ onEditorReady }: { onEditorReady: (editor: LexicalEditor | null) => void }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    onEditorReady(editor);
  }, [editor, onEditorReady]);

  return null;
}

function ExternalBlocksSyncPlugin({ blocks }: { blocks: Block[] }) {
  const [editor] = useLexicalComposerContext();
  const lastAppliedMarkdownRef = useRef<string>("");

  useEffect(() => {
    const incomingMarkdown = markdownFromBlocksForCompare(blocks);

    if (incomingMarkdown === lastAppliedMarkdownRef.current) {
      return;
    }

    let currentMarkdown = "";
    editor.getEditorState().read(() => {
      currentMarkdown = markdownFromBlocksForCompare(readBlocksFromLexicalRoot());
    });

    if (incomingMarkdown !== currentMarkdown) {
      editor.update(
        () => {
          writeBlocksToLexicalRoot(blocks);
        },
        { tag: "external-sync" },
      );
    }

    lastAppliedMarkdownRef.current = incomingMarkdown;
  }, [blocks, editor]);

  return null;
}

interface BehaviorPluginProps {
  onBlocksChange: (nextBlocks: Block[]) => void;
  onSelectionToolbarChange: (visible: boolean) => void;
}

function ManuscriptBehaviorPlugin({ onBlocksChange, onSelectionToolbarChange }: BehaviorPluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    let frameId: number | null = null;

    const scheduleDecoration = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        decorateEditorBlocks(editor);
      });
    };

    const unregisterEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        if (event?.shiftKey) {
          return false;
        }

        ensureLexicalManuscriptStructure();
        const handled = tryHandleEnterInTitle();

        if (handled) {
          event?.preventDefault();
        }

        return handled;
      },
      COMMAND_PRIORITY_HIGH,
    );

    const unregisterBlockSelectAll = editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event) => {
        if (!(event.metaKey || event.ctrlKey)) {
          return false;
        }

        const key = event.key.toLowerCase();

        if (key === "b" || key === "i") {
          event.preventDefault();

          const shouldBlock = editor.getEditorState().read(() => selectionTouchesTitleBlock());

          if (shouldBlock) {
            return true;
          }

          editor.dispatchCommand(
            FORMAT_TEXT_COMMAND,
            key === "b" ? "bold" : "italic",
          );

          return true;
        }

        if (key === "2" || key === "0") {
          event.preventDefault();
          editor.update(() => {
            setSelectedTopLevelBlocksToType(key === "2" ? "heading" : "paragraph");
          });
          return true;
        }

        if (key !== "a") {
          return false;
        }

        event.preventDefault();
        let focusedBlockKey: string | null = null;

        editor.getEditorState().read(() => {
          const selection = $getSelection();

          if (!$isRangeSelection(selection)) {
            return;
          }

          focusedBlockKey = selection.anchor.getNode().getTopLevelElement()?.getKey() ?? null;
        });

        if (focusedBlockKey) {
          const blockElement = editor.getElementByKey(focusedBlockKey);

          if (blockElement) {
            const domSelection = window.getSelection();

            if (domSelection) {
              const range = document.createRange();
              range.selectNodeContents(blockElement);
              domSelection.removeAllRanges();
              domSelection.addRange(range);
              return true;
            }
          }
        }

        selectCurrentTopLevelBlockContent(editor);
        return true;
      },
      COMMAND_PRIORITY_CRITICAL,
    );

    const unregisterUpdates = editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
      let needsFix = false;
      let hasSelectionText = false;
      let selectionIncludesTitle = false;
      const hasDocumentMutation = dirtyElements.size > 0 || dirtyLeaves.size > 0;
      let nextBlocks: Block[] = [];

      editorState.read(() => {
        needsFix = lexicalManuscriptNeedsFix();

        if (!needsFix && hasDocumentMutation) {
          nextBlocks = readBlocksFromLexicalRoot();
        }

        const selection = $getSelection();
        hasSelectionText =
          $isRangeSelection(selection) &&
          !selection.isCollapsed() &&
          selection.getTextContent().trim().length > 0;
        selectionIncludesTitle = selectionTouchesTitleBlock();
      });

      onSelectionToolbarChange(hasSelectionText && !selectionIncludesTitle);
      scheduleDecoration();

      if (needsFix) {
        editor.update(
          () => {
            ensureLexicalManuscriptStructure();

            const root = $getRoot();
            if (!root.getFirstChild()) {
              root.append($createParagraphNode());
            }
          },
          { tag: "structure-fix" },
        );
        return;
      }

      if (hasDocumentMutation) {
        onBlocksChange(nextBlocks);
      }
    });

    scheduleDecoration();

    return () => {
      unregisterEnter();
      unregisterBlockSelectAll();
      unregisterUpdates();

      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [editor, onBlocksChange, onSelectionToolbarChange]);

  return null;
}

function EditorCanvasComponent({
  currentPage,
  totalPages,
  blocks,
  onEditorReady,
  onBlocksChange,
  onSelectionToolbarChange,
}: EditorCanvasProps) {
  const { showChrome, menuLabel, toggleChrome } = useEditorChrome();
  const initialBlocksRef = useRef<Block[]>(blocks);

  const initialConfig = useMemo(
    () => ({
      namespace: "book-writer-editor",
      theme: {
        heading: {
          h1: "editor-block block-title",
          h2: "editor-block block-heading",
          h3: "editor-block block-heading",
          h4: "editor-block block-heading",
          h5: "editor-block block-heading",
          h6: "editor-block block-heading",
        },
        paragraph: "editor-block block-paragraph",
        text: {
          bold: "editor-text-bold",
          italic: "editor-text-italic",
        },
      },
      nodes: [HeadingNode],
      onError: (error: Error) => {
        throw error;
      },
      editorState: () => {
        writeBlocksToLexicalRoot(initialBlocksRef.current);
      },
    }),
    [],
  );

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

      <LexicalComposer initialConfig={initialConfig}>
        <EditorReadyPlugin onEditorReady={onEditorReady} />
        <ExternalBlocksSyncPlugin blocks={blocks} />
        <ManuscriptBehaviorPlugin
          onBlocksChange={onBlocksChange}
          onSelectionToolbarChange={onSelectionToolbarChange}
        />
        <RichTextPlugin
          contentEditable={<ContentEditable className="paper-column editor-content" aria-label="Manuscript editor" />}
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
      </LexicalComposer>
    </main>
  );
}

export const EditorCanvas = memo(EditorCanvasComponent);
EditorCanvas.displayName = "EditorCanvas";
