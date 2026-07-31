import { Logger } from "@sentinel/utils";
import { db } from "@sentinel/database";
import { type TornSchema } from "@sentinel/torn-api";
import {
  parseBarterTrade,
  parseStandardCash,
  parseTransformationSink,
  parseEquityProperty,
  parseFactionLiability,
  parseStorageTransfer,
  parseZeroCostInjection,
  EQUITY_LOG_IDS,
  FACTION_LOG_IDS,
  STORAGE_TRANSFER_LOG_IDS,
  ZERO_COST_LOG_IDS,
} from "../workers/private/wealth.js";

const logger = new Logger("ledger_healer");

type UserLog = TornSchema<"UserLog">;

export async function healLedger(): Promise<void> {
  logger.info("Starting V2 Wealth Ledger Self-Healing Script...");

  // 1. Fetch Wealth Ledger initialization timestamp
  const initState = await db.systemState.findUnique({
    where: { id: "wealth_ledger_init" },
  });

  if (!initState || !initState.init) {
    logger.error("Ledger has not been initialized yet. Run baseline sync first.");
    return;
  }

  const baselineDate = initState.createdAt;
  const baselineTimestamp = Math.floor(baselineDate.getTime() / 1000);
  logger.info(`Ledger Baseline: ${baselineDate.toISOString()} (${baselineTimestamp})`);

  // 2. Fetch all logs created AFTER baseline
  const logsToHeal = await db.personalLog.findMany({
    where: { timestamp: { gt: baselineDate } },
    orderBy: { timestamp: "asc" },
  });

  logger.info(`Scanning ${logsToHeal.length} personal logs recorded after baseline...`);

  let healedCount = 0;

  for (const pLog of logsToHeal) {
    const logIdStr = pLog.id;
    const ledgerEvId = `ledger_ev_${logIdStr}`;

    // Skip if LedgerEvent already exists
    const existing = await db.ledgerEvent.findUnique({ where: { id: ledgerEvId } });
    if (existing) continue;

    const logCode = pLog.log;
    const formattedLog: UserLog = {
      id: pLog.id as any,
      timestamp: Math.floor(pLog.timestamp.getTime() / 1000),
      data: pLog.data as any,
      details: { id: pLog.log, title: pLog.title || "", category: pLog.category || "" },
      params: {} as any,
    };

    if (logCode === 4430) {
      await parseBarterTrade(formattedLog);
    } else if (EQUITY_LOG_IDS.includes(logCode)) {
      await parseEquityProperty(formattedLog);
    } else if (FACTION_LOG_IDS.includes(logCode)) {
      await parseFactionLiability(formattedLog);
    } else if (STORAGE_TRANSFER_LOG_IDS.includes(logCode)) {
      await parseStorageTransfer(formattedLog);
    } else if (ZERO_COST_LOG_IDS.includes(logCode)) {
      await parseZeroCostInjection(formattedLog);
    } else if ([1112, 1225, 4200, 4201, 5010, 4320, 1226, 1113, 4210, 4220, 5011, 4322].includes(logCode)) {
      await parseStandardCash(formattedLog);
    } else {
      await parseTransformationSink(formattedLog);
    }

    const checkHealed = await db.ledgerEvent.findUnique({ where: { id: ledgerEvId } });
    if (checkHealed) {
      healedCount++;
      logger.info(`[HEALED] Successfully recovered log ${logIdStr} (Log Code: ${logCode})`);
    }
  }

  logger.info(`Ledger Self-Healing Complete! Recovered ${healedCount} past logs.`);
}

// Auto-run execution wrapper
if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.includes("heal-ledger")
) {
  healLedger()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error("Fatal error during ledger healing:", err);
      process.exit(1);
    });
}
