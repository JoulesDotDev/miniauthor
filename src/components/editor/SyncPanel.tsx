import { useEditorChrome } from "@/contexts/EditorChromeContext";
import { FileDown, Files, Link2, Moon, RefreshCw, Sun, Unlink2 } from "lucide-react";

interface SyncPanelProps {
  syncNotice: string;
  isConnected: boolean;
  isSyncing: boolean;
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
  onExportMarkdown: () => void;
  onExportSplitPages: () => void;
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

export function SyncPanel({
  syncNotice,
  isConnected,
  isSyncing,
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
  onExportMarkdown,
  onExportSplitPages,
}: SyncPanelProps) {
  const { showChrome, isMac } = useEditorChrome();
  const shortcuts = getShortcuts(isMac);

  return (
    <aside className={`settings-panel panel-right ${showChrome ? "open" : ""}`}>
      <h2>Sync</h2>
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
        <button type="button" onClick={onSync} disabled={isSyncing}>
          <RefreshCw size={15} className={isSyncing ? "button-icon-spin" : undefined} />
          <span>{isSyncing ? "Syncing..." : "Sync Now"}</span>
        </button>
      </div>
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
  );
}
