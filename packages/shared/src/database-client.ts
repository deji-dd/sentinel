// Minimal query-client shape used by shared helpers.
// This keeps shared utilities decoupled from a specific database SDK.
export interface DatabaseClient {
  from(table: string): any;
  rpc?(fn: string, params?: Record<string, unknown>): any;
}
