export interface RequestContext {
  userId: string;
  guildId: string;
}

export interface TerritoryMapData {
  id: string;
  label: string;
  path: string;
  fill?: string;
  stroke?: string;
}

export interface MapPainterState {
  currentMapId: string | null;
  labels: {
    id: string;
    text: string;
    color: string;
    enabled: boolean;
    territories: string[];
    respect: number;
    sectors: number;
    rackets: number;
  }[];
  assignments?: Record<string, string>; // Derived helper in UI, stored for compatibility
  map?: {
    id: string;
    name: string;
    guild_id: string;
  };
  territoryMetadata?: Record<string, { 
    sector: number; 
    respect: number; 
    size: number; 
    slots: number;
    racket?: { name: string; reward: string; level: number } | null;
  }>;
  prices?: {
    items: Record<string, number>;
    points: number;
  };
}

export interface MapSessionData {
  token: string;
  mapId: string;
  userId: string;
  expiresAt: string;
}
