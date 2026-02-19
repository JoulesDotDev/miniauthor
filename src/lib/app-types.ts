export interface ConflictState {
  fileId: string;
  fileName: string;
  base: string;
  local: string;
  remote: string;
  resolved: string;
  reason?: string;
}
