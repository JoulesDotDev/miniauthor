import type { ConflictState } from "@/lib/app-types";
import type { DiffRow } from "@/lib/merge";

interface ConflictModalProps {
  conflict: ConflictState | null;
  diffRows: DiffRow[];
  isSyncing: boolean;
  onChangeResolved: (text: string) => void;
  onUseLocal: () => void;
  onUseDropbox: () => void;
  onUseBase: () => void;
  onSaveResolution: () => void;
  onClose: () => void;
}

export function ConflictModal({
  conflict,
  diffRows,
  isSyncing,
  onChangeResolved,
  onUseLocal,
  onUseDropbox,
  onUseBase,
  onSaveResolution,
  onClose,
}: ConflictModalProps) {
  if (!conflict) {
    return null;
  }

  return (
    <div className="conflict-overlay" role="dialog" aria-modal="true">
      <div className="conflict-modal">
        <header>
          <h3>Sync Conflict</h3>
          <p>{conflict.reason ?? "Both local and remote changed the same section."}</p>
        </header>

        <div className="diff-grid" aria-label="Git style line diff">
          <div className="diff-pane">
            <h4>Local</h4>
            <div className="diff-body">
              {diffRows.map((row, index) => (
                <div key={`local-${index}`} className={`diff-line ${row.localStatus}`}>
                  <span className="line-number">{row.localNumber ?? ""}</span>
                  <code>{row.localText || " "}</code>
                </div>
              ))}
            </div>
          </div>
          <div className="diff-pane">
            <h4>Dropbox</h4>
            <div className="diff-body">
              {diffRows.map((row, index) => (
                <div key={`remote-${index}`} className={`diff-line ${row.remoteStatus}`}>
                  <span className="line-number">{row.remoteNumber ?? ""}</span>
                  <code>{row.remoteText || " "}</code>
                </div>
              ))}
            </div>
          </div>
        </div>

        <label className="resolve-label" htmlFor="resolved-markdown">
          Resolved Markdown
        </label>
        <textarea
          id="resolved-markdown"
          value={conflict.resolved}
          onChange={(event) => onChangeResolved(event.target.value)}
        />

        <div className="button-row">
          <button type="button" onClick={onUseLocal}>Use Local</button>
          <button type="button" onClick={onUseDropbox}>Use Dropbox</button>
          <button type="button" onClick={onUseBase}>Use Base</button>
          <button type="button" onClick={onSaveResolution} disabled={isSyncing}>
            Save Resolution
          </button>
          <button type="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
