export interface UserSettingsResponse {
  log_manager_enabled?: boolean;
  log_manager_cadence: number;
  travel_capacity: number;
  travel_method: string;
}

export interface UpdateSettingsPayload {
  log_manager_enabled?: boolean;
  log_manager_cadence?: number;
  travel_capacity?: number;
  travel_method?: string;
}

export interface GenericSuccessResponse {
  success: boolean;
  message?: string;
}

