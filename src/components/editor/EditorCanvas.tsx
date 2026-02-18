import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";

import { $createParagraphNode, $getRoot, $getSelection, $isElementNode, $isParagraphNode, $isRangeSelection, $isTextNode, COMMAND_PRIORITY_CRITICAL, COMMAND_PRIORITY_HIGH, FORMAT_TEXT_COMMAND, KEY_DOWN_COMMAND, KEY_ENTER_COMMAND, UNDO_COMMAND, type ElementNode as LexicalElementNode, type LexicalEditor, type LexicalNode } from "lexical";
import { HeadingNode, $isHeadingNode } from "@lexical/rich-text";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { BookText, Menu, X } from "lucide-react";

import { useEditorChrome } from "@/contexts/EditorChromeContext";
import type { Block } from "@/lib/editor-types";
import {
  ensureLexicalManuscriptStructure,
  isLexicalElementEmpty,
  lexicalManuscriptNeedsFix,
  readBlocksFromLexicalRoot,
  restoreTitleBlockFromHtml,
  selectCurrentTopLevelBlockContent,
  titleBlockIsEmpty,
  selectionTouchesTitleBlock,
  selectTopLevelBlockContentByKey,
  setSelectedTopLevelBlocksToType,
  tryHandleEnterInTitle,
  writeBlocksToLexicalRoot,
} from "@/lib/lexical-manuscript";

interface EditorCanvasProps {
  blocks: Block[];
  onEditorReady: (editor: LexicalEditor | null) => void;
  onBlocksChange: (nextBlocks: Block[]) => void;
  onSelectionToolbarChange: (visible: boolean) => void;
  onSelectionToolbarActiveChange: (state: SelectionToolbarActiveState) => void;
  onActiveBlockChange: (blockId: string | null) => void;
  showMap: boolean;
  onToggleMap: () => void;
}

interface SelectionToolbarActiveState {
  bold: boolean;
  italic: boolean;
  heading1: boolean;
  heading2: boolean;
  paragraph: boolean;
}

const EMPTY_SELECTION_TOOLBAR_ACTIVE_STATE: SelectionToolbarActiveState = {
  bold: false,
  italic: false,
  heading1: false,
  heading2: false,
  paragraph: false,
};

function placeholderForType(type: Block["type"]): string {
  if (type === "title") {
    return "Title";
  }

  if (type === "heading1") {
    return "Heading 1";
  }

  if (type === "heading2") {
    return "Heading 2";
  }

  return "Start writting...";
}

function areBlocksEqual(left: Block[], right: Block[]): boolean {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftBlock = left[index];
    const rightBlock = right[index];

    if (
      leftBlock.id !== rightBlock.id ||
      leftBlock.type !== rightBlock.type ||
      leftBlock.text !== rightBlock.text
    ) {
      return false;
    }
  }

  return true;
}

function keepCaretComfortablyVisible(editor: LexicalEditor): void {
  const rootElement = editor.getRootElement();

  if (!rootElement) {
    return;
  }

  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement) || activeElement !== rootElement) {
    return;
  }

  const domSelection = window.getSelection();
  if (!domSelection || domSelection.rangeCount === 0 || !domSelection.isCollapsed) {
    return;
  }

  const range = domSelection.getRangeAt(0);
  if (!rootElement.contains(range.startContainer)) {
    return;
  }

  const rects = range.getClientRects();
  let caretBottom: number | null = null;

  if (rects.length > 0) {
    caretBottom = rects[rects.length - 1].bottom;
  } else {
    const fallbackElement =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;

    if (fallbackElement) {
      caretBottom = fallbackElement.getBoundingClientRect().bottom;
    }
  }

  if (caretBottom === null) {
    return;
  }

  const comfortPadding = Math.max(120, Math.min(220, window.innerHeight * 0.26));
  const targetBottom = window.innerHeight - comfortPadding;

  if (caretBottom > targetBottom) {
    window.scrollBy({ top: caretBottom - targetBottom, behavior: "auto" });
  }
}

function resolveNonTitleBlockType(
  node: LexicalElementNode,
  titleKey: string | null,
): "heading1" | "heading2" | "paragraph" | null {
  if (titleKey && node.getKey() === titleKey) {
    return null;
  }

  if ($isHeadingNode(node)) {
    return node.getTag() === "h3" ? "heading2" : "heading1";
  }

  return "paragraph";
}

function readSelectionToolbarActiveState(): SelectionToolbarActiveState {
  const selection = $getSelection();

  if (!$isRangeSelection(selection) || selection.isCollapsed()) {
    return EMPTY_SELECTION_TOOLBAR_ACTIVE_STATE;
  }

  if (selection.getTextContent().trim().length === 0 || selectionTouchesTitleBlock()) {
    return EMPTY_SELECTION_TOOLBAR_ACTIVE_STATE;
  }

  const selectedNodes = selection.getNodes();
  const selectedTextNodes = selectedNodes.filter($isTextNode).filter((node) => node.getTextContentSize() > 0);
  const boldActive =
    selectedTextNodes.length > 0
      ? selectedTextNodes.every((node) => node.hasFormat("bold"))
      : selection.hasFormat("bold");
  const italicActive =
    selectedTextNodes.length > 0
      ? selectedTextNodes.every((node) => node.hasFormat("italic"))
      : selection.hasFormat("italic");

  const root = $getRoot();
  const first = root.getFirstChild();
  const titleKey = $isElementNode(first) ? first.getKey() : null;
  const selectedTopLevelNodes = new Map<string, LexicalElementNode>();

  const markTopLevel = (node: LexicalNode) => {
    const top = node.getTopLevelElement();

    if (!top || top.getParent() !== root || !$isElementNode(top)) {
      return;
    }

    selectedTopLevelNodes.set(top.getKey(), top);
  };

  selectedNodes.forEach(markTopLevel);
  markTopLevel(selection.anchor.getNode());
  markTopLevel(selection.focus.getNode());

  const blockTypes = Array.from(selectedTopLevelNodes.values())
    .map((node) => resolveNonTitleBlockType(node, titleKey))
    .filter((type): type is "heading1" | "heading2" | "paragraph" => type !== null);
  const singleBlockType =
    blockTypes.length > 0 && blockTypes.every((type) => type === blockTypes[0])
      ? blockTypes[0]
      : null;

  return {
    bold: boldActive,
    italic: italicActive,
    heading1: singleBlockType === "heading1",
    heading2: singleBlockType === "heading2",
    paragraph: singleBlockType === "paragraph",
  };
}

function hasMeaningfulInlineHtml(html: string): boolean {
  return html
    .replace(/<br\s*\/?>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim()
    .length > 0;
}

function applyBlockDecoration(
  element: HTMLElement,
  blockId: string,
  type: Block["type"],
  isEmpty: boolean,
  showPlaceholder: boolean,
): void {
  element.dataset.blockId = blockId;

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

  if (type === "heading1") {
    element.dataset.pageStart = "true";
  } else {
    delete element.dataset.pageStart;
  }
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
        index === 0
          ? "title"
          : $isHeadingNode(node)
            ? node.getTag() === "h3"
              ? "heading2"
              : "heading1"
            : "paragraph";
      const isEmpty = isLexicalElementEmpty(node);
      const showPlaceholder =
        type === "title" ||
        type === "heading1" ||
        type === "heading2" ||
        (type === "paragraph" && hasSingleStarterParagraph && index === 1);

      applyBlockDecoration(element, node.getKey(), type, isEmpty, showPlaceholder);
    });
  });
}

function decorateActiveEditorBlock(editor: LexicalEditor): void {
  editor.getEditorState().read(() => {
    const root = $getRoot();
    const selection = $getSelection();

    if (!$isRangeSelection(selection)) {
      return;
    }

    const activeTopLevel = selection.anchor.getNode().getTopLevelElement();

    if (
      !activeTopLevel ||
      activeTopLevel.getParent() !== root ||
      !$isElementNode(activeTopLevel)
    ) {
      return;
    }

    const first = root.getFirstChild();
    if (!first || !$isElementNode(first)) {
      return;
    }

    const second = first.getNextSibling();
    const hasSingleStarterParagraph =
      !!second &&
      !second.getNextSibling() &&
      $isParagraphNode(second) &&
      isLexicalElementEmpty(second);
    const isTitle = activeTopLevel.getKey() === first.getKey();
    const type: Block["type"] = isTitle
      ? "title"
      : $isHeadingNode(activeTopLevel)
        ? activeTopLevel.getTag() === "h3"
          ? "heading2"
          : "heading1"
        : "paragraph";
    const showPlaceholder =
      type === "title" ||
      type === "heading1" ||
      type === "heading2" ||
      (type === "paragraph" &&
        hasSingleStarterParagraph &&
        !!second &&
        second.getKey() === activeTopLevel.getKey());
    const element = editor.getElementByKey(activeTopLevel.getKey());

    if (!element) {
      return;
    }

    applyBlockDecoration(
      element,
      activeTopLevel.getKey(),
      type,
      isLexicalElementEmpty(activeTopLevel),
      showPlaceholder,
    );
  });
}

function EditorReadyPlugin({ onEditorReady }: { onEditorReady: (editor: LexicalEditor | null) => void }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    onEditorReady(editor);
  }, [editor, onEditorReady]);

  return null;
}

function ExternalBlocksSyncPlugin({
  blocks,
  editorBlocksRef,
}: {
  blocks: Block[];
  editorBlocksRef: MutableRefObject<Block[]>;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    // Most updates come from the editor itself. Skip expensive work for those.
    if (areBlocksEqual(blocks, editorBlocksRef.current)) {
      return;
    }

    editor.update(
      () => {
        writeBlocksToLexicalRoot(blocks);
      },
      { tag: "external-sync" },
    );

    editorBlocksRef.current = blocks;
  }, [blocks, editor, editorBlocksRef]);

  return null;
}

interface BehaviorPluginProps {
  onBlocksChange: (nextBlocks: Block[]) => void;
  onSelectionToolbarChange: (visible: boolean) => void;
  onSelectionToolbarActiveChange: (state: SelectionToolbarActiveState) => void;
  onActiveBlockChange: (blockId: string | null) => void;
}

function ManuscriptBehaviorPlugin({
  onBlocksChange,
  onSelectionToolbarChange,
  onSelectionToolbarActiveChange,
  onActiveBlockChange,
}: BehaviorPluginProps) {
  const [editor] = useLexicalComposerContext();
  const lastNonEmptyTitleHtmlRef = useRef<string>("");
  const lastActiveBlockKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let frameId: number | null = null;
    let scrollFrameId: number | null = null;
    let pendingDecoration: "none" | "active" | "full" = "none";

    const scheduleDecoration = (mode: "active" | "full") => {
      if (mode === "full") {
        pendingDecoration = "full";
      } else if (pendingDecoration === "none") {
        pendingDecoration = "active";
      }

      if (frameId !== null) {
        return;
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        const nextMode = pendingDecoration;
        pendingDecoration = "none";

        if (nextMode === "full") {
          decorateEditorBlocks(editor);
          return;
        }

        if (nextMode === "active") {
          decorateActiveEditorBlock(editor);
        }
      });
    };

    const scheduleComfortScroll = () => {
      if (scrollFrameId !== null) {
        window.cancelAnimationFrame(scrollFrameId);
      }

      scrollFrameId = window.requestAnimationFrame(() => {
        scrollFrameId = null;
        keepCaretComfortablyVisible(editor);
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

        if (key === "z") {
          if (event.shiftKey) {
            return false;
          }

          event.preventDefault();

          const undoHandled = editor.dispatchCommand(UNDO_COMMAND, undefined);

          if (undoHandled) {
            return true;
          }

          let shouldRestoreTitle = false;
          editor.getEditorState().read(() => {
            const selectionInTitle = selectionTouchesTitleBlock();
            const titleIsEmpty = titleBlockIsEmpty();
            shouldRestoreTitle =
              selectionInTitle &&
              titleIsEmpty &&
              lastNonEmptyTitleHtmlRef.current.trim().length > 0;
          });

          if (!shouldRestoreTitle) {
            return false;
          }

          const titleHtml = lastNonEmptyTitleHtmlRef.current;

          editor.update(() => {
            restoreTitleBlockFromHtml(titleHtml);
          });

          return true;
        }

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

        if (key === "1" || key === "2" || key === "3") {
          event.preventDefault();
          editor.update(() => {
            if (key === "1") {
              setSelectedTopLevelBlocksToType("heading1");
              return;
            }

            if (key === "2") {
              setSelectedTopLevelBlocksToType("heading2");
              return;
            }

            setSelectedTopLevelBlocksToType("paragraph");
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
          editor.update(() => {
            selectTopLevelBlockContentByKey(focusedBlockKey as string);
          });
          return true;
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
      let nextSelectionToolbarActiveState = EMPTY_SELECTION_TOOLBAR_ACTIVE_STATE;
      const hasStructureMutation = dirtyElements.size > 0;
      const hasDocumentMutation = hasStructureMutation || dirtyLeaves.size > 0;
      let nextBlocks: Block[] = [];
      let activeBlockKey: string | null = null;

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
        nextSelectionToolbarActiveState = readSelectionToolbarActiveState();

        if ($isRangeSelection(selection)) {
          const activeTopLevel = selection.anchor.getNode().getTopLevelElement();

          if (
            activeTopLevel &&
            activeTopLevel.getParent() === $getRoot() &&
            $isElementNode(activeTopLevel)
          ) {
            activeBlockKey = activeTopLevel.getKey();
          }
        }
      });

      onSelectionToolbarChange(hasSelectionText && !selectionIncludesTitle);
      onSelectionToolbarActiveChange(
        hasSelectionText && !selectionIncludesTitle
          ? nextSelectionToolbarActiveState
          : EMPTY_SELECTION_TOOLBAR_ACTIVE_STATE,
      );

      const activeBlockChanged = lastActiveBlockKeyRef.current !== activeBlockKey;

      if (lastActiveBlockKeyRef.current !== activeBlockKey) {
        lastActiveBlockKeyRef.current = activeBlockKey;
        onActiveBlockChange(activeBlockKey);
      }

      if (hasStructureMutation) {
        scheduleDecoration("full");
      } else if (hasDocumentMutation || activeBlockChanged) {
        scheduleDecoration("active");
      }

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
        const nextTitle = nextBlocks[0];
        if (nextTitle?.type === "title" && hasMeaningfulInlineHtml(nextTitle.text)) {
          lastNonEmptyTitleHtmlRef.current = nextTitle.text;
        }

        onBlocksChange(nextBlocks);
        scheduleComfortScroll();
      }
    });

    scheduleDecoration("full");

    return () => {
      unregisterEnter();
      unregisterBlockSelectAll();
      unregisterUpdates();

      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      if (scrollFrameId !== null) {
        window.cancelAnimationFrame(scrollFrameId);
      }
    };
  }, [editor, onActiveBlockChange, onBlocksChange, onSelectionToolbarActiveChange, onSelectionToolbarChange]);

  return null;
}

function EditorCanvasComponent({
  blocks,
  onEditorReady,
  onBlocksChange,
  onSelectionToolbarChange,
  onSelectionToolbarActiveChange,
  onActiveBlockChange,
  showMap,
  onToggleMap,
}: EditorCanvasProps) {
  const { showChrome, menuLabel, toggleChrome, isMobileOS } = useEditorChrome();
  const initialBlocksRef = useRef<Block[]>(blocks);
  const lastEditorBlocksRef = useRef<Block[]>(blocks);
  const [isDesktopPointer, setIsDesktopPointer] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  });
  const [showFloatingToggle, setShowFloatingToggle] = useState<boolean>(true);

  const initialConfig = useMemo(
    () => ({
      namespace: "book-writer-editor",
      theme: {
        heading: {
          h1: "editor-block block-title",
          h2: "editor-block block-heading-1",
          h3: "editor-block block-heading-2",
          h4: "editor-block block-heading-2",
          h5: "editor-block block-heading-2",
          h6: "editor-block block-heading-2",
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

  const handleBlocksChange = useCallback((nextBlocks: Block[]) => {
    lastEditorBlocksRef.current = nextBlocks;
    onBlocksChange(nextBlocks);
  }, [onBlocksChange]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
    const apply = () => {
      setIsDesktopPointer(mediaQuery.matches);
      setShowFloatingToggle(true);
    };

    apply();

    mediaQuery.addEventListener("change", apply);
    return () => {
      mediaQuery.removeEventListener("change", apply);
    };
  }, []);

  useEffect(() => {
    if (!isDesktopPointer) {
      setShowFloatingToggle(true);
      return;
    }

    if (showChrome || showMap) {
      setShowFloatingToggle(true);
      return;
    }

    let timeoutId: number | null = null;

    const resetFadeTimer = () => {
      setShowFloatingToggle(true);

      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }

      timeoutId = window.setTimeout(() => {
        setShowFloatingToggle(false);
      }, 2000);
    };

    resetFadeTimer();

    window.addEventListener("mousemove", resetFadeTimer, { passive: true });

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }

      window.removeEventListener("mousemove", resetFadeTimer);
    };
  }, [isDesktopPointer, showChrome, showMap]);

  return (
    <main className="editor-shell">
      <button
        className={`floating-toggle floating-map-toggle ${isMobileOS ? "mobile-os" : ""} ${
          showMap ? "is-active" : ""
        } ${
          isDesktopPointer && !showFloatingToggle ? "inactive" : ""
        }`}
        type="button"
        onClick={() => {
          onSelectionToolbarChange(false);
          onToggleMap();
        }}
        aria-label={showMap ? "Close map" : "Open map"}
      >
        <span className="floating-toggle-icon" aria-hidden="true">
          <BookText size={18} />
        </span>
      </button>

      <button
        className={`floating-toggle ${isMobileOS ? "mobile-os" : ""} ${
          isDesktopPointer && !showFloatingToggle ? "inactive" : ""
        }`}
        type="button"
        onClick={() => {
          onSelectionToolbarChange(false);
          toggleChrome();
        }}
        aria-label={showChrome ? "Close menu" : "Open menu"}
      >
        <span className="floating-toggle-label">{menuLabel}</span>
        <span className="floating-toggle-icon" aria-hidden="true">
          {showChrome ? <X size={18} /> : <Menu size={18} />}
        </span>
      </button>

      <LexicalComposer initialConfig={initialConfig}>
        <EditorReadyPlugin onEditorReady={onEditorReady} />
        <ExternalBlocksSyncPlugin blocks={blocks} editorBlocksRef={lastEditorBlocksRef} />
        <ManuscriptBehaviorPlugin
          onBlocksChange={handleBlocksChange}
          onSelectionToolbarChange={onSelectionToolbarChange}
          onSelectionToolbarActiveChange={onSelectionToolbarActiveChange}
          onActiveBlockChange={onActiveBlockChange}
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
