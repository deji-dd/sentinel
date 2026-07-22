export interface SystemServiceMetrics {
  name: string;
  status: "healthy" | "connected" | "offline";
  latency: number;
  cpu?: number;
  memory?: number;
}

export interface StatusResponse {
  status: "online" | "offline";
  uptime: number;
  timestamp: number;
  system: {
    memory: {
      total: number;
      used: number;
      free: number;
      percent: number;
    };
    cpu: {
      cores: number;
      model: string;
      load: number;
    };
  };
  services: SystemServiceMetrics[];
}

export interface LogBackfillProgressPayload {
  status: "in_progress" | "completed" | "error";
  logs_parsed: number;
  oldest_timestamp_reached: number | null;
  error?: string;
}

export interface StatusSyncPayload {
  backfill: LogBackfillProgressPayload | null;
}

export interface StatusSettingsPayload {
  log_manager_cadence: number;
  travel_capacity: number;
  travel_method: string;
}

export interface StatusStreamUpdate {
  type: "update";
  status: StatusResponse;
  sync: StatusSyncPayload | null;
  settings: StatusSettingsPayload;
}
