export interface CrimeRoiItem {
  crime_name: string;
  total_value: number;
  nerve_spent: number;
  profit_per_nerve: number;
}

export interface CrimesRoiResponse {
  data: CrimeRoiItem[];
  initializing?: boolean;
}

export interface RecentCrimeLogItem {
  timestamp: number;
  crime_name: string;
  nerve_spent: number;
  total_value: number;
}

export interface CrimesRecentResponse {
  data: RecentCrimeLogItem[];
}

export interface HistoricalProfitPoint {
  timestamp: number;
  daily_profit: number;
}

export interface CrimesHistoricalResponse {
  data: HistoricalProfitPoint[];
}

export interface CrimesUnmappedResponse {
  data: string[];
}

export interface CrimesAllResponse {
  data: Array<{
    id: number;
    name: string;
  }>;
}

export interface MapCrimeActionPayload {
  action: string;
  crime_id: number;
}

