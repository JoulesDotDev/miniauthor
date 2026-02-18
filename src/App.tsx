import { useCallback, useEffect, useMemo, useState } from "react";

import { ConflictModal } from "@/components/editor/ConflictModal";
import { EditorCanvas } from "@/components/editor/EditorCanvas";
import { SelectionToolbar } from "@/components/editor/SelectionToolbar";
import { SyncPanel } from "@/components/editor/SyncPanel";
import { EditorChromeProvider } from "@/contexts/EditorChromeContext";
import { useDropboxSync } from "@/hooks/useDropboxSync";
import { useManuscriptEditor } from "@/hooks/useManuscriptEditor";
import type { Block } from "@/lib/editor-types";
import { createBlock, splitBlocksToMarkdownPages } from "@/lib/markdown";

const THEME_STORAGE_KEY = "book-writer-theme";

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

function detectMacPlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? navigator.platform ?? navigator.userAgent;

  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

export function App() {
  const dropboxAppKey = import.meta.env.VITE_DROPBOX_APP_KEY as string | undefined;
  const dropboxRedirectUri =
    (import.meta.env.VITE_DROPBOX_REDIRECT_URI as string | undefined) ??
    `${window.location.origin}${window.location.pathname}`;

  const [blocks, setBlocks] = useState<Block[]>([createBlock("title"), createBlock("paragraph")]);
  const [updatedAt, setUpdatedAt] = useState<number>(Date.now());
  const [showChrome, setShowChrome] = useState<boolean>(false);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [theme, setTheme] = useState<"light" | "dark">(() => getStoredTheme() ?? getSystemTheme());
  const [hasThemeOverride, setHasThemeOverride] = useState<boolean>(() => getStoredTheme() !== null);

  const isMac = useMemo(() => detectMacPlatform(), []);
  const toggleChrome = useCallback(() => {
    setShowChrome((current) => !current);
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
    markdownPreview,
    showSelectionToolbar,
    setLexicalEditor,
    handleEditorBlocksChange,
    handleSelectionToolbarChange,
    transformFocusedBlockType,
    applyInlineFormat,
  } = editor;

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
      if (event.defaultPrevented) {
        return;
      }

      if (event.key === "Alt" && !event.repeat) {
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
    syncWithDropbox,
    toggleChrome,
  ]);

  return (
    <EditorChromeProvider showChrome={showChrome} toggleChrome={toggleChrome} isMac={isMac}>
      <div
        className={`app-shell ${showChrome ? "chrome-visible" : ""}`}
        onPointerDownCapture={(event) => {
          const target = event.target as HTMLElement;

          if (target.closest(".settings-panel, .floating-toggle")) {
            handleSelectionToolbarChange(false);
          }
        }}
      >
        <SelectionToolbar
          visible={showSelectionToolbar}
          onBold={() => applyInlineFormat("bold")}
          onItalic={() => applyInlineFormat("italic")}
          onHeading1={() => transformFocusedBlockType("heading1")}
          onHeading2={() => transformFocusedBlockType("heading2")}
          onParagraph={() => transformFocusedBlockType("paragraph")}
        />

        <EditorCanvas
          blocks={blocks}
          onEditorReady={setLexicalEditor}
          onBlocksChange={handleEditorBlocksChange}
          onSelectionToolbarChange={handleSelectionToolbarChange}
        />

        <SyncPanel
          syncNotice={syncNotice}
          isConnected={Boolean(dropboxToken)}
          isSyncing={isSyncing}
          hasDropboxAppKey={Boolean(dropboxAppKey)}
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
