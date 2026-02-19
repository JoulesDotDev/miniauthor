import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { ConflictState } from "@/lib/app-types";
import type {
  Block,
  DropboxTokenState,
  ManuscriptFileMeta,
  StoredDocument,
  StoredWorkspace,
} from "@/lib/editor-types";
import {
  dropboxDeleteFile,
  dropboxDownloadFile,
  dropboxGetFileMetadata,
  dropboxUploadFile,
  ensureValidDropboxToken,
  finishDropboxAuthIfNeeded,
  startDropboxAuth,
} from "@/lib/dropbox";
import { threeWayMergeText } from "@/lib/merge";
import {
  createBlock,
  hasMeaningfulBlocksContent,
  normalizeBlocksForEditor,
  parseMarkdownToBlocks,
  serializeBlocksToMarkdown,
} from "@/lib/markdown";
import {
  deleteStoredDocument,
  getLegacyStoredDocument,
  getStoredDocument,
  getStoredDropboxToken,
  getStoredWorkspace,
  setStoredDocument,
  setStoredDropboxToken,
  setStoredWorkspace,
} from "@/lib/storage";

const FILE_INDEX_PATH = "/.mini-author-files.json";
const FILE_PATH_PREFIX = "/mini-author-";
const FILE_PATH_SUFFIX = ".md";
const DEFAULT_FILE_NAME = "Untitled";
const DEFAULT_FIRST_FILE_NAME = "Manuscript";

interface RemoteFilesIndex {
  version: 1;
  files: ManuscriptFileMeta[];
}

type LooseFileMeta = Partial<ManuscriptFileMeta> & {
  id: string;
  name: string;
};

function dropboxPathForFile(fileId: string): string {
  return `${FILE_PATH_PREFIX}${fileId}${FILE_PATH_SUFFIX}`;
}

function createFileId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `manuscript-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isDropboxAuthError(errorMessage: string): boolean {
  return /invalid_grant|invalid_access_token|expired_access_token|401/i.test(errorMessage);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sanitizeFileName(value: string): string {
  const cleaned = normalizeWhitespace(value).replace(/[\u0000-\u001F]/g, "");
  return cleaned.slice(0, 80);
}

function sortFiles(files: ManuscriptFileMeta[]): ManuscriptFileMeta[] {
  return [...files].sort((a, b) => {
    if (a.createdAt !== b.createdAt) {
      return a.createdAt - b.createdAt;
    }

    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

function ensureUniqueNames(
  files: ManuscriptFileMeta[],
  preferredOrder: string[] = [],
): ManuscriptFileMeta[] {
  const order = new Map<string, number>();

  preferredOrder.forEach((id, index) => {
    order.set(id, index);
  });

  const source = [...files].sort((a, b) => {
    const aOrder = order.get(a.id);
    const bOrder = order.get(b.id);

    if (aOrder !== undefined && bOrder !== undefined) {
      return aOrder - bOrder;
    }

    if (aOrder !== undefined) {
      return -1;
    }

    if (bOrder !== undefined) {
      return 1;
    }

    return 0;
  });

  return source.map((file) => ({
    ...file,
    name: sanitizeFileName(file.name) || DEFAULT_FILE_NAME,
  }));
}

function makeUniqueFileName(
  desiredName: string,
  _files: ManuscriptFileMeta[],
  _excludeId?: string,
): string {
  return sanitizeFileName(desiredName) || DEFAULT_FILE_NAME;
}

function normalizeFileMeta(input: LooseFileMeta, now: number): ManuscriptFileMeta {
  const createdAt =
    Number.isFinite(input.createdAt) && (input.createdAt as number) > 0
      ? (input.createdAt as number)
      : now;
  const updatedAtCandidate =
    Number.isFinite(input.updatedAt) && (input.updatedAt as number) > 0
      ? (input.updatedAt as number)
      : createdAt;
  const renamedAtCandidate =
    Number.isFinite(input.renamedAt) && (input.renamedAt as number) > 0
      ? (input.renamedAt as number)
      : updatedAtCandidate;

  return {
    id: input.id,
    name: sanitizeFileName(input.name) || DEFAULT_FILE_NAME,
    createdAt,
    updatedAt: Math.max(updatedAtCandidate, renamedAtCandidate),
    renamedAt: Math.max(renamedAtCandidate, createdAt),
  };
}

function normalizeFiles(files: Array<ManuscriptFileMeta | LooseFileMeta>, now = Date.now()): ManuscriptFileMeta[] {
  const deduped = new Map<string, ManuscriptFileMeta>();

  for (const file of files) {
    if (!file || typeof file.id !== "string" || file.id.trim().length === 0) {
      continue;
    }

    const normalized = normalizeFileMeta(file as LooseFileMeta, now);
    const existing = deduped.get(normalized.id);

    if (
      !existing ||
      normalized.renamedAt > existing.renamedAt ||
      (normalized.renamedAt === existing.renamedAt && normalized.updatedAt >= existing.updatedAt)
    ) {
      deduped.set(normalized.id, normalized);
    }
  }

  return ensureUniqueNames(sortFiles(Array.from(deduped.values())));
}

function mergeFileCatalogs(
  localFiles: ManuscriptFileMeta[],
  remoteFiles: ManuscriptFileMeta[],
): ManuscriptFileMeta[] {
  const now = Date.now();
  const local = normalizeFiles(localFiles, now);
  const remote = normalizeFiles(remoteFiles, now);
  const merged = new Map<string, ManuscriptFileMeta>();

  for (const file of local) {
    merged.set(file.id, file);
  }

  for (const remoteFile of remote) {
    const current = merged.get(remoteFile.id);

    if (!current) {
      merged.set(remoteFile.id, remoteFile);
      continue;
    }

    const remoteRenameWins = remoteFile.renamedAt >= current.renamedAt;

    merged.set(remoteFile.id, {
      ...current,
      name: remoteRenameWins ? remoteFile.name : current.name,
      createdAt: Math.min(current.createdAt, remoteFile.createdAt),
      updatedAt: Math.max(current.updatedAt, remoteFile.updatedAt),
      renamedAt: Math.max(current.renamedAt, remoteFile.renamedAt),
    });
  }

  const preferredOrder = [...local.map((file) => file.id), ...remote.map((file) => file.id)];
  return ensureUniqueNames(sortFiles(Array.from(merged.values())), preferredOrder);
}

function areFileListsEqual(left: ManuscriptFileMeta[], right: ManuscriptFileMeta[]): boolean {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];

    if (
      a.id !== b.id ||
      a.name !== b.name ||
      a.createdAt !== b.createdAt ||
      a.updatedAt !== b.updatedAt ||
      a.renamedAt !== b.renamedAt
    ) {
      return false;
    }
  }

  return true;
}

function resolveActiveFileId(
  desiredFileId: string | null,
  files: ManuscriptFileMeta[],
): string | null {
  if (files.length === 0) {
    return null;
  }

  if (desiredFileId && files.some((file) => file.id === desiredFileId)) {
    return desiredFileId;
  }

  return files[0].id;
}

function normalizeStoredDocument(
  input: StoredDocument,
  fileId: string,
  now = Date.now(),
): StoredDocument {
  return {
    id: fileId,
    blocks: normalizeBlocksForEditor(input.blocks),
    updatedAt:
      Number.isFinite(input.updatedAt) && input.updatedAt > 0 ? input.updatedAt : now,
    lastSyncedAt:
      Number.isFinite(input.lastSyncedAt ?? 0) && (input.lastSyncedAt ?? 0) > 0
        ? (input.lastSyncedAt as number)
        : null,
    baseMarkdown: typeof input.baseMarkdown === "string" ? input.baseMarkdown : "",
    remoteRev: typeof input.remoteRev === "string" ? input.remoteRev : null,
  };
}

function createEmptyStoredDocument(fileId: string, now = Date.now()): StoredDocument {
  return {
    id: fileId,
    blocks: [createBlock("title"), createBlock("paragraph")],
    updatedAt: now,
    lastSyncedAt: null,
    baseMarkdown: "",
    remoteRev: null,
  };
}

function parseRemoteFilesIndex(raw: string): ManuscriptFileMeta[] {
  try {
    const parsed = JSON.parse(raw) as Partial<RemoteFilesIndex> | ManuscriptFileMeta[];
    const files = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.files)
        ? parsed.files
        : [];

    return normalizeFiles(files as ManuscriptFileMeta[]);
  } catch {
    return [];
  }
}

function serializeRemoteFilesIndex(files: ManuscriptFileMeta[]): string {
  const payload: RemoteFilesIndex = {
    version: 1,
    files: normalizeFiles(files),
  };

  return `${JSON.stringify(payload, null, 2)}\n`;
}

function normalizeTextForCompare(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

interface UseDropboxSyncArgs {
  blocks: Block[];
  setBlocks: Dispatch<SetStateAction<Block[]>>;
  updatedAt: number;
  setUpdatedAt: (value: number) => void;
  isOnline: boolean;
  dropboxAppKey?: string;
  dropboxRedirectUri: string;
}

interface UseDropboxSyncResult {
  files: ManuscriptFileMeta[];
  activeFileId: string | null;
  activeFileName: string;
  activeFileCloudAheadAt: number | null;
  activeFileHasDropboxSyncState: boolean;
  lastSyncedAt: number | null;
  syncNotice: string;
  isSyncing: boolean;
  isPulling: boolean;
  dropboxToken: DropboxTokenState | null;
  conflict: ConflictState | null;
  setConflict: Dispatch<SetStateAction<ConflictState | null>>;
  syncWithDropbox: () => Promise<boolean>;
  pullFileCatalog: () => Promise<boolean>;
  connectDropbox: () => Promise<void>;
  disconnectDropbox: () => void;
  resolveConflict: () => Promise<void>;
  selectFile: (fileId: string) => Promise<void>;
  createFile: (name: string) => Promise<boolean>;
  renameActiveFile: (name: string) => Promise<boolean>;
  deleteActiveFile: () => Promise<boolean>;
}

export function useDropboxSync({
  blocks,
  setBlocks,
  updatedAt,
  setUpdatedAt,
  isOnline,
  dropboxAppKey,
  dropboxRedirectUri,
}: UseDropboxSyncArgs): UseDropboxSyncResult {
  const [files, setFiles] = useState<ManuscriptFileMeta[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [baseMarkdown, setBaseMarkdown] = useState<string>("");
  const [remoteRev, setRemoteRev] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [dropboxToken, setDropboxToken] = useState<DropboxTokenState | null>(null);
  const [syncNotice, setSyncNotice] = useState<string>("Offline-first mode active.");
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [isPulling, setIsPulling] = useState<boolean>(false);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [cloudAheadByFileId, setCloudAheadByFileId] = useState<Record<string, number>>({});

  const documentCacheRef = useRef<Record<string, StoredDocument>>({});
  const editorDocumentFileIdRef = useRef<string | null>(null);
  const filesRef = useRef<ManuscriptFileMeta[]>([]);
  const activeFileIdRef = useRef<string | null>(null);
  const dropboxTokenRef = useRef<DropboxTokenState | null>(null);

  const activeFileName = useMemo(() => {
    const active = files.find((file) => file.id === activeFileId);
    return active?.name ?? DEFAULT_FIRST_FILE_NAME;
  }, [activeFileId, files]);

  const activeFileCloudAheadAt = useMemo(() => {
    if (!activeFileId) {
      return null;
    }

    return cloudAheadByFileId[activeFileId] ?? null;
  }, [activeFileId, cloudAheadByFileId]);

  const activeFileHasDropboxSyncState = useMemo(() => {
    return remoteRev !== null || lastSyncedAt !== null;
  }, [lastSyncedAt, remoteRev]);

  const applyDocumentToEditor = useCallback(
    (doc: StoredDocument) => {
      const normalized = normalizeStoredDocument(doc, doc.id);
      editorDocumentFileIdRef.current = normalized.id;
      setBlocks(normalized.blocks);
      setUpdatedAt(normalized.updatedAt);
      setLastSyncedAt(normalized.lastSyncedAt);
      setBaseMarkdown(normalized.baseMarkdown);
      setRemoteRev(normalized.remoteRev);
    },
    [setBlocks, setUpdatedAt],
  );

  const writeWorkspace = useCallback((nextFiles: ManuscriptFileMeta[], nextActiveFileId: string | null) => {
    const payload: StoredWorkspace = {
      files: normalizeFiles(nextFiles),
      activeFileId: resolveActiveFileId(nextActiveFileId, nextFiles),
    };

    void setStoredWorkspace(payload);
  }, []);

  const setFilesAndPersist = useCallback(
    (
      updater:
        | ManuscriptFileMeta[]
        | ((current: ManuscriptFileMeta[]) => ManuscriptFileMeta[]),
      nextActiveOverride?: string | null,
    ) => {
      const nextRaw =
        typeof updater === "function" ? updater(filesRef.current) : updater;
      const next = normalizeFiles(nextRaw);
      const resolvedActive = resolveActiveFileId(
        nextActiveOverride !== undefined ? nextActiveOverride : activeFileIdRef.current,
        next,
      );

      filesRef.current = next;

      if (resolvedActive !== activeFileIdRef.current) {
        activeFileIdRef.current = resolvedActive;
        setActiveFileId(resolvedActive);
      }

      setFiles(next);
      writeWorkspace(next, resolvedActive);
    },
    [writeWorkspace],
  );

  const getOrCreateLocalDocument = useCallback(async (fileId: string): Promise<StoredDocument> => {
    const cached = documentCacheRef.current[fileId];
    if (cached) {
      return cached;
    }

    const fromStorage = await getStoredDocument(fileId);
    if (fromStorage) {
      const normalized = normalizeStoredDocument(fromStorage, fileId);
      documentCacheRef.current[fileId] = normalized;
      return normalized;
    }

    const fallback = createEmptyStoredDocument(fileId);
    documentCacheRef.current[fileId] = fallback;
    await setStoredDocument(fallback);
    return fallback;
  }, []);

  const getLocalDocumentSnapshot = useCallback(async (fileId: string): Promise<StoredDocument | null> => {
    const cached = documentCacheRef.current[fileId];
    if (cached) {
      return normalizeStoredDocument(cached, fileId);
    }

    const stored = await getStoredDocument(fileId);
    if (!stored) {
      return null;
    }

    const normalized = normalizeStoredDocument(stored, fileId);
    documentCacheRef.current[fileId] = normalized;
    return normalized;
  }, []);

  const shouldDropBootstrapPlaceholderFile = useCallback(async (
    localFile: ManuscriptFileMeta,
  ): Promise<boolean> => {
    if (localFile.name !== DEFAULT_FIRST_FILE_NAME) {
      return false;
    }

    const documentSnapshot = await getLocalDocumentSnapshot(localFile.id);
    if (!documentSnapshot) {
      return true;
    }

    const hasContent = hasMeaningfulBlocksContent(documentSnapshot.blocks);
    const isUnsynced =
      documentSnapshot.lastSyncedAt === null &&
      documentSnapshot.remoteRev === null &&
      documentSnapshot.baseMarkdown.trim().length === 0;

    return !hasContent && isUnsynced;
  }, [getLocalDocumentSnapshot]);

  const resolveLocalFilesForMerge = useCallback(async (
    localFiles: ManuscriptFileMeta[],
    remoteFiles: ManuscriptFileMeta[],
    remoteIds: Set<string>,
  ): Promise<ManuscriptFileMeta[]> => {
    let localFilesForMerge = localFiles;

    if (
      localFiles.length === 1 &&
      remoteFiles.length > 0 &&
      !remoteIds.has(localFiles[0].id)
    ) {
      const [candidate] = localFiles;
      const dropCandidate = await shouldDropBootstrapPlaceholderFile(candidate);

      if (dropCandidate) {
        localFilesForMerge = [];
      }
    }

    return localFilesForMerge;
  }, [shouldDropBootstrapPlaceholderFile]);

  const tryLoadDropboxDocument = useCallback(
    async (validToken: DropboxTokenState, fileId: string): Promise<StoredDocument | null> => {
      const remoteFile = await dropboxDownloadFile(validToken.accessToken, dropboxPathForFile(fileId));
      if (!remoteFile) {
        return null;
      }

      const parsedBlocks = normalizeBlocksForEditor(parseMarkdownToBlocks(remoteFile.content));
      const now = Date.now();
      const remoteDocument: StoredDocument = {
        id: fileId,
        blocks: parsedBlocks,
        updatedAt: now,
        lastSyncedAt: now,
        baseMarkdown: remoteFile.content,
        remoteRev: remoteFile.rev,
      };

      documentCacheRef.current[fileId] = remoteDocument;
      await setStoredDocument(remoteDocument);
      return remoteDocument;
    },
    [],
  );

  const persistCurrentActiveSnapshot = useCallback(async () => {
    const currentActiveId = activeFileIdRef.current;

    if (!currentActiveId) {
      return;
    }

    const snapshot: StoredDocument = {
      id: currentActiveId,
      blocks,
      updatedAt,
      lastSyncedAt,
      baseMarkdown,
      remoteRev,
    };

    documentCacheRef.current[currentActiveId] = snapshot;
    await setStoredDocument(snapshot);
  }, [baseMarkdown, blocks, lastSyncedAt, remoteRev, updatedAt]);

  const syncFileCatalogWithDropbox = useCallback(
    async (validToken: DropboxTokenState): Promise<ManuscriptFileMeta[]> => {
      const localFilesSnapshot = filesRef.current;
      const remoteCatalogFile = await dropboxDownloadFile(validToken.accessToken, FILE_INDEX_PATH);
      const remoteFiles = remoteCatalogFile ? parseRemoteFilesIndex(remoteCatalogFile.content) : [];
      const remoteIds = new Set(remoteFiles.map((file) => file.id));
      let localFilesForMerge = await resolveLocalFilesForMerge(localFilesSnapshot, remoteFiles, remoteIds);

      // If local file list changed while this async refresh was running,
      // rebase against the latest snapshot so we don't clobber user actions.
      if (!areFileListsEqual(localFilesSnapshot, filesRef.current)) {
        localFilesForMerge = await resolveLocalFilesForMerge(filesRef.current, remoteFiles, remoteIds);
      }

      const mergedFiles = mergeFileCatalogs(localFilesForMerge, remoteFiles);
      const serializedMerged = serializeRemoteFilesIndex(mergedFiles);
      const localFileIds = new Set(localFilesForMerge.map((file) => file.id));
      const remoteOnlyFiles = remoteFiles.filter((file) => !localFileIds.has(file.id));
      const sharedRemoteFiles = remoteFiles.filter((file) => localFileIds.has(file.id));

      if (
        !remoteCatalogFile ||
        normalizeTextForCompare(remoteCatalogFile.content) !== normalizeTextForCompare(serializedMerged)
      ) {
        await dropboxUploadFile(validToken.accessToken, FILE_INDEX_PATH, serializedMerged);
      }

      if (remoteOnlyFiles.length > 0) {
        await Promise.all(
          remoteOnlyFiles.map(async (remoteFile) => {
            try {
              await tryLoadDropboxDocument(validToken, remoteFile.id);
            } catch {
              // Skip file hydration failures; file list is still usable.
            }
          }),
        );
      }

      const cloudAheadEntries = await Promise.all(
        sharedRemoteFiles.map(async (remoteFile) => {
          try {
            const metadata = await dropboxGetFileMetadata(
              validToken.accessToken,
              dropboxPathForFile(remoteFile.id),
            );

            if (!metadata || !metadata.serverModifiedAt) {
              return {
                id: remoteFile.id,
                timestamp: null,
              };
            }

            const localDocument = await getLocalDocumentSnapshot(remoteFile.id);
            const localLastSyncedAt = localDocument?.lastSyncedAt ?? 0;
            const remoteAheadByTime = metadata.serverModifiedAt > localLastSyncedAt + 1000;
            const remoteAheadByRev =
              Boolean(metadata.rev) &&
              Boolean(localDocument?.remoteRev) &&
              metadata.rev !== localDocument?.remoteRev;

            if (remoteAheadByTime || remoteAheadByRev) {
              return {
                id: remoteFile.id,
                timestamp: metadata.serverModifiedAt,
              };
            }

            return {
              id: remoteFile.id,
              timestamp: null,
            };
          } catch {
            return {
              id: remoteFile.id,
              timestamp: null,
            };
          }
        }),
      );

      const mergedFileIds = new Set(mergedFiles.map((file) => file.id));
      setCloudAheadByFileId((current) => {
        const next: Record<string, number> = {};

        for (const [fileId, timestamp] of Object.entries(current)) {
          if (mergedFileIds.has(fileId)) {
            next[fileId] = timestamp;
          }
        }

        for (const entry of cloudAheadEntries) {
          if (!entry) {
            continue;
          }

          if (entry.timestamp === null) {
            delete next[entry.id];
            continue;
          }

          next[entry.id] = entry.timestamp;
        }

        return next;
      });

      if (!areFileListsEqual(mergedFiles, filesRef.current)) {
        setFilesAndPersist(mergedFiles);
      }

      return mergedFiles;
    },
    [
      getLocalDocumentSnapshot,
      resolveLocalFilesForMerge,
      setFilesAndPersist,
      tryLoadDropboxDocument,
    ],
  );

  const selectFile = useCallback(async (fileId: string) => {
    if (fileId === activeFileIdRef.current) {
      return;
    }

    if (!filesRef.current.some((file) => file.id === fileId)) {
      return;
    }

    await persistCurrentActiveSnapshot();

    const existingDocument =
      documentCacheRef.current[fileId] ?? (await getStoredDocument(fileId));
    let nextDocument = existingDocument
      ? normalizeStoredDocument(existingDocument, fileId)
      : null;

    if (!nextDocument && dropboxTokenRef.current && dropboxAppKey && isOnline) {
      try {
        let validToken = await ensureValidDropboxToken(dropboxAppKey, dropboxTokenRef.current);

        if (
          validToken.accessToken !== dropboxTokenRef.current.accessToken ||
          validToken.expiresAt !== dropboxTokenRef.current.expiresAt
        ) {
          dropboxTokenRef.current = validToken;
          setDropboxToken(validToken);
        }

        nextDocument = await tryLoadDropboxDocument(validToken, fileId);
      } catch {
        // Fall back to local empty draft if background remote load fails.
      }
    }

    if (!nextDocument) {
      nextDocument = createEmptyStoredDocument(fileId);
      await setStoredDocument(nextDocument);
    }

    documentCacheRef.current[fileId] = nextDocument;

    activeFileIdRef.current = fileId;
    setActiveFileId(fileId);
    setConflict(null);
    applyDocumentToEditor(nextDocument);

    const activeName = filesRef.current.find((file) => file.id === fileId)?.name ?? DEFAULT_FILE_NAME;
    setSyncNotice(`Editing "${activeName}".`);
  }, [applyDocumentToEditor, dropboxAppKey, isOnline, persistCurrentActiveSnapshot, tryLoadDropboxDocument]);

  const createFile = useCallback(async (name: string): Promise<boolean> => {
    await persistCurrentActiveSnapshot();

    const normalizedName = makeUniqueFileName(name, filesRef.current);
    const now = Date.now();
    const fileId = createFileId();
    const nextFile: ManuscriptFileMeta = {
      id: fileId,
      name: normalizedName,
      createdAt: now,
      updatedAt: now,
      renamedAt: now,
    };
    const nextDocument = createEmptyStoredDocument(fileId, now);
    const nextFiles = sortFiles([...filesRef.current, nextFile]);

    documentCacheRef.current[fileId] = nextDocument;
    filesRef.current = nextFiles;
    activeFileIdRef.current = fileId;

    setFiles(nextFiles);
    setActiveFileId(fileId);
    applyDocumentToEditor(nextDocument);
    setConflict(null);
    setSyncNotice(`Created "${normalizedName}".`);

    await Promise.all([
      setStoredDocument(nextDocument),
      setStoredWorkspace({
        files: nextFiles,
        activeFileId: fileId,
      }),
    ]);

    return true;
  }, [applyDocumentToEditor, persistCurrentActiveSnapshot]);

  const renameActiveFile = useCallback(async (name: string): Promise<boolean> => {
    const currentActiveId = activeFileIdRef.current;
    if (!currentActiveId) {
      return false;
    }

    const currentFile = filesRef.current.find((file) => file.id === currentActiveId);
    if (!currentFile) {
      return false;
    }

    const nextName = makeUniqueFileName(name, filesRef.current, currentActiveId);
    if (nextName === currentFile.name) {
      return true;
    }

    const now = Date.now();
    const nextFiles = filesRef.current.map((file) =>
      file.id === currentActiveId
        ? { ...file, name: nextName, updatedAt: now, renamedAt: now }
        : file,
    );

    filesRef.current = nextFiles;
    setFiles(nextFiles);
    writeWorkspace(nextFiles, currentActiveId);
    setSyncNotice(`Renamed current manuscript to "${nextName}".`);
    return true;
  }, [writeWorkspace]);

  const deleteActiveFile = useCallback(async (): Promise<boolean> => {
    if (isSyncing || isPulling) {
      return false;
    }

    const currentActiveId = activeFileIdRef.current;
    if (!currentActiveId) {
      return false;
    }

    const currentFiles = filesRef.current;
    const currentFileIndex = currentFiles.findIndex((file) => file.id === currentActiveId);
    if (currentFileIndex < 0) {
      return false;
    }

    const currentFile = currentFiles[currentFileIndex];
    const hasDropboxSyncState = remoteRev !== null || lastSyncedAt !== null;
    const canDeleteInDropbox = Boolean(dropboxTokenRef.current && dropboxAppKey && isOnline);

    if (canDeleteInDropbox) {
      try {
        let validToken = await ensureValidDropboxToken(dropboxAppKey as string, dropboxTokenRef.current as DropboxTokenState);

        if (
          validToken.accessToken !== (dropboxTokenRef.current as DropboxTokenState).accessToken ||
          validToken.expiresAt !== (dropboxTokenRef.current as DropboxTokenState).expiresAt
        ) {
          dropboxTokenRef.current = validToken;
          setDropboxToken(validToken);
        }

        await dropboxDeleteFile(validToken.accessToken, dropboxPathForFile(currentActiveId));

        const remoteCatalogFile = await dropboxDownloadFile(validToken.accessToken, FILE_INDEX_PATH);
        const remoteFiles = remoteCatalogFile ? parseRemoteFilesIndex(remoteCatalogFile.content) : [];
        const nextRemoteFiles = remoteFiles.filter((file) => file.id !== currentActiveId);
        const serializedRemote = serializeRemoteFilesIndex(nextRemoteFiles);

        if (
          !remoteCatalogFile ||
          normalizeTextForCompare(remoteCatalogFile.content) !== normalizeTextForCompare(serializedRemote)
        ) {
          await dropboxUploadFile(validToken.accessToken, FILE_INDEX_PATH, serializedRemote);
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Delete failed.";

        if (isDropboxAuthError(detail)) {
          dropboxTokenRef.current = null;
          setDropboxToken(null);
          setSyncNotice("Dropbox session expired. Please reconnect Dropbox.");
        } else {
          setSyncNotice(detail);
        }

        return false;
      }
    }

    const nextFilesWithoutCurrent = currentFiles.filter((file) => file.id !== currentActiveId);
    let nextFiles = nextFilesWithoutCurrent;
    let nextActiveId: string | null = null;
    let nextActiveDocument: StoredDocument;

    delete documentCacheRef.current[currentActiveId];
    await deleteStoredDocument(currentActiveId);

    if (nextFilesWithoutCurrent.length === 0) {
      const now = Date.now();
      const firstFileId = createFileId();
      const firstFile: ManuscriptFileMeta = {
        id: firstFileId,
        name: DEFAULT_FIRST_FILE_NAME,
        createdAt: now,
        updatedAt: now,
        renamedAt: now,
      };
      const fallbackDocument = createEmptyStoredDocument(firstFileId, now);

      nextFiles = [firstFile];
      nextActiveId = firstFileId;
      nextActiveDocument = fallbackDocument;
      documentCacheRef.current[firstFileId] = fallbackDocument;

      await setStoredDocument(fallbackDocument);
    } else {
      const fallbackIndex = Math.min(currentFileIndex, nextFilesWithoutCurrent.length - 1);
      nextActiveId = nextFilesWithoutCurrent[fallbackIndex]?.id ?? nextFilesWithoutCurrent[0].id;
      nextActiveDocument = await getOrCreateLocalDocument(nextActiveId);
    }

    filesRef.current = nextFiles;
    activeFileIdRef.current = nextActiveId;
    setFiles(nextFiles);
    setActiveFileId(nextActiveId);
    applyDocumentToEditor(nextActiveDocument);
    setConflict((current) => (current && current.fileId === currentActiveId ? null : current));
    setCloudAheadByFileId((current) => {
      if (!(currentActiveId in current)) {
        return current;
      }

      const next = { ...current };
      delete next[currentActiveId];
      return next;
    });

    await setStoredWorkspace({
      files: nextFiles,
      activeFileId: nextActiveId,
    });

    if (!isOnline && hasDropboxSyncState) {
      setSyncNotice(
        `Deleted "${currentFile.name}" locally. You're offline, so Dropbox still has it and it can reappear after Pull.`,
      );
    } else if (canDeleteInDropbox) {
      setSyncNotice(`Deleted "${currentFile.name}" locally and from Dropbox.`);
    } else {
      setSyncNotice(`Deleted "${currentFile.name}" locally.`);
    }

    return true;
  }, [
    applyDocumentToEditor,
    dropboxAppKey,
    getOrCreateLocalDocument,
    isOnline,
    isPulling,
    isSyncing,
    lastSyncedAt,
    remoteRev,
  ]);

  const syncWithDropbox = useCallback(async (): Promise<boolean> => {
    if (isSyncing || isPulling) {
      return false;
    }

    if (!dropboxAppKey) {
      setSyncNotice("Add VITE_DROPBOX_APP_KEY before connecting Dropbox.");
      return false;
    }

    if (!dropboxTokenRef.current) {
      setSyncNotice("Connect Dropbox first.");
      return false;
    }

    if (!isOnline) {
      setSyncNotice("Offline. Changes stay in IndexedDB until reconnect.");
      return false;
    }

    const currentActiveId = activeFileIdRef.current;
    if (!currentActiveId) {
      setSyncNotice("Create a manuscript first.");
      return false;
    }

    const currentFile = filesRef.current.find((file) => file.id === currentActiveId);
    if (!currentFile) {
      setSyncNotice("Current manuscript was not found.");
      return false;
    }

    setIsSyncing(true);

    try {
      let validToken = await ensureValidDropboxToken(dropboxAppKey, dropboxTokenRef.current);

      if (
        validToken.accessToken !== dropboxTokenRef.current.accessToken ||
        validToken.expiresAt !== dropboxTokenRef.current.expiresAt
      ) {
        dropboxTokenRef.current = validToken;
        setDropboxToken(validToken);
      }

      const localMarkdown = serializeBlocksToMarkdown(blocks);
      const remoteFile = await dropboxDownloadFile(validToken.accessToken, dropboxPathForFile(currentActiveId));
      const remoteMarkdown = remoteFile?.content ?? "";
      const localHasContent = hasMeaningfulBlocksContent(blocks);
      const remoteBlocks = parseMarkdownToBlocks(remoteMarkdown);
      const remoteHasContent = hasMeaningfulBlocksContent(remoteBlocks);
      const mergeLocalMarkdown = localHasContent ? localMarkdown : "";
      const mergeRemoteMarkdown = remoteHasContent ? remoteMarkdown : "";
      const isFirstSync =
        lastSyncedAt === null &&
        remoteRev === null &&
        baseMarkdown.trim().length === 0;

      if (
        isFirstSync &&
        remoteFile &&
        localHasContent &&
        remoteHasContent &&
        mergeLocalMarkdown !== mergeRemoteMarkdown
      ) {
        setConflict({
          fileId: currentActiveId,
          fileName: currentFile.name,
          base: "",
          local: mergeLocalMarkdown,
          remote: mergeRemoteMarkdown,
          resolved: mergeLocalMarkdown,
          reason: "This manuscript has local and Dropbox drafts. Choose one or merge manually.",
        });
        setSyncNotice(`Conflict in "${currentFile.name}".`);
        return false;
      }

      const mergeResult = threeWayMergeText(baseMarkdown, mergeLocalMarkdown, mergeRemoteMarkdown);

      if (mergeResult.status === "conflict") {
        setConflict({
          fileId: currentActiveId,
          fileName: currentFile.name,
          base: baseMarkdown,
          local: mergeLocalMarkdown,
          remote: mergeRemoteMarkdown,
          resolved: mergeLocalMarkdown,
          reason: mergeResult.reason,
        });
        setSyncNotice(`Conflict in "${currentFile.name}".`);
        return false;
      }

      const mergedMarkdown = mergeResult.merged;
      let latestRev = remoteFile?.rev ?? remoteRev;

      if (!remoteFile || mergedMarkdown !== mergeRemoteMarkdown) {
        const uploaded = await dropboxUploadFile(
          validToken.accessToken,
          dropboxPathForFile(currentActiveId),
          mergedMarkdown,
        );
        latestRev = uploaded.rev;
      }

      const normalizedMergedBlocks = normalizeBlocksForEditor(parseMarkdownToBlocks(mergedMarkdown));
      const now = Date.now();
      const mergedDocument: StoredDocument = {
        id: currentActiveId,
        blocks: normalizedMergedBlocks,
        updatedAt: now,
        lastSyncedAt: now,
        baseMarkdown: mergedMarkdown,
        remoteRev: latestRev ?? null,
      };

      documentCacheRef.current[currentActiveId] = mergedDocument;
      await setStoredDocument(mergedDocument);

      setBlocks(normalizedMergedBlocks);
      setBaseMarkdown(mergedMarkdown);
      setRemoteRev(latestRev ?? null);
      setLastSyncedAt(now);
      setUpdatedAt(now);
      setConflict(null);
      setCloudAheadByFileId((current) => {
        if (!(currentActiveId in current)) {
          return current;
        }

        const next = { ...current };
        delete next[currentActiveId];
        return next;
      });
      setSyncNotice(`Dropbox sync complete for "${currentFile.name}".`);

      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown Dropbox error.";

      if (isDropboxAuthError(detail)) {
        dropboxTokenRef.current = null;
        setDropboxToken(null);
        setSyncNotice("Dropbox session expired. Please reconnect Dropbox.");
      } else {
        setSyncNotice(detail);
      }

      return false;
    } finally {
      setIsSyncing(false);
    }
  }, [
    baseMarkdown,
    blocks,
    dropboxAppKey,
    isOnline,
    isPulling,
    isSyncing,
    lastSyncedAt,
    remoteRev,
    setBlocks,
    setUpdatedAt,
  ]);

  const pullFileCatalog = useCallback(async (): Promise<boolean> => {
    if (isSyncing || isPulling) {
      return false;
    }

    if (!dropboxAppKey) {
      setSyncNotice("Add VITE_DROPBOX_APP_KEY before connecting Dropbox.");
      return false;
    }

    if (!dropboxTokenRef.current) {
      setSyncNotice("Connect Dropbox first.");
      return false;
    }

    if (!isOnline) {
      setSyncNotice("Offline. Reconnect to pull manuscript updates from Dropbox.");
      return false;
    }

    setIsPulling(true);

    try {
      let validToken = await ensureValidDropboxToken(dropboxAppKey, dropboxTokenRef.current);

      if (
        validToken.accessToken !== dropboxTokenRef.current.accessToken ||
        validToken.expiresAt !== dropboxTokenRef.current.expiresAt
      ) {
        dropboxTokenRef.current = validToken;
        setDropboxToken(validToken);
      }

      await persistCurrentActiveSnapshot();
      await syncFileCatalogWithDropbox(validToken);
      setSyncNotice("Pulled latest manuscript list from Dropbox.");
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Failed to pull Dropbox file list.";

      if (isDropboxAuthError(detail)) {
        dropboxTokenRef.current = null;
        setDropboxToken(null);
        setSyncNotice("Dropbox session expired. Please reconnect Dropbox.");
      } else {
        setSyncNotice(detail);
      }

      return false;
    } finally {
      setIsPulling(false);
    }
  }, [dropboxAppKey, isOnline, isPulling, isSyncing, persistCurrentActiveSnapshot, syncFileCatalogWithDropbox]);

  const connectDropbox = useCallback(async () => {
    if (!dropboxAppKey) {
      setSyncNotice("Missing VITE_DROPBOX_APP_KEY.");
      return;
    }

    await startDropboxAuth(dropboxAppKey, dropboxRedirectUri);
  }, [dropboxAppKey, dropboxRedirectUri]);

  const disconnectDropbox = useCallback(() => {
    dropboxTokenRef.current = null;
    setDropboxToken(null);
    setConflict(null);
    setCloudAheadByFileId({});
    setSyncNotice("Dropbox disconnected locally.");
  }, []);

  const resolveConflict = useCallback(async () => {
    if (!conflict || !dropboxTokenRef.current || !dropboxAppKey) {
      return;
    }

    setIsSyncing(true);

    try {
      const validToken = await ensureValidDropboxToken(dropboxAppKey, dropboxTokenRef.current);

      if (
        validToken.accessToken !== dropboxTokenRef.current.accessToken ||
        validToken.expiresAt !== dropboxTokenRef.current.expiresAt
      ) {
        dropboxTokenRef.current = validToken;
        setDropboxToken(validToken);
      }

      const uploadResult = await dropboxUploadFile(
        validToken.accessToken,
        dropboxPathForFile(conflict.fileId),
        conflict.resolved,
      );
      const resolvedBlocks = normalizeBlocksForEditor(parseMarkdownToBlocks(conflict.resolved));
      const now = Date.now();
      const resolvedDocument: StoredDocument = {
        id: conflict.fileId,
        blocks: resolvedBlocks,
        updatedAt: now,
        lastSyncedAt: now,
        baseMarkdown: conflict.resolved,
        remoteRev: uploadResult.rev,
      };

      documentCacheRef.current[conflict.fileId] = resolvedDocument;
      await setStoredDocument(resolvedDocument);

      if (conflict.fileId === activeFileIdRef.current) {
        setBlocks(resolvedBlocks);
        setBaseMarkdown(conflict.resolved);
        setRemoteRev(uploadResult.rev);
        setLastSyncedAt(now);
        setUpdatedAt(now);
      }

      setConflict(null);
      setCloudAheadByFileId((current) => {
        if (!(conflict.fileId in current)) {
          return current;
        }

        const next = { ...current };
        delete next[conflict.fileId];
        return next;
      });
      setSyncNotice(`Conflict resolved for "${conflict.fileName}".`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Conflict upload failed.";

      if (isDropboxAuthError(detail)) {
        dropboxTokenRef.current = null;
        setDropboxToken(null);
        setSyncNotice("Dropbox session expired. Please reconnect Dropbox.");
      } else {
        setSyncNotice(detail);
      }
    } finally {
      setIsSyncing(false);
    }
  }, [conflict, dropboxAppKey, setBlocks, setUpdatedAt]);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    activeFileIdRef.current = activeFileId;
  }, [activeFileId]);

  useEffect(() => {
    if (!isLoaded || !activeFileId) {
      return;
    }

    if (editorDocumentFileIdRef.current === activeFileId) {
      return;
    }

    let cancelled = false;

    const loadActiveDocument = async () => {
      const activeDocument = await getOrCreateLocalDocument(activeFileId);

      if (cancelled) {
        return;
      }

      applyDocumentToEditor(activeDocument);
    };

    void loadActiveDocument();

    return () => {
      cancelled = true;
    };
  }, [activeFileId, applyDocumentToEditor, getOrCreateLocalDocument, isLoaded]);

  useEffect(() => {
    dropboxTokenRef.current = dropboxToken;
  }, [dropboxToken]);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const [storedWorkspace, storedToken, legacyDocument] = await Promise.all([
          getStoredWorkspace(),
          getStoredDropboxToken(),
          getLegacyStoredDocument(),
        ]);

        if (cancelled) {
          return;
        }

        const now = Date.now();
        let nextFiles = normalizeFiles(storedWorkspace?.files ?? [], now);
        let nextActiveId = resolveActiveFileId(storedWorkspace?.activeFileId ?? null, nextFiles);

        if (nextFiles.length === 0) {
          const firstFileId = createFileId();
          const firstFile: ManuscriptFileMeta = {
            id: firstFileId,
            name: DEFAULT_FIRST_FILE_NAME,
            createdAt: now,
            updatedAt: now,
            renamedAt: now,
          };
          nextFiles = [firstFile];
          nextActiveId = firstFileId;

          const migratedDocument = legacyDocument
            ? normalizeStoredDocument(legacyDocument, firstFileId, now)
            : createEmptyStoredDocument(firstFileId, now);

          documentCacheRef.current[firstFileId] = migratedDocument;

          await Promise.all([
            setStoredDocument(migratedDocument),
            setStoredWorkspace({
              files: nextFiles,
              activeFileId: firstFileId,
            }),
          ]);
        }

        filesRef.current = nextFiles;
        activeFileIdRef.current = nextActiveId;
        setFiles(nextFiles);
        setActiveFileId(nextActiveId);

        if (nextActiveId) {
          const activeDocument = await getOrCreateLocalDocument(nextActiveId);
          if (cancelled) {
            return;
          }

          applyDocumentToEditor(activeDocument);
        }

        if (storedToken) {
          dropboxTokenRef.current = storedToken;
          setDropboxToken(storedToken);
        }

        if (dropboxAppKey) {
          try {
            const oauthToken = await finishDropboxAuthIfNeeded(dropboxAppKey, dropboxRedirectUri);

            if (oauthToken && !cancelled) {
              dropboxTokenRef.current = oauthToken;
              setDropboxToken(oauthToken);
              setSyncNotice("Dropbox connected.");
            }
          } catch (error) {
            if (!cancelled) {
              const detail = error instanceof Error ? error.message : "Dropbox OAuth callback failed.";
              setSyncNotice(detail);
            }
          }
        }
      } finally {
        if (!cancelled) {
          setIsLoaded(true);
        }
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [applyDocumentToEditor, dropboxAppKey, dropboxRedirectUri, getOrCreateLocalDocument]);

  useEffect(() => {
    if (!isLoaded || !activeFileId) {
      return;
    }

    const payload: StoredDocument = {
      id: activeFileId,
      blocks,
      updatedAt,
      lastSyncedAt,
      baseMarkdown,
      remoteRev,
    };

    documentCacheRef.current[activeFileId] = payload;

    const timeoutId = window.setTimeout(() => {
      void setStoredDocument(payload);
    }, 500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [activeFileId, baseMarkdown, blocks, isLoaded, lastSyncedAt, remoteRev, updatedAt]);

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    const workspace: StoredWorkspace = {
      files,
      activeFileId,
    };

    void setStoredWorkspace(workspace);
  }, [activeFileId, files, isLoaded]);

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    void setStoredDropboxToken(dropboxToken);
  }, [dropboxToken, isLoaded]);

  useEffect(() => {
    if (!isLoaded || !dropboxTokenRef.current || !dropboxAppKey || !isOnline || isSyncing || isPulling) {
      return;
    }

    const refreshCatalog = async () => {
      try {
        let validToken = await ensureValidDropboxToken(dropboxAppKey, dropboxTokenRef.current as DropboxTokenState);

        if (
          validToken.accessToken !== (dropboxTokenRef.current as DropboxTokenState).accessToken ||
          validToken.expiresAt !== (dropboxTokenRef.current as DropboxTokenState).expiresAt
        ) {
          dropboxTokenRef.current = validToken;
          setDropboxToken(validToken);
        }

        await syncFileCatalogWithDropbox(validToken);
      } catch {
        // Ignore background file-list refresh failures.
      }
    };

    void refreshCatalog();
  }, [dropboxAppKey, dropboxToken, isLoaded, isOnline, isPulling, isSyncing, syncFileCatalogWithDropbox]);

  return {
    files,
    activeFileId,
    activeFileName,
    activeFileCloudAheadAt,
    activeFileHasDropboxSyncState,
    lastSyncedAt,
    syncNotice,
    isSyncing,
    isPulling,
    dropboxToken,
    conflict,
    setConflict,
    syncWithDropbox,
    pullFileCatalog,
    connectDropbox,
    disconnectDropbox,
    resolveConflict,
    selectFile,
    createFile,
    renameActiveFile,
    deleteActiveFile,
  };
}
