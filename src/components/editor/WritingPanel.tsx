interface WritingPanelProps {
  open: boolean;
  updatedAtText: string;
  lastSyncedAtText: string;
  isOnline: boolean;
  isMac: boolean;
}

function getShortcuts(isMac: boolean): Array<{ key: string; action: string }> {
  const mod = isMac ? "⌘" : "Ctrl";
  const shift = isMac ? "⇧" : "Shift";

  return [
    { key: `${mod} S`, action: "Sync now" },
    { key: `${mod} B`, action: "Bold" },
    { key: `${mod} I`, action: "Italic" },
    { key: `${mod} U`, action: "Underline" },
    { key: `${mod} 1`, action: "Main headline" },
    { key: `${mod} 2`, action: "Section headline" },
    { key: `${mod} 0`, action: "Paragraph" },
    { key: `${mod} Enter`, action: "New block" },
    { key: `${mod} ${shift} P`, action: "Insert page break" },
  ];
}

export function WritingPanel({
  open,
  updatedAtText,
  lastSyncedAtText,
  isOnline,
  isMac,
}: WritingPanelProps) {
  const shortcuts = getShortcuts(isMac);

  return (
    <aside className={`settings-panel panel-left ${open ? "open" : ""}`}>
      <h2>Shortcuts</h2>
      <p>Writing-first controls.</p>
      <div className="shortcut-list" aria-label="Keyboard shortcuts">
        {shortcuts.map((item) => (
          <div key={item.key} className="shortcut-row">
            <kbd>{item.key}</kbd>
            <span>{item.action}</span>
          </div>
        ))}
      </div>
      <div className="meta-box">
        <div>Updated: {updatedAtText}</div>
        <div>Synced: {lastSyncedAtText}</div>
        <div>{isOnline ? "Online" : "Offline"}</div>
      </div>
    </aside>
  );
}
