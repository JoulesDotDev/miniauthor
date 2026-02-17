import { useEditorChrome } from "@/contexts/EditorChromeContext";

interface WritingPanelProps {
  updatedAtText: string;
  lastSyncedAtText: string;
  isOnline: boolean;
}

function getShortcuts(isMac: boolean): Array<{ key: string; action: string }> {
  const mod = isMac ? "⌘" : "Ctrl";

  return [
    { key: `${mod} S`, action: "Sync now" },
    { key: `${mod} B`, action: "Bold" },
    { key: `${mod} I`, action: "Italic" },
    { key: `${mod} U`, action: "Underline" },
    { key: `${mod} 2`, action: "Section headline" },
    { key: `${mod} 0`, action: "Paragraph" },
    { key: "Enter", action: "New block" },
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

export function WritingPanel({
  updatedAtText,
  lastSyncedAtText,
  isOnline,
}: WritingPanelProps) {
  const { showChrome, isMac } = useEditorChrome();
  const shortcuts = getShortcuts(isMac);

  return (
    <aside className={`settings-panel panel-left ${showChrome ? "open" : ""}`}>
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
      <div className="meta-box">
        <div>Updated: {updatedAtText}</div>
        <div>Synced: {lastSyncedAtText}</div>
        <div>{isOnline ? "Online" : "Offline"}</div>
      </div>
    </aside>
  );
}
