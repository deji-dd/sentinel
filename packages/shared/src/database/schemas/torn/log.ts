import { TornSchema } from "../../../torn";
import { BaseDocument, Collection } from "../../collection.js";
import { sentinelDbEngine } from "../../engine.js";

// 1. Define base types
type StatIncrease = {
  strength_increased?: number;
  defense_increased?: number;
  speed_increased?: number;
  dexterity_increased?: number;
  trains?: number;
  energy_used?: number;
};

export type CrimeActivity = {
  crime_action: string;
  outcome: number;
  nerve: number;
  unique?: string;
  money_gained?: number;
  items_gained?: Record<string, number>;
  points_gained?: number;
  money_lost?: number;
  items_lost?: Record<string, number>;
};

type StockActivity = {
  stock: number;
  amount: number;
  worth: number;
  fees?: number;
  profit?: number;
};

type StockPayout = {
  stock: number;
  item?: Record<string, number>;
  energy_increased?: number;
  money?: number;
  nerve_increased?: number;
  happy_increased?: number;
  points_increased?: number;
};

type TradeActivity = {
  parsed_trade_id: string;
};

type PropertyActivity = {
  property: number;
  property_id: number;
  upkeep_paid?: number;
  cost?: number;
};

type CompanyActivity = {
  company: number;
  withdrawn?: number;
  deposited?: number;
  cost?: number;
  sale_value?: number;
};

type FactionItemActivity = {
  item: number;
  quantity: number;
};

export type TransformationSinkData = {
  item?: number | Record<string, number>;
  items?: any[];
  items_lost?: Record<string, number>;
  items_gained?: Record<string, number>;
  money?: number;
  money_lost?: number;
  money_gained?: number;
  points?: number;
  points_lost?: number;
  points_used?: number;
  points_received?: number;
  faction?: number | boolean;
  set?: string; // For Museum
  quantity?: number;
};

export type StandardCashData = {
  items?: {
    id: number;
    uid: number | null;
    qty: number;
  }[];
  cost_each?: number;
  cost_total?: number;
  quantity?: number;
  item?:
    | number
    | {
        id: number;
        uid: number | null;
        qty: number;
      }[];
  value_each?: number;
  total_value?: number;
  fee?: number;
  final_price?: number;
};

type StorageTransferData = {
  items?: {
    id: number | string;
    uid: number | null;
    qty: number;
  }[];
  quantity?: number;
  item?: {
    id: number | string;
    uid: number | null;
    qty: number;
  }[];
};

type ZeroCostInjectionData = {
  item?:
    | number
    | {
        id: number;
        uid: number;
        qty: number;
      }[];
  first_item?: number;
  second_item?: number;
  money?: number;
  points?: number;
  property?: number;
};

// 2. Create the Registry
export type LogDataRegistry = {
  1110: StorageTransferData;
  1111: StorageTransferData; /* No sample for this */
  1112: StandardCashData;
  1113: StandardCashData;
  1222: StorageTransferData;
  1223: StorageTransferData;
  1225: StandardCashData;
  1226: StandardCashData;
  1302: StorageTransferData;
  1303: StorageTransferData;
  1403: StorageTransferData;
  1404: ZeroCostInjectionData;
  2052: StatIncrease;
  2053: StatIncrease;
  2054: StatIncrease;
  2055: StatIncrease;
  2120: StatIncrease;
  2130: StatIncrease;
  2140: StatIncrease;
  2150: StatIncrease;
  4200: StandardCashData;
  4201: {
    item: number;
    quantity: number;
    cost_each: number;
    cost_total: number;
    area: number;
  };
  4210: StandardCashData;
  4220: StandardCashData;
  4300: StorageTransferData;
  4320: StandardCashData;
  4322: StandardCashData;
  4430: TradeActivity & {
    trade_id: number;
  };
  4440: TradeActivity & { money: number }; // Outgoing
  4441: TradeActivity & { money: number }; // Incoming
  4445: TradeActivity & { items: { id: number; qty: number; uid?: number }[] }; // Outgoing
  4446: TradeActivity & { items: { id: number; qty: number; uid?: number }[] }; // Incoming
  4447: StorageTransferData;
  4448: StorageTransferData;
  4450: TradeActivity & { property: number }; // Outgoing Property
  4451: TradeActivity & { property: number }; // Incoming Property
  4475: TradeActivity & { company: number }; // Outgoing Company
  4476: TradeActivity & { company: number }; // Incoming Company
  5000: StorageTransferData;
  5001: StorageTransferData;
  5010: StandardCashData;
  5011: StandardCashData;
  5300: StatIncrease;
  5301: StatIncrease;
  5302: StatIncrease;
  5303: StatIncrease;
  5510: StockActivity;
  5511: StockActivity;
  5520: StockActivity;
  5521: StockActivity;
  5530: StockPayout;
  5531: StockPayout;
  5532: StockPayout; /* No sample log for this */
  5533: StockPayout; /* No sample log for this */
  5534: StockPayout;
  5535: StockPayout;
  5536: StockPayout;
  5537: StockPayout; /* No sample log for this */
  5575: ZeroCostInjectionData;
  5900: PropertyActivity;
  5920: PropertyActivity;
  5927: PropertyActivity; /* No sample log for this */
  5928: PropertyActivity;
  6000: {
    origin: number;
    destination: number;
    travel_method: string;
    duration: number;
  };
  6221: {
    pay: number;
  };
  6222: {
    job_points: number;
    working_stats_received: string;
    company: number;
  };
  6280: CompanyActivity;
  6284: CompanyActivity;
  6285: CompanyActivity;
  6290: CompanyActivity;
  6291: CompanyActivity;
  6292: CompanyActivity;
  6300: CompanyActivity;
  6526: StatIncrease;
  6527: StatIncrease;
  6528: StatIncrease;
  6529: StatIncrease;
  6728: FactionItemActivity;
  6746: FactionItemActivity;
  6747: FactionItemActivity;
  7011: ZeroCostInjectionData;
  8374: ZeroCostInjectionData;
  8375: ZeroCostInjectionData;
  8377: ZeroCostInjectionData;
  8378: ZeroCostInjectionData;
  9010: CrimeActivity;
  9015: CrimeActivity;
  9020: CrimeActivity;
  9025: CrimeActivity;
  9027: CrimeActivity;
  9030: CrimeActivity;
  9050: CrimeActivity;
  9051: CrimeActivity;
  9052: CrimeActivity;
  9053: CrimeActivity;
  9055: CrimeActivity;
  9056: CrimeActivity;
  9060: CrimeActivity;
  9065: CrimeActivity;
  9070: CrimeActivity;
  9071: CrimeActivity;
  9072: CrimeActivity;
  9073: CrimeActivity;
  9150: CrimeActivity;
  9154: CrimeActivity;
  9155: CrimeActivity;
  9158: CrimeActivity;
  9160: CrimeActivity;
  9163: CrimeActivity;
  9165: CrimeActivity;
  9190: CrimeActivity;
  9191: CrimeActivity;
};

// 3. The Strict Wrapper
export type StrictUserLog<ID extends keyof LogDataRegistry> = Omit<
  TornSchema<"UserLog">,
  "data"
> & {
  data: LogDataRegistry[ID];
};

export type LogRouteMap = {
  [K in keyof LogDataRegistry]?: Array<(log: StrictUserLog<K>) => void>;
};

export type PersonalLogDocument = BaseDocument & TornSchema<"UserLog"> & {};

export const PersonalLogs = new Collection<PersonalLogDocument>(
  sentinelDbEngine,
  "personal_logs",
  [
    { key: "category", type: "TEXT" },
    { key: "timestamp", type: "INTEGER" },
    { key: "details.id", type: "INTEGER" },
    { key: "data.parsed_trade_id", type: "TEXT" },
  ],
);
