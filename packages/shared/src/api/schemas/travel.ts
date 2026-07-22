import { TravelDestinationDocument, UserStateDocument, TravelUnmappedAreaDocument } from "../../database/index.js";

export type LiveStateDoc = Extract<UserStateDocument, { id: "live_state" }>;

export interface EnhancedTravelDestinationStock {
  id: number;
  quantity: number;
  cost: number;
  type: string;
  market_price: number;
  depletion_rate: number;
  data_points: number;
  tracked_profit: number;
}

export interface EnhancedTravelDestination extends Omit<TravelDestinationDocument, "stocks"> {
  stocks: EnhancedTravelDestinationStock[];
}

export interface TravelHistoricalDataPoint {
  timestamp: number;
  dailyYield: number;
}

export interface TravelStateResponse {
  data: EnhancedTravelDestination[];
  historicalData?: TravelHistoricalDataPoint[];
  live_state?: LiveStateDoc | null;
}

export interface TravelUnmappedResponse {
  data: TravelUnmappedAreaDocument[];
}
