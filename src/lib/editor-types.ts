export type BlockType = "title" | "heading1" | "heading2" | "paragraph";

export interface Block {
  id: string;
  type: BlockType;
  text: string;
}

export interface ManuscriptFileMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  renamedAt: number;
}

export interface StoredDocument {
  id: string;
  blocks: Block[];
  updatedAt: number;
  lastSyncedAt: number | null;
  baseMarkdown: string;
  remoteRev: string | null;
}

export interface StoredWorkspace {
  files: ManuscriptFileMeta[];
  activeFileId: string | null;
}

export interface DropboxTokenState {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId?: string;
}
