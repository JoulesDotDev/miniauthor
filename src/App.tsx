import { useCallback, useEffect, useMemo, useState } from "react";

import { ConflictModal } from "@/components/editor/ConflictModal";
import { EditorCanvas } from "@/components/editor/EditorCanvas";
import { SelectionToolbar } from "@/components/editor/SelectionToolbar";
import { SyncPanel } from "@/components/editor/SyncPanel";
import { WritingPanel } from "@/components/editor/WritingPanel";
import { EditorChromeProvider } from "@/contexts/EditorChromeContext";
import { useDropboxSync } from "@/hooks/useDropboxSync";
import { useManuscriptEditor } from "@/hooks/useManuscriptEditor";
import type { Block } from "@/lib/editor-types";
import { buildSideBySideDiffRows } from "@/lib/merge";
import { createBlock, splitBlocksToMarkdownPages } from "@/lib/markdown";

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

  const isMac = useMemo(() => detectMacPlatform(), []);
  const toggleChrome = useCallback(() => {
    setShowChrome((current) => !current);
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

  const diffRows = useMemo(() => {
    if (!conflict) {
      return [];
    }

    return buildSideBySideDiffRows(conflict.local, conflict.remote);
  }, [conflict]);

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
      <div className={`app-shell ${showChrome ? "chrome-visible" : ""}`}>
        <WritingPanel
          updatedAtText={formatTime(updatedAt)}
          lastSyncedAtText={formatTime(lastSyncedAt)}
          isOnline={isOnline}
        />

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
          updatedAtText={formatTime(updatedAt)}
          lastSyncedAtText={formatTime(lastSyncedAt)}
          isOnline={isOnline}
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
    </EditorChromeProvider>
  );
}

export default App;
