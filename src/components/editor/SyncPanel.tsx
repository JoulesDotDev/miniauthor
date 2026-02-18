import { useEditorChrome } from "@/contexts/EditorChromeContext";
import { FileDown, Files, Link2, RefreshCw, Unlink2 } from "lucide-react";

interface SyncPanelProps {
  syncNotice: string;
  isConnected: boolean;
  isSyncing: boolean;
  hasDropboxAppKey: boolean;
  updatedAtText: string;
  lastSyncedAtText: string;
  isOnline: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onSync: () => void;
  onExportMarkdown: () => void;
  onExportSplitPages: () => void;
}

export function SyncPanel({
  syncNotice,
  isConnected,
  isSyncing,
  hasDropboxAppKey,
  updatedAtText,
  lastSyncedAtText,
  isOnline,
  onConnect,
  onDisconnect,
  onSync,
  onExportMarkdown,
  onExportSplitPages,
}: SyncPanelProps) {
  const { showChrome } = useEditorChrome();

  return (
    <aside className={`settings-panel panel-right ${showChrome ? "open" : ""}`}>
      <h2>Sync</h2>
      <p>{syncNotice}</p>
      <div className="button-row">
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
      <div className="panel-divider" aria-hidden="true" />
      <div className="button-row">
        <button type="button" onClick={onExportMarkdown}>
          <FileDown size={15} />
          <span>Export Manuscript</span>
        </button>
      </div>
      <div className="button-row">
        <button type="button" onClick={onExportSplitPages}>
          <Files size={15} />
          <span>Export split pages</span>
        </button>
      </div>
      <div className="meta-box mobile-meta-box">
        <div>Updated: {updatedAtText}</div>
        <div>Synced: {lastSyncedAtText}</div>
        <div className={`status-row ${isOnline ? "online" : "offline"}`}>
          <span className="status-dot" aria-hidden="true" />
          <span>{isOnline ? "Online" : "Offline"}</span>
        </div>
      </div>
      {!hasDropboxAppKey ? (
        <div className="warning-box">Set VITE_DROPBOX_APP_KEY and optionally VITE_DROPBOX_REDIRECT_URI.</div>
      ) : null}
    </aside>
  );
}
