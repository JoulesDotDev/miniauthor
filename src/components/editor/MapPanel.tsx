import { FileText, Heading1, Heading2 } from "lucide-react";

export interface OutlineItem {
  id: string;
  type: "title" | "heading1" | "heading2";
  label: string;
}

interface MapPanelProps {
  open: boolean;
  items: OutlineItem[];
  activeItemId: string | null;
  onJump: (blockId: string) => void;
}

export function MapPanel({
  open,
  items,
  activeItemId,
  onJump,
}: MapPanelProps) {
  return (
    <aside className={`settings-panel map-panel ${open ? "open" : ""}`}>
      <h2>Map</h2>
      <p>Jump to any section in your manuscript.</p>

      <div className="map-tree" aria-label="Manuscript outline" role="tree">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`map-tree-item level-${item.type} ${activeItemId === item.id ? "is-active" : ""}`}
            onClick={() => {
              onJump(item.id);
            }}
            role="treeitem"
            aria-current={activeItemId === item.id ? "true" : undefined}
          >
            <span className="map-tree-branch" aria-hidden="true" />
            <span className="map-tree-icon" aria-hidden="true">
              {item.type === "title" ? <FileText size={16} /> : null}
              {item.type === "heading1" ? <Heading1 size={16} /> : null}
              {item.type === "heading2" ? <Heading2 size={16} /> : null}
            </span>
            <span className="map-tree-name">{item.label}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
