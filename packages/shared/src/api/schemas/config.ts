/**
 * API Key / System Config Schemas
 */
export interface ConfigureApiKeyPayload {
  apiKey: string;
}

export interface ConfigureApiKeyResponse {
  success: boolean;
}

export interface ConfigStatusResponse {
  configured: boolean;
  updated_at?: number;
}
