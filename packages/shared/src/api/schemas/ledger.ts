/**
 * Ledger Actions & Operations API Schemas
 */
export interface ResolveLedgerActionPayload {
  transaction_id: string;
  manual_cash_value: number;
}

export interface ReinitLedgerPayload {
  ledger: "gym" | "items" | "crimes" | "war";
}
