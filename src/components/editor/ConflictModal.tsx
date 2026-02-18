import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

import type { ConflictState } from "@/lib/app-types";
import {
  buildDiffHunks,
  composeResolvedFromHunks,
  resolveLinesForChoice,
  type DiffChoice,
  type DiffHunk,
} from "@/lib/merge";

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

function getHunkRange(hunk: DiffHunk): { start: number; end: number } | null {
  const incomingRange =
    hunk.incomingStart !== null && hunk.incomingLines.length > 0
      ? { start: hunk.incomingStart, end: hunk.incomingStart + hunk.incomingLines.length - 1 }
      : null;
  const localRange =
    hunk.localStart !== null && hunk.localLines.length > 0
      ? { start: hunk.localStart, end: hunk.localStart + hunk.localLines.length - 1 }
      : null;

  if (!incomingRange && !localRange) {
    return null;
  }

  if (!incomingRange) {
    return localRange;
  }

  if (!localRange) {
    return incomingRange;
  }

  return {
    start: Math.min(incomingRange.start, localRange.start),
    end: Math.max(incomingRange.end, localRange.end),
  };
}

function formatRangeLabel(hunk: DiffHunk): string {
  const range = getHunkRange(hunk);

  if (!range) {
    return "Affected lines";
  }

  if (range.start === range.end) {
    return `Line ${range.start}`;
  }

  return `Lines ${range.start}-${range.end}`;
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
  const [expandedPreviews, setExpandedPreviews] = useState<Record<string, boolean>>({});
  const [pendingPreviewFocusId, setPendingPreviewFocusId] = useState<string | null>(null);
  const [isSaveConfirming, setIsSaveConfirming] = useState<boolean>(false);
  const previewSectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const allFromDropboxSelected =
    changeHunks.length > 0 &&
    changeHunks.every((hunk) => hunkChoices[hunk.id] === "incoming");
  const allLocalSelected =
    changeHunks.length > 0 &&
    changeHunks.every((hunk) => hunkChoices[hunk.id] === "local");

  useEffect(() => {
    if (!conflict) {
      setHunkChoices({});
      setExpandedPreviews({});
      setPendingPreviewFocusId(null);
      setIsSaveConfirming(false);
      return;
    }

    const defaultChoice: DiffChoice = "local";
    setHunkChoices(makeChoiceMap(changeHunks.map((hunk) => hunk.id), defaultChoice));
    setExpandedPreviews({});
    setPendingPreviewFocusId(null);
    setIsSaveConfirming(false);
  }, [conflict?.local, conflict?.remote, changeHunks]);

  useEffect(() => {
    if (!pendingPreviewFocusId || !expandedPreviews[pendingPreviewFocusId]) {
      return;
    }

    const focusPreview = () => {
      const previewElement = previewSectionRefs.current[pendingPreviewFocusId];

      if (!previewElement) {
        return false;
      }

      previewElement.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });

      return true;
    };

    if (focusPreview()) {
      setPendingPreviewFocusId(null);
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      focusPreview();
      setPendingPreviewFocusId(null);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [expandedPreviews, pendingPreviewFocusId]);

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
          <h3>Review Changes</h3>
          <p>{conflict.reason ?? "Dropbox and your current draft both changed. Choose what you want to keep."}</p>
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
                const bothActive =
                  currentChoice === "both_incoming_first" || currentChoice === "both_local_first";
                const isPreviewOpen = Boolean(expandedPreviews[hunk.id]);
                const previewMarkdown = resolveLinesForChoice(hunk, currentChoice).join("\n");
                const previewRangeLabel = formatRangeLabel(hunk);

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
                        <button
                          type="button"
                          className={bothActive ? "is-active" : undefined}
                          onClick={() => {
                            if (!bothActive) {
                              setIsSaveConfirming(false);
                            }

                            setHunkChoices((current) => ({
                              ...current,
                              [hunk.id]: "both_incoming_first",
                            }));
                          }}
                        >
                          Take Both
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

                    <div className="conflict-hunk-preview-controls">
                      <button
                        type="button"
                        className={isPreviewOpen ? "is-active" : undefined}
                        onClick={() => {
                          if (!isPreviewOpen) {
                            setPendingPreviewFocusId(hunk.id);
                          } else {
                            setPendingPreviewFocusId(null);
                          }

                          setExpandedPreviews((current) => ({
                            ...current,
                            [hunk.id]: !isPreviewOpen,
                          }));
                        }}
                      >
                        {isPreviewOpen ? "Hide Preview" : "Show Preview"}
                      </button>
                      <span>{previewRangeLabel}</span>
                    </div>

                    {isPreviewOpen ? (
                      <section
                        className="conflict-hunk-preview"
                        ref={(element) => {
                          previewSectionRefs.current[hunk.id] = element;
                        }}
                      >
                        <div className="conflict-hunk-preview-title">{`Preview (${previewRangeLabel})`}</div>
                        <div className="conflict-hunk-preview-body">
                          {previewMarkdown.trim().length === 0 ? (
                            <p className="conflict-empty">No text in this section.</p>
                          ) : (
                            <div className="conflict-markdown">
                              <ReactMarkdown>{previewMarkdown}</ReactMarkdown>
                            </div>
                          )}
                        </div>
                      </section>
                    ) : null}
                  </section>
                );
              })
            )}
          </div>
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
