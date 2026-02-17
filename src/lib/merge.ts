export interface MergeResult {
  status: "clean" | "conflict";
  merged: string;
  reason?: string;
}

interface Change {
  start: number;
  end: number;
  insert: string[];
}

type DiffType = "equal" | "insert" | "delete";

interface DiffOp {
  type: DiffType;
  items: string[];
}

export interface DiffRow {
  localNumber: number | null;
  remoteNumber: number | null;
  localText: string;
  remoteText: string;
  localStatus: "equal" | "removed" | "empty";
  remoteStatus: "equal" | "added" | "empty";
}

function splitLines(text: string): string[] {
  if (!text) {
    return [];
  }

  return text.replace(/\r\n/g, "\n").split("\n");
}

function joinLines(lines: string[]): string {
  return lines.join("\n").trimEnd();
}

function areEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }

  return true;
}

function diffTokens(source: string[], target: string[]): DiffOp[] {
  const rows = source.length;
  const cols = target.length;

  const lcs: number[][] = Array.from({ length: rows + 1 }, () =>
    Array<number>(cols + 1).fill(0),
  );

  for (let i = 1; i <= rows; i += 1) {
    for (let j = 1; j <= cols; j += 1) {
      if (source[i - 1] === target[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }

  const reversedOps: DiffOp[] = [];
  let i = rows;
  let j = cols;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && source[i - 1] === target[j - 1]) {
      reversedOps.push({ type: "equal", items: [source[i - 1]] });
      i -= 1;
      j -= 1;
      continue;
    }

    if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      reversedOps.push({ type: "insert", items: [target[j - 1]] });
      j -= 1;
      continue;
    }

    reversedOps.push({ type: "delete", items: [source[i - 1]] });
    i -= 1;
  }

  reversedOps.reverse();

  const compacted: DiffOp[] = [];

  for (const op of reversedOps) {
    const previous = compacted[compacted.length - 1];

    if (previous && previous.type === op.type) {
      previous.items.push(...op.items);
    } else {
      compacted.push({ type: op.type, items: [...op.items] });
    }
  }

  return compacted;
}

function changesFromDiff(ops: DiffOp[]): Change[] {
  const changes: Change[] = [];
  let sourceCursor = 0;

  for (let index = 0; index < ops.length; index += 1) {
    const op = ops[index];

    if (op.type === "equal") {
      sourceCursor += op.items.length;
      continue;
    }

    if (op.type === "insert") {
      changes.push({
        start: sourceCursor,
        end: sourceCursor,
        insert: [...op.items],
      });
      continue;
    }

    const next = ops[index + 1];

    if (next && next.type === "insert") {
      changes.push({
        start: sourceCursor,
        end: sourceCursor + op.items.length,
        insert: [...next.items],
      });
      sourceCursor += op.items.length;
      index += 1;
      continue;
    }

    changes.push({
      start: sourceCursor,
      end: sourceCursor + op.items.length,
      insert: [],
    });
    sourceCursor += op.items.length;
  }

  return changes;
}

function overlaps(a: Change, b: Change): boolean {
  return a.start < b.end && b.start < a.end;
}

function insertsInsideChangedRange(insertChange: Change, editChange: Change): boolean {
  if (insertChange.start !== insertChange.end) {
    return false;
  }

  if (editChange.start === editChange.end) {
    return false;
  }

  return insertChange.start > editChange.start && insertChange.start < editChange.end;
}

function equivalent(a: Change, b: Change): boolean {
  return a.start === b.start && a.end === b.end && areEqual(a.insert, b.insert);
}

function appendChange(base: string[], output: string[], cursor: number, change: Change): number {
  output.push(...base.slice(cursor, change.start));
  output.push(...change.insert);
  return change.end;
}

export function threeWayMergeText(baseText: string, localText: string, remoteText: string): MergeResult {
  if (localText === remoteText) {
    return { status: "clean", merged: localText };
  }

  if (baseText === localText) {
    return { status: "clean", merged: remoteText };
  }

  if (baseText === remoteText) {
    return { status: "clean", merged: localText };
  }

  const base = splitLines(baseText);
  const local = splitLines(localText);
  const remote = splitLines(remoteText);

  const localChanges = changesFromDiff(diffTokens(base, local));
  const remoteChanges = changesFromDiff(diffTokens(base, remote));

  const merged: string[] = [];
  let cursor = 0;
  let localIndex = 0;
  let remoteIndex = 0;

  while (localIndex < localChanges.length || remoteIndex < remoteChanges.length) {
    const localChange = localChanges[localIndex];
    const remoteChange = remoteChanges[remoteIndex];

    if (!remoteChange || (localChange && localChange.start < remoteChange.start)) {
      if (
        remoteChange &&
        (overlaps(localChange, remoteChange) ||
          insertsInsideChangedRange(localChange, remoteChange) ||
          insertsInsideChangedRange(remoteChange, localChange))
      ) {
        return {
          status: "conflict",
          merged: localText,
          reason: "Overlapping edits detected.",
        };
      }

      cursor = appendChange(base, merged, cursor, localChange);
      localIndex += 1;
      continue;
    }

    if (!localChange || remoteChange.start < localChange.start) {
      if (
        localChange &&
        (overlaps(remoteChange, localChange) ||
          insertsInsideChangedRange(remoteChange, localChange) ||
          insertsInsideChangedRange(localChange, remoteChange))
      ) {
        return {
          status: "conflict",
          merged: localText,
          reason: "Overlapping edits detected.",
        };
      }

      cursor = appendChange(base, merged, cursor, remoteChange);
      remoteIndex += 1;
      continue;
    }

    if (equivalent(localChange, remoteChange)) {
      cursor = appendChange(base, merged, cursor, localChange);
      localIndex += 1;
      remoteIndex += 1;
      continue;
    }

    const bothInsertsAtSamePoint =
      localChange.start === localChange.end &&
      remoteChange.start === remoteChange.end &&
      localChange.start === remoteChange.start;

    if (bothInsertsAtSamePoint) {
      merged.push(...base.slice(cursor, localChange.start));
      merged.push(...localChange.insert);
      merged.push(...remoteChange.insert);
      cursor = localChange.end;
      localIndex += 1;
      remoteIndex += 1;
      continue;
    }

    return {
      status: "conflict",
      merged: localText,
      reason: "Changes modify the same region.",
    };
  }

  merged.push(...base.slice(cursor));

  return {
    status: "clean",
    merged: joinLines(merged),
  };
}

export function buildSideBySideDiffRows(localText: string, remoteText: string): DiffRow[] {
  const localLines = splitLines(localText);
  const remoteLines = splitLines(remoteText);
  const ops = diffTokens(localLines, remoteLines);

  const rows: DiffRow[] = [];
  let localNumber = 1;
  let remoteNumber = 1;

  for (const op of ops) {
    if (op.type === "equal") {
      for (const line of op.items) {
        rows.push({
          localNumber,
          remoteNumber,
          localText: line,
          remoteText: line,
          localStatus: "equal",
          remoteStatus: "equal",
        });
        localNumber += 1;
        remoteNumber += 1;
      }
      continue;
    }

    if (op.type === "delete") {
      for (const line of op.items) {
        rows.push({
          localNumber,
          remoteNumber: null,
          localText: line,
          remoteText: "",
          localStatus: "removed",
          remoteStatus: "empty",
        });
        localNumber += 1;
      }
      continue;
    }

    for (const line of op.items) {
      rows.push({
        localNumber: null,
        remoteNumber,
        localText: "",
        remoteText: line,
        localStatus: "empty",
        remoteStatus: "added",
      });
      remoteNumber += 1;
    }
  }

  return rows;
}
