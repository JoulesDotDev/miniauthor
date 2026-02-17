interface SyncPanelProps {
  open: boolean;
  syncNotice: string;
  isConnected: boolean;
  isSyncing: boolean;
  hasDropboxAppKey: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onSync: () => void;
  onExportMarkdown: () => void;
  onExportSplitPages: () => void;
}

export function SyncPanel({
  open,
  syncNotice,
  isConnected,
  isSyncing,
  hasDropboxAppKey,
  onConnect,
  onDisconnect,
  onSync,
  onExportMarkdown,
  onExportSplitPages,
}: SyncPanelProps) {
  return (
    <aside className={`settings-panel panel-right ${open ? "open" : ""}`}>
      <h2>Sync</h2>
      <p>{syncNotice}</p>
      <div className="button-row">
        {isConnected ? (
          <button type="button" onClick={onDisconnect}>Disconnect</button>
        ) : (
          <button type="button" onClick={onConnect}>Connect Dropbox</button>
        )}
        <button type="button" onClick={onSync} disabled={isSyncing}>
          {isSyncing ? "Syncing..." : "Sync Now"}
        </button>
      </div>
      <div className="button-row">
        <button type="button" onClick={onExportMarkdown}>
          Export Manuscript
        </button>
      </div>
      <div className="button-row">
        <button type="button" onClick={onExportSplitPages}>Export split pages</button>
      </div>
      {!hasDropboxAppKey ? (
        <div className="warning-box">Set VITE_DROPBOX_APP_KEY and optionally VITE_DROPBOX_REDIRECT_URI.</div>
      ) : null}
    </aside>
  );
}
