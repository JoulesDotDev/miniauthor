import { useMemo, useState } from "react";
import { ArrowDown, Edit3, FileText, FileDown, Files, Link2, Moon, Plus, RefreshCw, Sun, Unlink2 } from "lucide-react";

import { useEditorChrome } from "@/contexts/EditorChromeContext";
import type { ManuscriptFileMeta } from "@/lib/editor-types";

interface SyncPanelProps {
  files: ManuscriptFileMeta[];
  activeFileId: string | null;
  activeFileName: string;
  cloudAheadSyncHint: string | null;
  syncNotice: string;
  isConnected: boolean;
  isSyncing: boolean;
  isPulling: boolean;
  isConflictOpen: boolean;
  hasDropboxAppKey: boolean;
  hideShortcuts: boolean;
  theme: "light" | "dark";
  updatedAtText: string;
  lastSyncedAtText: string;
  isOnline: boolean;
  onToggleTheme: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onSync: () => void;
  onPullFiles: () => void;
  onExportMarkdown: () => void;
  onExportSplitPages: () => void;
  onSelectFile: (fileId: string) => void | Promise<void>;
  onCreateFile: (name: string) => Promise<boolean>;
  onRenameActiveFile: (name: string) => Promise<boolean>;
}

function getShortcuts(isMac: boolean): Array<{ key: string; action: string }> {
  const mod = isMac ? "⌘" : "Ctrl";

  return [
    { key: `${mod} S`, action: "Sync now" },
    { key: `${mod} B`, action: "Bold" },
    { key: `${mod} I`, action: "Italic" },
    { key: `${mod} 1`, action: "Heading 1" },
    { key: `${mod} 2`, action: "Heading 2" },
    { key: `${mod} 3`, action: "Paragraph" },
  ];
}

function renderShortcutKey(key: string, isMac: boolean) {
  return key.split(" ").map((token, index) => {
    const isMacModifier = isMac && (token === "⌘" || token === "⇧" || token === "⌥");

    return (
      <span key={`${token}-${index}`} className={isMacModifier ? "shortcut-modifier" : undefined}>
        {token}
      </span>
    );
  });
}

type FileDialogMode = "create" | "rename";

export function SyncPanel({
  files,
  activeFileId,
  activeFileName,
  cloudAheadSyncHint,
  syncNotice,
  isConnected,
  isSyncing,
  isPulling,
  isConflictOpen,
  hasDropboxAppKey,
  hideShortcuts,
  theme,
  updatedAtText,
  lastSyncedAtText,
  isOnline,
  onToggleTheme,
  onConnect,
  onDisconnect,
  onSync,
  onPullFiles,
  onExportMarkdown,
  onExportSplitPages,
  onSelectFile,
  onCreateFile,
  onRenameActiveFile,
}: SyncPanelProps) {
  const { showChrome, isMac } = useEditorChrome();
  const shortcuts = getShortcuts(isMac);
  const fileActionsDisabled = isSyncing || isConflictOpen;
  const [fileDialogMode, setFileDialogMode] = useState<FileDialogMode | null>(null);
  const [fileDialogValue, setFileDialogValue] = useState<string>("");
  const [isFileDialogSubmitting, setIsFileDialogSubmitting] = useState<boolean>(false);
  const fileDialogTitle = fileDialogMode === "rename" ? "Rename manuscript" : "New manuscript";
  const fileDialogSubmitLabel = fileDialogMode === "rename" ? "Save Name" : "Create File";
  const fileDialogDescription =
    fileDialogMode === "rename"
      ? "Update the name shown in your manuscript list."
      : "Give your new manuscript a clear name.";
  const normalizedFileDialogValue = fileDialogValue.trim();
  const canSubmitFileDialog = normalizedFileDialogValue.length > 0 && !isFileDialogSubmitting;

  const fileOptions = useMemo(
    () =>
      files.map((file) => (
        <option key={file.id} value={file.id}>
          {file.name}
        </option>
      )),
    [files],
  );

  return (
    <>
      <aside className={`settings-panel panel-right ${showChrome ? "open" : ""}`}>
        <h2>Manuscripts</h2>
        <div className="file-picker-row">
          <div className="file-picker-select-wrap">
            <FileText size={15} aria-hidden="true" />
            <select
              value={activeFileId ?? ""}
              className="file-picker-select"
              disabled={fileActionsDisabled || files.length === 0}
              onChange={(event) => {
                const nextId = event.target.value;
                if (!nextId) {
                  return;
                }
                void onSelectFile(nextId);
              }}
              aria-label="Select manuscript"
            >
              {fileOptions}
            </select>
          </div>
          <button
            type="button"
            className="file-picker-icon-button"
            disabled={fileActionsDisabled}
            onClick={() => {
              setFileDialogMode("create");
              setFileDialogValue("");
            }}
            aria-label="Create manuscript"
            title="Create manuscript"
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="file-picker-secondary-row">
          <button
            type="button"
            className="file-picker-secondary-button"
            disabled={fileActionsDisabled || !activeFileId}
            onClick={() => {
              setFileDialogMode("rename");
              setFileDialogValue(activeFileName);
            }}
          >
            <Edit3 size={14} />
            <span>Rename</span>
          </button>
          <button
            type="button"
            className="file-picker-secondary-button"
            disabled={fileActionsDisabled || !isConnected || !isOnline || isPulling}
            onClick={onPullFiles}
            aria-label="Pull files from Dropbox"
            title="Pull files from Dropbox"
          >
            <ArrowDown size={16} className={isPulling ? "button-icon-spin" : undefined} />
            <span>{isPulling ? "Pulling..." : "Pull"}</span>
          </button>
        </div>

        <h2 className="panel-section-title">Sync</h2>
        <p>{syncNotice}</p>
        <div className="button-row sync-actions">
          {isConnected ? (
            <button type="button" onClick={onDisconnect}>
              <Unlink2 size={15} />
              <span>Disconnect</span>
            </button>
          ) : (
            <button type="button" onClick={onConnect}>
              <Link2 size={15} />
              <span>Connect Dropbox</span>
            </button>
          )}
          <button type="button" onClick={onSync} disabled={isSyncing || isPulling || !activeFileId || !isOnline}>
            <RefreshCw size={15} className={isSyncing ? "button-icon-spin" : undefined} />
            <span>{isSyncing ? "Syncing..." : "Sync Now"}</span>
          </button>
        </div>
        {cloudAheadSyncHint ? (
          <p className="sync-cloud-ahead-hint">{cloudAheadSyncHint}</p>
        ) : null}
        <div className="meta-box status-meta-box">
          <div>Updated: {updatedAtText}</div>
          <div>Synced: {lastSyncedAtText}</div>
          <div className={`status-row ${isOnline ? "online" : "offline"}`}>
            <span className="status-dot" aria-hidden="true" />
            <span>{isOnline ? "Online" : "Offline"}</span>
          </div>
        </div>
        <h2 className="panel-section-title">Export</h2>
        <div className="button-row export-actions">
          <button type="button" onClick={onExportMarkdown} className="button-with-subtitle">
            <FileDown size={15} />
            <span className="button-copy">
              <span>Export Manuscript</span>
              <span className="button-subtitle">Single .md file with your full draft.</span>
            </span>
          </button>
          <button type="button" onClick={onExportSplitPages} className="button-with-subtitle">
            <Files size={15} />
            <span className="button-copy">
              <span>Export Split Pages</span>
              <span className="button-subtitle">One .md file per Heading 1 section.</span>
            </span>
          </button>
        </div>
        <h2 className="panel-section-title">Settings</h2>
        <div className="button-row theme-actions">
          <button type="button" onClick={onToggleTheme}>
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            <span>{theme === "dark" ? "Use light theme" : "Use dark theme"}</span>
          </button>
        </div>
        {hideShortcuts ? null : (
          <div className="shortcuts-section">
            <h2>Shortcuts</h2>
            <p>Writing-first controls.</p>
            <div className="shortcut-list" aria-label="Keyboard shortcuts">
              {shortcuts.map((item) => (
                <div key={item.key} className="shortcut-row">
                  <kbd>{renderShortcutKey(item.key, isMac)}</kbd>
                  <span>{item.action}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {!hasDropboxAppKey ? (
          <div className="warning-box">Set VITE_DROPBOX_APP_KEY and optionally VITE_DROPBOX_REDIRECT_URI.</div>
        ) : null}
      </aside>

      {fileDialogMode ? (
        <div
          className="file-name-modal-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => {
            if (!isFileDialogSubmitting) {
              setFileDialogMode(null);
            }
          }}
        >
          <div
            className="file-name-modal"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <h3>{fileDialogTitle}</h3>
            <p>{fileDialogDescription}</p>
            <input
              className="file-name-input"
              type="text"
              placeholder={fileDialogMode === "rename" ? "Manuscript name" : "New manuscript name"}
              value={fileDialogValue}
              autoFocus
              onChange={(event) => {
                setFileDialogValue(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape" && !isFileDialogSubmitting) {
                  event.preventDefault();
                  setFileDialogMode(null);
                  return;
                }

                if (event.key !== "Enter" || !canSubmitFileDialog) {
                  return;
                }

                event.preventDefault();
                const submit = async () => {
                  setIsFileDialogSubmitting(true);

                  const success =
                    fileDialogMode === "rename"
                      ? await onRenameActiveFile(normalizedFileDialogValue)
                      : await onCreateFile(normalizedFileDialogValue);

                  setIsFileDialogSubmitting(false);

                  if (success) {
                    setFileDialogMode(null);
                  }
                };

                void submit();
              }}
            />
            <div className="file-name-modal-actions">
              <button
                type="button"
                onClick={() => {
                  if (!isFileDialogSubmitting) {
                    setFileDialogMode(null);
                  }
                }}
                disabled={isFileDialogSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!canSubmitFileDialog}
                onClick={() => {
                  const submit = async () => {
                    setIsFileDialogSubmitting(true);

                    const success =
                      fileDialogMode === "rename"
                        ? await onRenameActiveFile(normalizedFileDialogValue)
                        : await onCreateFile(normalizedFileDialogValue);

                    setIsFileDialogSubmitting(false);

                    if (success) {
                      setFileDialogMode(null);
                    }
                  };

                  void submit();
                }}
              >
                {isFileDialogSubmitting ? "Saving..." : fileDialogSubmitLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
