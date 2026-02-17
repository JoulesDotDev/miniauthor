export type BlockType = "title" | "heading" | "paragraph" | "page-break";

export interface Block {
  id: string;
  type: BlockType;
  text: string;
}

export interface StoredDocument {
  id: "manuscript";
  blocks: Block[];
  updatedAt: number;
  lastSyncedAt: number | null;
  baseMarkdown: string;
  remoteRev: string | null;
}

export interface DropboxTokenState {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId?: string;
}
