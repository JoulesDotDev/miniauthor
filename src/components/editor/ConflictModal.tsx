import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";

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
  const [isSaveConfirming, setIsSaveConfirming] = useState<boolean>(false);
  const allFromDropboxSelected = changeHunks.length > 0
    && changeHunks.every((hunk) => hunkChoices[hunk.id] === "incoming");
  const allLocalSelected = changeHunks.length > 0
    && changeHunks.every((hunk) => hunkChoices[hunk.id] === "local");

  useEffect(() => {
    if (!conflict) {
      setHunkChoices({});
      setIsSaveConfirming(false);
      return;
    }

    const defaultChoice: DiffChoice = "local";
    setHunkChoices(makeChoiceMap(changeHunks.map((hunk) => hunk.id), defaultChoice));
    setIsSaveConfirming(false);
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
        <header className="conflict-header">
          <h3>Sync Conflict</h3>
          <p>{conflict.reason ?? "Incoming and local edits overlap. Resolve each change below."}</p>
        </header>

        <div className="conflict-actions-row">
          <button
            type="button"
            className={allFromDropboxSelected ? "is-active" : undefined}
            aria-pressed={allFromDropboxSelected}
            onClick={() => {
              if (!allFromDropboxSelected) {
                setIsSaveConfirming(false);
              }

              setHunkChoices(makeChoiceMap(changeHunks.map((hunk) => hunk.id), "incoming"));
            }}
          >
            Use All from Dropbox
          </button>
          <button
            type="button"
            className={allLocalSelected ? "is-active" : undefined}
            aria-pressed={allLocalSelected}
            onClick={() => {
              if (!allLocalSelected) {
                setIsSaveConfirming(false);
              }

              setHunkChoices(makeChoiceMap(changeHunks.map((hunk) => hunk.id), "local"));
            }}
          >
            Use All Local
          </button>
        </div>

        <div className="conflict-content">
          <div className="conflict-list-label">Diff Chunks</div>
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
                            if (currentChoice !== "incoming") {
                              setIsSaveConfirming(false);
                            }

                            setHunkChoices((current) => ({
                              ...current,
                              [hunk.id]: "incoming",
                            }));
                          }}
                        >
                          Take from Dropbox
                        </button>
                        <button
                          type="button"
                          className={currentChoice === "local" ? "is-active" : undefined}
                          onClick={() => {
                            if (currentChoice !== "local") {
                              setIsSaveConfirming(false);
                            }

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
                        <h4>Dropbox</h4>
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

          <section className="conflict-preview-section">
            <div className="conflict-section-title">Resolved Preview</div>
            <div className="conflict-preview-body">
              {resolvedMarkdown.trim().length === 0 ? (
                <p className="conflict-empty">No content yet.</p>
              ) : (
                <div className="conflict-markdown">
                  <ReactMarkdown>{resolvedMarkdown}</ReactMarkdown>
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="button-row conflict-footer-actions">
          <button type="button" onClick={onClose} className="conflict-close-button">Close</button>
          <button
            type="button"
            onClick={() => {
              if (!isSaveConfirming) {
                setIsSaveConfirming(true);
                return;
              }

              onChangeResolved(resolvedMarkdown);
              onSaveResolution();
              setIsSaveConfirming(false);
            }}
            disabled={isSyncing}
          >
            {isSaveConfirming ? "Are you sure?" : "Save Resolution"}
          </button>
        </div>
      </div>
    </div>
  );
}
