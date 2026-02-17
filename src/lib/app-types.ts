export interface ConflictState {
  base: string;
  local: string;
  remote: string;
  resolved: string;
  reason?: string;
}
