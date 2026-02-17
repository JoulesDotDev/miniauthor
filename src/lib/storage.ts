import type { DropboxTokenState, StoredDocument } from "@/lib/editor-types";

const DB_NAME = "book-writer-db";
const DB_VERSION = 1;
const STORE_NAME = "kv";
const DOCUMENT_KEY = "manuscript";
const TOKEN_KEY = "dropbox-token";

interface KvRecord<T> {
  key: string;
  value: T;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

async function readValue<T>(key: string): Promise<T | null> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);

    request.onsuccess = () => {
      const record = request.result as KvRecord<T> | undefined;
      resolve(record?.value ?? null);
    };

    request.onerror = () => reject(request.error);
  });
}

async function writeValue<T>(key: string, value: T): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    store.put({ key, value } satisfies KvRecord<T>);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function getStoredDocument(): Promise<StoredDocument | null> {
  return readValue<StoredDocument>(DOCUMENT_KEY);
}

export function setStoredDocument(doc: StoredDocument): Promise<void> {
  return writeValue(DOCUMENT_KEY, doc);
}

export function getStoredDropboxToken(): Promise<DropboxTokenState | null> {
  return readValue<DropboxTokenState>(TOKEN_KEY);
}

export function setStoredDropboxToken(token: DropboxTokenState | null): Promise<void> {
  if (token === null) {
    return writeValue(TOKEN_KEY, null);
  }

  return writeValue(TOKEN_KEY, token);
}
