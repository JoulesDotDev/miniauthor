import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { ConflictState } from "@/lib/app-types";
import type { Block, DropboxTokenState, StoredDocument } from "@/lib/editor-types";
import {
  dropboxDownloadFile,
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
  getStoredDocument,
  getStoredDropboxToken,
  setStoredDocument,
  setStoredDropboxToken,
} from "@/lib/storage";

const DROPBOX_PATH = "/manuscript.md";

function isDropboxAuthError(errorMessage: string): boolean {
  return /invalid_grant|invalid_access_token|expired_access_token|401/i.test(errorMessage);
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
  lastSyncedAt: number | null;
  syncNotice: string;
  isSyncing: boolean;
  dropboxToken: DropboxTokenState | null;
  conflict: ConflictState | null;
  setConflict: Dispatch<SetStateAction<ConflictState | null>>;
  syncWithDropbox: () => Promise<boolean>;
  connectDropbox: () => Promise<void>;
  disconnectDropbox: () => void;
  resolveConflict: () => Promise<void>;
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
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [baseMarkdown, setBaseMarkdown] = useState<string>("");
  const [remoteRev, setRemoteRev] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [dropboxToken, setDropboxToken] = useState<DropboxTokenState | null>(null);
  const [syncNotice, setSyncNotice] = useState<string>("Offline-first mode active.");
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [conflict, setConflict] = useState<ConflictState | null>(null);

  const wasOnlineRef = useRef<boolean>(navigator.onLine);

  const syncWithDropbox = useCallback(async (): Promise<boolean> => {
    if (isSyncing) {
      return false;
    }

    if (!dropboxAppKey) {
      setSyncNotice("Add VITE_DROPBOX_APP_KEY before connecting Dropbox.");
      return false;
    }

    if (!dropboxToken) {
      setSyncNotice("Connect Dropbox first.");
      return false;
    }

    if (!isOnline) {
      setSyncNotice("Offline. Changes stay in IndexedDB until reconnect.");
      return false;
    }

    setIsSyncing(true);

    try {
      const validToken = await ensureValidDropboxToken(dropboxAppKey, dropboxToken);

      if (
        validToken.accessToken !== dropboxToken.accessToken ||
        validToken.expiresAt !== dropboxToken.expiresAt
      ) {
        setDropboxToken(validToken);
      }

      const localMarkdown = serializeBlocksToMarkdown(blocks);
      const remoteFile = await dropboxDownloadFile(validToken.accessToken, DROPBOX_PATH);
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
          base: "",
          local: mergeLocalMarkdown,
          remote: mergeRemoteMarkdown,
          resolved: mergeLocalMarkdown,
          reason: "First sync found both local and Dropbox drafts. Choose one or merge manually.",
        });
        setSyncNotice("First sync conflict: local and Dropbox both contain writing.");
        return false;
      }

      const mergeResult = threeWayMergeText(baseMarkdown, mergeLocalMarkdown, mergeRemoteMarkdown);

      if (mergeResult.status === "conflict") {
        setConflict({
          base: baseMarkdown,
          local: localMarkdown,
          remote: remoteMarkdown,
          resolved: localMarkdown,
          reason: mergeResult.reason,
        });
        setSyncNotice("Sync conflict detected. Resolve it in the diff view.");
        return false;
      }

      const mergedMarkdown = mergeResult.merged;
      let latestRev = remoteFile?.rev ?? remoteRev;

      if (!remoteFile || mergedMarkdown !== mergeRemoteMarkdown) {
        const uploaded = await dropboxUploadFile(validToken.accessToken, DROPBOX_PATH, mergedMarkdown);
        latestRev = uploaded.rev;
      }

      setBlocks(normalizeBlocksForEditor(parseMarkdownToBlocks(mergedMarkdown)));
      setBaseMarkdown(mergedMarkdown);
      setRemoteRev(latestRev ?? null);

      const now = Date.now();
      setLastSyncedAt(now);
      setUpdatedAt(now);
      setConflict(null);
      setSyncNotice("Dropbox sync complete.");

      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown Dropbox error.";

      if (isDropboxAuthError(detail)) {
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
    dropboxToken,
    isOnline,
    isSyncing,
    lastSyncedAt,
    remoteRev,
    setBlocks,
    setUpdatedAt,
  ]);

  const connectDropbox = useCallback(async () => {
    if (!dropboxAppKey) {
      setSyncNotice("Missing VITE_DROPBOX_APP_KEY.");
      return;
    }

    await startDropboxAuth(dropboxAppKey, dropboxRedirectUri);
  }, [dropboxAppKey, dropboxRedirectUri]);

  const disconnectDropbox = useCallback(() => {
    setDropboxToken(null);
    setConflict(null);
    setSyncNotice("Dropbox disconnected locally.");
  }, []);

  const resolveConflict = useCallback(async () => {
    if (!conflict || !dropboxToken || !dropboxAppKey) {
      return;
    }

    setIsSyncing(true);

    try {
      const validToken = await ensureValidDropboxToken(dropboxAppKey, dropboxToken);

      if (
        validToken.accessToken !== dropboxToken.accessToken ||
        validToken.expiresAt !== dropboxToken.expiresAt
      ) {
        setDropboxToken(validToken);
      }

      const uploadResult = await dropboxUploadFile(validToken.accessToken, DROPBOX_PATH, conflict.resolved);
      const resolvedBlocks = normalizeBlocksForEditor(parseMarkdownToBlocks(conflict.resolved));
      const now = Date.now();

      setBlocks(resolvedBlocks);
      setBaseMarkdown(conflict.resolved);
      setRemoteRev(uploadResult.rev);
      setLastSyncedAt(now);
      setUpdatedAt(now);
      setConflict(null);
      setSyncNotice("Conflict resolved and synced to Dropbox.");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Conflict upload failed.";

      if (isDropboxAuthError(detail)) {
        setDropboxToken(null);
        setSyncNotice("Dropbox session expired. Please reconnect Dropbox.");
      } else {
        setSyncNotice(detail);
      }
    } finally {
      setIsSyncing(false);
    }
  }, [conflict, dropboxAppKey, dropboxToken, setBlocks, setUpdatedAt]);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const [storedDocument, storedToken] = await Promise.all([
          getStoredDocument(),
          getStoredDropboxToken(),
        ]);

        if (cancelled) {
          return;
        }

        if (storedDocument) {
          const normalizedStored = normalizeBlocksForEditor(storedDocument.blocks);
          setBlocks(normalizedStored.length ? normalizedStored : [createBlock("title"), createBlock("paragraph")]);
          setUpdatedAt(storedDocument.updatedAt);
          setLastSyncedAt(storedDocument.lastSyncedAt);
          setBaseMarkdown(storedDocument.baseMarkdown);
          setRemoteRev(storedDocument.remoteRev);
        }

        if (storedToken) {
          setDropboxToken(storedToken);
        }

        if (dropboxAppKey) {
          try {
            const oauthToken = await finishDropboxAuthIfNeeded(dropboxAppKey, dropboxRedirectUri);

            if (oauthToken && !cancelled) {
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
  }, [dropboxAppKey, dropboxRedirectUri, setBlocks, setUpdatedAt]);

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    const payload: StoredDocument = {
      id: "manuscript",
      blocks,
      updatedAt,
      lastSyncedAt,
      baseMarkdown,
      remoteRev,
    };

    const timeout = window.setTimeout(() => {
      void setStoredDocument(payload);
    }, 500);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [baseMarkdown, blocks, isLoaded, lastSyncedAt, remoteRev, updatedAt]);

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    void setStoredDropboxToken(dropboxToken);
  }, [dropboxToken, isLoaded]);

  useEffect(() => {
    if (!isLoaded || !dropboxToken) {
      wasOnlineRef.current = isOnline;
      return;
    }

    if (!wasOnlineRef.current && isOnline) {
      void syncWithDropbox();
    }

    wasOnlineRef.current = isOnline;
  }, [dropboxToken, isLoaded, isOnline, syncWithDropbox]);

  return {
    lastSyncedAt,
    syncNotice,
    isSyncing,
    dropboxToken,
    conflict,
    setConflict,
    syncWithDropbox,
    connectDropbox,
    disconnectDropbox,
    resolveConflict,
  };
}
