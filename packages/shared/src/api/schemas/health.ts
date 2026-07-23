/**
 * Health Check API Schemas
 */
export interface HealthResponse {
  status: "healthy" | string;
  timestamp: number;
}
