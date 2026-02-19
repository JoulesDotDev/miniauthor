import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Save } from "lucide-react";

import { ConflictModal } from "@/components/editor/ConflictModal";
import { EditorCanvas } from "@/components/editor/EditorCanvas";
import { MapPanel, type OutlineItem } from "@/components/editor/MapPanel";
import { SelectionToolbar } from "@/components/editor/SelectionToolbar";
import { SyncPanel } from "@/components/editor/SyncPanel";
import { EditorChromeProvider } from "@/contexts/EditorChromeContext";
import { useDropboxSync } from "@/hooks/useDropboxSync";
import { useManuscriptEditor } from "@/hooks/useManuscriptEditor";
import type { Block } from "@/lib/editor-types";
import { createBlock, serializeBlocksToMarkdown, splitBlocksToMarkdownPages } from "@/lib/markdown";

const THEME_STORAGE_KEY = "book-writer-theme";
const APP_NAME = "Mini Author .app";
const APP_VERSION = "1.0.0";
const MIN_SYNC_FEEDBACK_MS = 500;

function getStoredTheme(): "light" | "dark" | null {
  if (typeof window === "undefined") {
    return null;
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return storedTheme === "light" || storedTheme === "dark" ? storedTheme : null;
}

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
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

function toDownloadSafeBaseName(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

  return cleaned.length > 0 ? cleaned : "manuscript";
}

function detectMacPlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? navigator.platform ?? navigator.userAgent;

  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

function detectMobileOSPlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? "";
  const userAgent = navigator.userAgent ?? "";
  const isIos = /iPhone|iPad|iPod/i.test(platform) || /iPhone|iPad|iPod/i.test(userAgent);
  const isAndroid = /Android/i.test(platform) || /Android/i.test(userAgent);

  return isIos || isAndroid;
}

function stripHtmlText(value: string): string {
  if (!value) {
    return "";
  }

  const normalizeWhitespace = (input: string) =>
    input
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  if (!value.includes("<")) {
    return normalizeWhitespace(value);
  }

  if (typeof document === "undefined") {
    return normalizeWhitespace(
      value
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/g, " "),
    );
  }

  const parser = document.createElement("div");
  parser.innerHTML = value;
  return normalizeWhitespace(parser.textContent ?? "");
}

type OutlineEntry = OutlineItem & { index: number };
type OutlineBlock = Block & { type: "title" | "heading1" | "heading2" };

export function App() {
  const dropboxAppKey = import.meta.env.VITE_DROPBOX_APP_KEY as string | undefined;
  const dropboxRedirectUri =
    (import.meta.env.VITE_DROPBOX_REDIRECT_URI as string | undefined) ??
    `${window.location.origin}${window.location.pathname}`;

  const [blocks, setBlocks] = useState<Block[]>([createBlock("title"), createBlock("paragraph")]);
  const [updatedAt, setUpdatedAt] = useState<number>(Date.now());
  const [showChrome, setShowChrome] = useState<boolean>(false);
  const [showMap, setShowMap] = useState<boolean>(false);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [showSyncFeedback, setShowSyncFeedback] = useState<boolean>(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => getStoredTheme() ?? getSystemTheme());
  const [hasThemeOverride, setHasThemeOverride] = useState<boolean>(() => getStoredTheme() !== null);
  const syncFeedbackStartRef = useRef<number | null>(null);

  const isMac = useMemo(() => detectMacPlatform(), []);
  const isMobileOS = useMemo(() => detectMobileOSPlatform(), []);
  const toggleChrome = useCallback(() => {
    setShowMap(false);
    setShowChrome((current) => !current);
  }, []);
  const toggleMap = useCallback(() => {
    setShowChrome(false);
    setShowMap((current) => !current);
  }, []);
  const toggleTheme = useCallback(() => {
    setHasThemeOverride(true);
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  const editor = useManuscriptEditor({
    blocks,
    setBlocks,
    setUpdatedAt,
  });
  const {
    showSelectionToolbar,
    selectionToolbarActive,
    setLexicalEditor,
    handleEditorBlocksChange,
    handleSelectionToolbarChange,
    handleSelectionToolbarActiveChange,
    transformFocusedBlockType,
    applyInlineFormat,
    jumpToBlockById,
  } = editor;

  const outlineItems = useMemo<OutlineEntry[]>(
    () =>
      blocks
        .map((block, index) => ({ block, index }))
        .filter(
          (entry): entry is { block: OutlineBlock; index: number } =>
            entry.block.type === "title" ||
            entry.block.type === "heading1" ||
            entry.block.type === "heading2",
        )
        .map(({ block, index }) => {
          const plainText = stripHtmlText(block.text);
          const fallback = "Untitled";

          return {
            id: block.id,
            type: block.type,
            label: plainText.length > 0 ? plainText : fallback,
            index,
          };
        }),
    [blocks],
  );

  const activeOutlineId = useMemo(() => {
    if (outlineItems.length === 0) {
      return null;
    }

    if (!activeBlockId) {
      return outlineItems[0].id;
    }

    const activeIndex = blocks.findIndex((block) => block.id === activeBlockId);

    if (activeIndex < 0) {
      return outlineItems[0].id;
    }

    let resolvedId = outlineItems[0].id;

    for (const item of outlineItems) {
      if (item.index > activeIndex) {
        break;
      }

      resolvedId = item.id;
    }

    return resolvedId;
  }, [activeBlockId, blocks, outlineItems]);

  const {
    files,
    activeFileId,
    activeFileName,
    activeFileCloudAheadAt,
    lastSyncedAt,
    syncNotice,
    isSyncing,
    isPulling,
    dropboxToken,
    conflict,
    setConflict,
    syncWithDropbox,
    pullFileCatalog,
    connectDropbox,
    disconnectDropbox,
    resolveConflict,
    selectFile,
    createFile,
    renameActiveFile,
  } = useDropboxSync({
    blocks,
    setBlocks,
    updatedAt,
    setUpdatedAt,
    isOnline,
    dropboxAppKey,
    dropboxRedirectUri,
  });
  const isConflictOpen = Boolean(conflict);
  const showMenuBrand = (showChrome || showMap) && !isConflictOpen;
  const showSyncIndicator = showSyncFeedback && !showChrome && !showMap && !isConflictOpen;

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
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    if (!hasThemeOverride) {
      return;
    }

    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [hasThemeOverride, theme]);

  useEffect(() => {
    if (hasThemeOverride) {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const syncWithSystemTheme = () => {
      setTheme(mediaQuery.matches ? "dark" : "light");
    };

    mediaQuery.addEventListener("change", syncWithSystemTheme);

    return () => {
      mediaQuery.removeEventListener("change", syncWithSystemTheme);
    };
  }, [hasThemeOverride]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isConflictOpen) {
        return;
      }

      if (event.defaultPrevented) {
        return;
      }

      if ((event.key === "Escape" || event.key === "Esc") && !event.repeat) {
        event.preventDefault();
        toggleChrome();
        return;
      }

      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "s") {
        event.preventDefault();
        void syncWithDropbox();
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    isConflictOpen,
    syncWithDropbox,
    toggleChrome,
  ]);

  useEffect(() => {
    if (!isConflictOpen) {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    handleSelectionToolbarChange(false);
    setShowMap(false);

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [handleSelectionToolbarChange, isConflictOpen]);

  useEffect(() => {
    let hideTimer: number | null = null;

    if (isSyncing) {
      syncFeedbackStartRef.current = Date.now();
      setShowSyncFeedback(true);
      return;
    }

    if (!showSyncFeedback) {
      syncFeedbackStartRef.current = null;
      return;
    }

    const startedAt = syncFeedbackStartRef.current ?? Date.now();
    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(0, MIN_SYNC_FEEDBACK_MS - elapsed);

    if (remaining === 0) {
      setShowSyncFeedback(false);
      syncFeedbackStartRef.current = null;
      return;
    }

    hideTimer = window.setTimeout(() => {
      setShowSyncFeedback(false);
      syncFeedbackStartRef.current = null;
    }, remaining);

    return () => {
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
      }
    };
  }, [isSyncing, showSyncFeedback]);

  return (
    <EditorChromeProvider
      showChrome={showChrome}
      toggleChrome={toggleChrome}
      isMac={isMac}
      isMobileOS={isMobileOS}
    >
      <div
        className={`app-shell ${isConflictOpen ? "conflict-open" : ""}`}
        onPointerDownCapture={(event) => {
          const target = event.target as HTMLElement;

          if (target.closest(".settings-panel, .floating-toggle")) {
            handleSelectionToolbarChange(false);
          }
        }}
      >
        {showMenuBrand ? (
          <div className="menu-brand-chip" aria-hidden="true">
            <img src="/mini-author-icon.svg" alt="" className="menu-brand-chip-icon" />
            <span className="menu-brand-chip-name">{APP_NAME}</span>
            <span className="menu-brand-chip-version">{APP_VERSION}</span>
          </div>
        ) : null}

        {showSyncIndicator ? (
          <div className={`sync-feedback-chip ${isSyncing ? "is-syncing" : ""}`} role="status" aria-live="polite">
            <Save size={15} className={isSyncing ? "button-icon-spin" : undefined} />
          </div>
        ) : null}

        <MapPanel
          open={showMap && !isConflictOpen}
          items={outlineItems}
          activeItemId={activeOutlineId}
          onJump={(blockId) => {
            jumpToBlockById(blockId);
          }}
        />

        <SelectionToolbar
          visible={showSelectionToolbar && !isConflictOpen}
          active={selectionToolbarActive}
          onBold={() => applyInlineFormat("bold")}
          onItalic={() => applyInlineFormat("italic")}
          onHeading1={() => transformFocusedBlockType("heading1")}
          onHeading2={() => transformFocusedBlockType("heading2")}
          onParagraph={() => transformFocusedBlockType("paragraph")}
        />

        <EditorCanvas
          blocks={blocks}
          isSyncing={isSyncing}
          onEditorReady={setLexicalEditor}
          onBlocksChange={handleEditorBlocksChange}
          onSelectionToolbarChange={handleSelectionToolbarChange}
          onSelectionToolbarActiveChange={handleSelectionToolbarActiveChange}
          onActiveBlockChange={(nextBlockId) => {
            setActiveBlockId((current) => (current === nextBlockId ? current : nextBlockId));
          }}
          showMap={showMap}
          onToggleMap={toggleMap}
        />

        <SyncPanel
          files={files}
          activeFileId={activeFileId}
          activeFileName={activeFileName}
          cloudAheadSyncHint={
            activeFileCloudAheadAt
              ? `Dropbox has newer changes from ${formatTime(activeFileCloudAheadAt)}.`
              : null
          }
          syncNotice={syncNotice}
          isConnected={Boolean(dropboxToken)}
          isSyncing={isSyncing}
          isPulling={isPulling}
          isConflictOpen={isConflictOpen}
          hasDropboxAppKey={Boolean(dropboxAppKey)}
          hideShortcuts={isMobileOS}
          theme={theme}
          updatedAtText={formatTime(updatedAt)}
          lastSyncedAtText={formatTime(lastSyncedAt)}
          isOnline={isOnline}
          onToggleTheme={toggleTheme}
          onConnect={() => {
            void connectDropbox();
          }}
          onDisconnect={disconnectDropbox}
          onSync={() => {
            void syncWithDropbox();
          }}
          onPullFiles={() => {
            void pullFileCatalog();
          }}
          onExportMarkdown={() => {
            const filenameBase = toDownloadSafeBaseName(activeFileName);
            downloadTextFile(`${filenameBase}.md`, serializeBlocksToMarkdown(blocks));
          }}
          onExportSplitPages={() => {
            const filenameBase = toDownloadSafeBaseName(activeFileName);
            const pages = splitBlocksToMarkdownPages(blocks);

            pages.forEach((page, index) => {
              downloadTextFile(`${filenameBase}-page-${index + 1}.md`, page);
            });
          }}
          onSelectFile={(fileId) => {
            void selectFile(fileId);
          }}
          onCreateFile={createFile}
          onRenameActiveFile={renameActiveFile}
        />

        <ConflictModal
          conflict={conflict}
          isSyncing={isSyncing}
          onChangeResolved={(text) => {
            setConflict((current) => (current ? { ...current, resolved: text } : current));
          }}
          onSaveResolution={() => {
            void resolveConflict();
          }}
          onClose={() => {
            setConflict(null);
          }}
        />
      </div>
    </EditorChromeProvider>
  );
}

export default App;
