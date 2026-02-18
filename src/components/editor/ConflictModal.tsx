import { useEffect, useMemo, useState } from "react";

import type { ConflictState } from "@/lib/app-types";
import { buildDiffHunks, composeResolvedFromHunks, type DiffChoice } from "@/lib/merge";

interface ConflictModalProps {
  conflict: ConflictState | null;
  isSyncing: boolean;
  onChangeResolved: (text: string) => void;
  onSaveResolution: () => void;
  onClose: () => void;
}

function makeChoiceMap(hunkIds: string[], choice: DiffChoice): Record<string, DiffChoice> {
  return hunkIds.reduce<Record<string, DiffChoice>>((acc, id) => {
    acc[id] = choice;
    return acc;
  }, {});
}

export function ConflictModal({
  conflict,
  isSyncing,
  onChangeResolved,
  onSaveResolution,
  onClose,
}: ConflictModalProps) {
  const hunks = useMemo(
    () => (conflict ? buildDiffHunks(conflict.remote, conflict.local) : []),
    [conflict?.local, conflict?.remote],
  );
  const changeHunks = useMemo(
    () => hunks.filter((hunk) => hunk.type === "change"),
    [hunks],
  );
  const [hunkChoices, setHunkChoices] = useState<Record<string, DiffChoice>>({});

  useEffect(() => {
    if (!conflict) {
      setHunkChoices({});
      return;
    }

    const defaultChoice: DiffChoice = "local";
    setHunkChoices(makeChoiceMap(changeHunks.map((hunk) => hunk.id), defaultChoice));
  }, [conflict?.local, conflict?.remote, changeHunks]);

  const resolvedMarkdown = useMemo(
    () => composeResolvedFromHunks(hunks, hunkChoices),
    [hunks, hunkChoices],
  );

  useEffect(() => {
    if (!conflict) {
      return;
    }

    if (conflict.resolved !== resolvedMarkdown) {
      onChangeResolved(resolvedMarkdown);
    }
  }, [conflict, onChangeResolved, resolvedMarkdown]);

  if (!conflict) {
    return null;
  }

  return (
    <div className="conflict-overlay" role="dialog" aria-modal="true">
      <div className="conflict-modal">
        <header>
          <h3>Sync Conflict</h3>
          <p>{conflict.reason ?? "Incoming and local edits overlap. Resolve each change below."}</p>
        </header>

        <div className="conflict-actions-row">
          <button
            type="button"
            onClick={() => {
              const confirmed = window.confirm("Replace the whole draft with the incoming Dropbox version?");
              if (!confirmed) {
                return;
              }

              setHunkChoices(makeChoiceMap(changeHunks.map((hunk) => hunk.id), "incoming"));
            }}
          >
            Use All Incoming
          </button>
          <button
            type="button"
            onClick={() => {
              const confirmed = window.confirm("Keep the whole local draft and discard incoming changes?");
              if (!confirmed) {
                return;
              }

              setHunkChoices(makeChoiceMap(changeHunks.map((hunk) => hunk.id), "local"));
            }}
          >
            Use All Local
          </button>
        </div>

        <div className="conflict-hunk-list">
          {changeHunks.length === 0 ? (
            <p className="conflict-empty">No line-level diff hunks were detected.</p>
          ) : (
            changeHunks.map((hunk, index) => {
              const currentChoice = hunkChoices[hunk.id] ?? "local";

              return (
                <section key={hunk.id} className="conflict-hunk">
                  <div className="conflict-hunk-header">
                    <span>{`Change ${index + 1}`}</span>
                    <div className="conflict-hunk-actions">
                      <button
                        type="button"
                        className={currentChoice === "incoming" ? "is-active" : undefined}
                        onClick={() => {
                          setHunkChoices((current) => ({
                            ...current,
                            [hunk.id]: "incoming",
                          }));
                        }}
                      >
                        Take Incoming
                      </button>
                      <button
                        type="button"
                        className={currentChoice === "local" ? "is-active" : undefined}
                        onClick={() => {
                          setHunkChoices((current) => ({
                            ...current,
                            [hunk.id]: "local",
                          }));
                        }}
                      >
                        Take Local
                      </button>
                    </div>
                  </div>

                  <div className="diff-grid" aria-label="Change hunk diff">
                    <div className="diff-pane">
                      <h4>Incoming</h4>
                      <div className="diff-body">
                        {(hunk.incomingLines.length ? hunk.incomingLines : [""]).map((line, lineIndex) => (
                          <div key={`incoming-${hunk.id}-${lineIndex}`} className={`diff-line ${line ? "added" : "empty"}`}>
                            <span className="line-number">
                              {line ? (hunk.incomingStart ?? 0) + lineIndex : ""}
                            </span>
                            <code>{line || " "}</code>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="diff-pane">
                      <h4>Local</h4>
                      <div className="diff-body">
                        {(hunk.localLines.length ? hunk.localLines : [""]).map((line, lineIndex) => (
                          <div key={`local-${hunk.id}-${lineIndex}`} className={`diff-line ${line ? "removed" : "empty"}`}>
                            <span className="line-number">
                              {line ? (hunk.localStart ?? 0) + lineIndex : ""}
                            </span>
                            <code>{line || " "}</code>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              );
            })
          )}
        </div>

        <label className="resolve-label" htmlFor="resolved-markdown">
          Resolved Markdown
        </label>
        <textarea
          id="resolved-markdown"
          value={resolvedMarkdown}
          readOnly
        />

        <div className="button-row">
          <button
            type="button"
            onClick={() => {
              onChangeResolved(resolvedMarkdown);
              onSaveResolution();
            }}
            disabled={isSyncing}
          >
            Save Resolution
          </button>
          <button type="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
