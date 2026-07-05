/* eslint-disable @typescript-eslint/no-explicit-any */
import { executeSync } from "../lib/sync.js";
import { getSystemApiKey } from "../lib/api-keys.js";
import { tornApi } from "../services/torn-client.js";
import { Logger } from "../lib/logger.js";
import { startDbScheduledRunner } from "../lib/scheduler.js";
import { TABLE_NAMES } from "@sentinel/shared";
import { getKysely } from "@sentinel/shared/db/sqlite.js";
import { randomUUID } from "crypto";
import { sendIpcRequest } from "../lib/ipc-client.js";
import { getPersonalTrainingRecommendations } from "@sentinel/shared/training-recommendations.js";
import { settingsCache } from "../lib/settings-cache.js";

const WORKER_NAME = "state_ticker";
const logger = new Logger(WORKER_NAME);

export async function tickState(): Promise<void> {
  const apiKey = await getSystemApiKey("personal");
  const db = getKysely();
  const startTime = Date.now();

  try {
    // 1. Fetch user data and live stocks price details in parallel
    const [userResponse, tornStocksResponse] = (await Promise.all([
      tornApi.get("/user", {
        apiKey,
        queryParams: {
          selections: [
            "money",
            "networth",
            "gym",
            "bars",
            "cooldowns",
            "battlestats",
            "perks",
            "profile",
            "stocks",
          ],
        },
      }),
      tornApi.get("/torn/stocks" as any, { apiKey }).catch(() => null),
    ])) as any[];

    if (!userResponse) {
      throw new Error("Empty response from user endpoint");
    }

    // 2. Sync User Data details
    const profile = userResponse.profile;
    if (profile) {
      await db
        .insertInto(TABLE_NAMES.USER_DATA as any)
        .values({
          player_id: Number(profile.id || profile.player_id),
          name: profile.name,
          profile_image: profile.profile_image || null,
          is_donator: profile.donator ? 1 : 0,
          updated_at: new Date().toISOString(),
        })
        .onConflict((oc: any) =>
          oc.column("player_id").doUpdateSet({
            name: profile.name,
            profile_image: profile.profile_image || null,
            is_donator: profile.donator ? 1 : 0,
            updated_at: new Date().toISOString(),
          }),
        )
        .execute();
    }

    // 3. Populate sentinel_torn_stocks table with latest prices
    const tornStocksMap = new Map<
      number,
      { name: string; acronym: string; price: number }
    >();
    if (tornStocksResponse?.stocks) {
      for (const stock of tornStocksResponse.stocks) {
        const stockId = Number(stock.id);
        const name = String(stock.name || "");
        const acronym = String(stock.acronym || "");
        const price = Number(stock.market?.price || 0);

        tornStocksMap.set(stockId, { name, acronym, price });

        await db
          .insertInto("sentinel_torn_stocks" as any)
          .values({
            stock_id: stockId,
            name,
            acronym,
            logo_image: stock.logo_image || null,
            price,
            market_cap: Number(stock.market?.market_cap || 0),
            shares: Number(stock.market?.shares || 0),
            investors: Number(stock.market?.investors || 0),
            bonus_passive: stock.bonus?.passive ? 1 : 0,
            bonus_frequency: Number(stock.bonus?.frequency || 0),
            bonus_requirement: Number(stock.bonus?.requirement || 0),
            bonus_description: String(stock.bonus?.description || ""),
            updated_at: new Date().toISOString(),
          })
          .onConflict((oc: any) =>
            oc.column("stock_id").doUpdateSet({
              name,
              acronym,
              logo_image: stock.logo_image || null,
              price,
              market_cap: Number(stock.market?.market_cap || 0),
              shares: Number(stock.market?.shares || 0),
              investors: Number(stock.market?.investors || 0),
              bonus_passive: stock.bonus?.passive ? 1 : 0,
              bonus_frequency: Number(stock.bonus?.frequency || 0),
              bonus_requirement: Number(stock.bonus?.requirement || 0),
              bonus_description: String(stock.bonus?.description || ""),
              updated_at: new Date().toISOString(),
            }),
          )
          .execute();
      }
    }

    // 4. Save User Snapshot
    const money = userResponse.money;
    const bars = userResponse.bars;
    const cooldowns = userResponse.cooldowns;

    if (!money || !bars || !cooldowns) {
      throw new Error("Missing money, bars, or cooldowns in user selections");
    }

    const wallet = money.wallet || 0;
    const netWorth = money.daily_networth || 0;
    const activeGym = userResponse.active_gym || null;

    const energyCurrent = bars.energy?.current || 0;
    const energyMaximum = bars.energy?.maximum || 0;
    const nerveCurrent = bars.nerve?.current || 0;
    const nerveMaximum = bars.nerve?.maximum || 0;
    const happyCurrent = bars.happy?.current || 0;
    const happyMaximum = bars.happy?.maximum || 0;
    const lifeCurrent = bars.life?.current || 0;
    const lifeMaximum = bars.life?.maximum || 0;
    const chainCurrent = bars.chain?.current || 0;
    const chainMaximum = bars.chain?.max || 0;

    const energySecondsPerPoint = energyMaximum === 150 ? 120 : 180;
    const nerveSecondsPerPoint = 300;
    const energyFlatTimeToFull = energyMaximum * energySecondsPerPoint;
    const nerveFlatTimeToFull = nerveMaximum * nerveSecondsPerPoint;
    const energyTimeToFull =
      (energyMaximum - energyCurrent) * energySecondsPerPoint;
    const nerveTimeToFull =
      (nerveMaximum - nerveCurrent) * nerveSecondsPerPoint;

    const drugCooldown = cooldowns.drug || 0;
    const medicalCooldown = cooldowns.medical || 0;
    const boosterCooldown = cooldowns.booster || 0;

    // Save user snapshot
    await db
      .insertInto(TABLE_NAMES.USER_SNAPSHOTS)
      .values({
        id: randomUUID(),
        liquid_cash: wallet, // using wallet cash only
        bookie_value: 0,
        bookie_updated_at: null,
        net_worth: netWorth,
        active_gym: activeGym,
        energy_current: energyCurrent,
        energy_maximum: energyMaximum,
        nerve_current: nerveCurrent,
        nerve_maximum: nerveMaximum,
        happy_current: happyCurrent,
        happy_maximum: happyMaximum,
        life_current: lifeCurrent,
        life_maximum: lifeMaximum,
        chain_current: chainCurrent,
        chain_maximum: chainMaximum,
        energy_flat_time_to_full: energyFlatTimeToFull,
        energy_time_to_full: energyTimeToFull,
        nerve_flat_time_to_full: nerveFlatTimeToFull,
        nerve_time_to_full: nerveTimeToFull,
        drug_cooldown: drugCooldown,
        medical_cooldown: medicalCooldown,
        booster_cooldown: boosterCooldown,
        created_at: new Date().toISOString(),
      })
      .execute();

    // 5. Sync Battlestats Snapshots
    const battlestats = userResponse.battlestats;
    if (battlestats) {
      const strength = Number(battlestats.strength?.value || 0);
      const speed = Number(battlestats.speed?.value || 0);
      const defense = Number(battlestats.defense?.value || 0);
      const dexterity = Number(battlestats.dexterity?.value || 0);
      const total_stats = Number(
        battlestats.total || strength + speed + defense + dexterity,
      );

      if (total_stats > 0) {
        const latestStats = await db
          .selectFrom(TABLE_NAMES.BATTLESTATS_SNAPSHOTS)
          .selectAll()
          .orderBy("created_at", "desc")
          .limit(1)
          .executeTakeFirst();

        const statsChanged =
          !latestStats ||
          latestStats.strength !== strength ||
          latestStats.speed !== speed ||
          latestStats.defense !== defense ||
          latestStats.dexterity !== dexterity;

        if (statsChanged) {
          await db
            .insertInto(TABLE_NAMES.BATTLESTATS_SNAPSHOTS)
            .values({
              id: randomUUID(),
              strength,
              speed,
              defense,
              dexterity,
              total_stats,
              created_at: new Date().toISOString(),
            })
            .execute();
          logger.success(
            `Recorded new battlestats snapshot: Total ${total_stats.toLocaleString()}`,
          );
        }
      }
    }

    // 7. Calculate Stock-Only Portfolio Snapshot
    let stocksTotalValue = 0;
    const stocksList: any[] = [];
    if (userResponse.stocks) {
      for (const holding of userResponse.stocks) {
        const stockId = Number(holding.id);
        const shares = Number(holding.shares || 0);
        const priceInfo = tornStocksMap.get(stockId);

        if (priceInfo && shares > 0) {
          const totalVal = shares * priceInfo.price;
          stocksTotalValue += totalVal;

          const transactionsList = holding.transactions || [];
          let totalCost = 0;
          let totalSharesForCost = 0;
          let T_start = 0;

          for (const tx of transactionsList) {
            const txShares = Number(tx.shares || 0);
            const txPrice = Number(tx.price || 0);
            totalCost += txShares * txPrice;
            totalSharesForCost += txShares;

            const t = Number(tx.time || tx.timestamp || 0);
            if (t > 0 && (T_start === 0 || t < T_start)) {
              T_start = t;
            }
          }

          const avgBuyPrice =
            totalSharesForCost > 0
              ? totalCost / totalSharesForCost
              : priceInfo.price;
          const boughtValue = avgBuyPrice * shares;
          const profitLoss = totalVal - boughtValue;
          const profitLossPct =
            boughtValue > 0 ? (profitLoss / boughtValue) * 100 : 0;

          stocksList.push({
            id: stockId,
            name: priceInfo.name,
            acronym: priceInfo.acronym,
            shares,
            market_price: priceInfo.price,
            total_value: totalVal,
            avg_buy_price: avgBuyPrice,
            profit_loss: profitLoss,
            profit_loss_pct: profitLossPct,
          });
        }
      }
    }

    // Build held stocks map
    const heldStocksMap = new Map<number, number>();
    for (const h of stocksList) {
      heldStocksMap.set(h.id, h.shares);
    }

    // Resolve point price and item prices from DB cache
    const marketPrices = await db
      .selectFrom("sentinel_market_prices" as any)
      .select(["key", "value"])
      .execute()
      .catch(() => []);
    const priceMap = new Map<string, number>();
    for (const row of marketPrices || []) {
      priceMap.set(row.key.toLowerCase(), Number(row.value));
    }
    const pointPrice = priceMap.get("points") ?? 31000;

    const dbItems = await db
      .selectFrom("sentinel_torn_items" as any)
      .select(["name", "value"])
      .execute()
      .catch(() => []);
    for (const item of dbItems || []) {
      priceMap.set(item.name.toLowerCase(), Number(item.value || 0));
    }

    const benefits: any[] = [];

    // Process each stock returned by Torn API to calculate benefit blocks progression
    if (tornStocksResponse?.stocks) {
      for (const stock of tornStocksResponse.stocks) {
        if (
          !stock.bonus ||
          !stock.bonus.requirement ||
          stock.bonus.requirement <= 0
        ) {
          continue;
        }

        const stockId = Number(stock.id);
        const acronym = stock.acronym || "";
        const name = stock.name || "";
        const currentPrice = stock.market?.price || 0;
        const requirement = Number(stock.bonus.requirement);
        const frequencyDays = Number(stock.bonus.frequency || 0);
        const isPassive = !!stock.bonus.passive;
        const benefitDesc = stock.bonus.description || "";

        const heldShares = heldStocksMap.get(stockId) || 0;

        let active_increments = 0;
        if (heldShares >= requirement) {
          if (isPassive) {
            active_increments = 1;
          } else {
            active_increments = Math.floor(
              Math.log2(heldShares / requirement + 1),
            );
            if (acronym === "MCS") {
              active_increments = Math.min(10, active_increments);
            }
          }
        }

        let progressPct = 0;
        let sharesNeeded = 0;
        let costToComplete = 0;
        let next_required_total_shares = requirement;

        const isMaxMCS = acronym === "MCS" && active_increments >= 10;
        const isMaxPassive = isPassive && active_increments >= 1;

        if (isMaxMCS || isMaxPassive) {
          progressPct = 100;
          sharesNeeded = 0;
          costToComplete = 0;
          next_required_total_shares =
            requirement * (isPassive ? 1 : Math.pow(2, active_increments) - 1);
        } else {
          next_required_total_shares =
            requirement * (Math.pow(2, active_increments + 1) - 1);
          const next_increment_cost =
            requirement * Math.pow(2, active_increments);
          const current_tier_total =
            requirement * (Math.pow(2, active_increments) - 1);
          const held_towards_next = heldShares - current_tier_total;

          progressPct = Math.min(
            100,
            Math.max(0, (held_towards_next / next_increment_cost) * 100),
          );
          sharesNeeded = Math.max(0, next_required_total_shares - heldShares);
          costToComplete = sharesNeeded * currentPrice;
        }

        let payoutValue = 0;
        const descLower = benefitDesc.toLowerCase();

        if (benefitDesc.startsWith("$")) {
          payoutValue = Number(benefitDesc.replace(/[^0-9]/g, "")) || 0;
        } else if (descLower.includes("points")) {
          const ptsMatch = benefitDesc.match(/\d+/);
          const ptsCount = ptsMatch ? Number(ptsMatch[0]) : 0;
          payoutValue = ptsCount * pointPrice;
        } else if (descLower.includes("energy")) {
          if (descLower.includes("six-pack")) {
            payoutValue = priceMap.get("six-pack of energy drink") || 12000000;
          } else {
            payoutValue = 20 * pointPrice;
          }
        } else if (descLower.includes("nerve")) {
          payoutValue = 10 * pointPrice;
        } else if (descLower.includes("lawyer's business card")) {
          payoutValue = priceMap.get("lawyer's business card") || 500000;
        } else if (descLower.includes("medical supplies")) {
          payoutValue = priceMap.get("box of medical supplies") || 270000;
        } else if (descLower.includes("feathery hotel coupon")) {
          payoutValue = priceMap.get("feathery hotel coupon") || 13500000;
        } else if (descLower.includes("drug pack")) {
          payoutValue = priceMap.get("drug pack") || 4200000;
        } else if (descLower.includes("lottery voucher")) {
          payoutValue =
            priceMap.get("lottery voucher") ||
            priceMap.get("lottery ticket") ||
            1000000;
        } else if (descLower.includes("erotic dvd")) {
          payoutValue = priceMap.get("erotic dvd") || 2800000;
        } else if (descLower.includes("grenades")) {
          payoutValue = priceMap.get("box of grenades") || 1000000;
        } else if (descLower.includes("property")) {
          payoutValue = 5000000;
        } else if (descLower.includes("ammunition pack")) {
          payoutValue = priceMap.get("ammunition pack") || 3600000;
        } else if (descLower.includes("clothing cache")) {
          payoutValue = priceMap.get("clothing cache") || 1800000;
        } else if (descLower.includes("alcohol")) {
          payoutValue = priceMap.get("six-pack of alcohol") || 30000;
        } else if (isPassive) {
          payoutValue = 0;
        }

        const baseAnnualPayout =
          frequencyDays > 0 && !isPassive
            ? (payoutValue * 365) / frequencyDays
            : 0;
        let currentAnnualPayout = 0;
        let currentApr = 0;
        if (active_increments >= 1) {
          currentAnnualPayout = active_increments * baseAnnualPayout;
          currentApr =
            heldShares > 0
              ? (currentAnnualPayout / (heldShares * currentPrice)) * 100
              : 0;
        }

        let nextIncrementApr = 0;
        if (!isMaxMCS && !isMaxPassive) {
          const nextIncrementCost =
            requirement * Math.pow(2, active_increments);
          nextIncrementApr =
            nextIncrementCost > 0
              ? (baseAnnualPayout / (nextIncrementCost * currentPrice)) * 100
              : 0;
        }

        benefits.push({
          acronym,
          name,
          active_increments,
          required_shares: requirement,
          held_shares: heldShares,
          current_price: currentPrice,
          progress_pct: progressPct,
          shares_needed: sharesNeeded,
          cost_to_complete: costToComplete,
          next_required_total_shares,
          payout_desc:
            benefitDesc +
            (isPassive ? " (Passive)" : ` every ${frequencyDays}d`),
          frequency_days: frequencyDays,
          payout_value: payoutValue,
          annual_payout_value: currentAnnualPayout || baseAnnualPayout,
          apr: currentApr || nextIncrementApr,
          next_increment_apr: nextIncrementApr,
          is_active: active_increments >= 1,
        });
      }
    }

    benefits.sort((a, b) => b.apr - a.apr);

    const portfolioPayload = {
      liquid: {
        wallet,
      },
      city_bank: {
        amount: 0,
        profit: 0,
        principal: 0,
        timeleft: 0,
        progress_pct: 0,
        cayman_bank: 0,
      },
      stocks: {
        total_value: stocksTotalValue,
        holdings: stocksList,
        benefits,
        items: stocksList,
      },
      total_value: stocksTotalValue + wallet,
      created_at: new Date().toISOString(),
    };

    await db
      .insertInto("sentinel_portfolio_snapshot" as any)
      .values({
        data: JSON.stringify(portfolioPayload),
        created_at: new Date().toISOString(),
      })
      .execute();

    // Prune portfolio snapshots to keep only latest 5
    const allSnaps = await db
      .selectFrom("sentinel_portfolio_snapshot")
      .select("id")
      .orderBy("id", "desc")
      .execute();

    if (allSnaps.length > 5) {
      const idsToDelete = allSnaps.slice(5).map((r: any) => r.id);
      await db
        .deleteFrom("sentinel_portfolio_snapshot")
        .where("id", "in", idsToDelete)
        .execute();
    }

    // 8. Energy & Nerve Alerts Checks
    const personalSettings = settingsCache.get();
    if (personalSettings) {
      // Energy alert
      if (personalSettings.energy_alerts_enabled === 1) {
        const softThreshold = personalSettings.energy_soft_threshold ?? 130;
        const aggressiveIntervalMins =
          personalSettings.energy_aggressive_interval_mins ?? 5;
        const lastAlertSentAt = personalSettings.last_energy_alert_sent_at;
        const lastAlertType = personalSettings.last_energy_alert_type;

        let shouldAlert = false;
        let alertType: "soft" | "aggressive" | null = null;

        if (energyCurrent >= energyMaximum) {
          alertType = "aggressive";
        } else if (energyCurrent >= softThreshold) {
          alertType = "soft";
        }

        if (alertType !== null) {
          const aggressiveCooldownMs = aggressiveIntervalMins * 60 * 1000;
          const isTypeChanged = lastAlertType !== alertType;
          const isCooldownPassed =
            !lastAlertSentAt ||
            Date.now() - new Date(lastAlertSentAt).getTime() >=
              aggressiveCooldownMs;

          if (isTypeChanged || isCooldownPassed) {
            shouldAlert = true;
          }
        } else if (lastAlertType !== null) {
          settingsCache.updateAlertState({
            last_energy_alert_type: null,
            last_energy_alert_sent_at: null,
          });
        }

        if (shouldAlert && alertType) {
          const nowIso = new Date().toISOString();
          let recTitle = "";
          try {
            const recs = await getPersonalTrainingRecommendations(
              db,
              personalSettings.user_id || "",
              apiKey,
              tornApi,
              userResponse,
            );
            recTitle = ` (Train: ${recs.stat})`;
          } catch {}

          const baseDescription =
            alertType === "aggressive"
              ? `Energy is full! Use it immediately to avoid wasting regeneration.`
              : `Energy has reached ${softThreshold} energy.`;

          await sendIpcRequest("send-push", {
            title:
              alertType === "aggressive"
                ? `Energy Full!${recTitle}`
                : `Energy Alert${recTitle}`,
            body: baseDescription,
            url: "https://www.torn.com/gym.php",
          });

          settingsCache.updateAlertState({
            last_energy_alert_type: alertType,
            last_energy_alert_sent_at: nowIso,
          });
        }
      }

      // Nerve alert
      if (personalSettings.crime_alerts_enabled === 1) {
        const softThreshold = personalSettings.crime_soft_threshold ?? 15;
        const aggressiveIntervalMins =
          personalSettings.energy_aggressive_interval_mins ?? 5;
        const lastAlertSentAt = personalSettings.last_crime_alert_sent_at;
        const lastAlertType = personalSettings.last_crime_alert_type;

        let shouldAlert = false;
        let alertType: "soft" | "aggressive" | null = null;

        if (nerveCurrent >= nerveMaximum) {
          alertType = "aggressive";
        } else if (nerveCurrent >= softThreshold) {
          alertType = "soft";
        }

        if (alertType !== null) {
          const aggressiveCooldownMs = aggressiveIntervalMins * 60 * 1000;
          const isTypeChanged = lastAlertType !== alertType;
          const isCooldownPassed =
            !lastAlertSentAt ||
            Date.now() - new Date(lastAlertSentAt).getTime() >=
              aggressiveCooldownMs;

          if (isTypeChanged || isCooldownPassed) {
            shouldAlert = true;
          }
        } else if (lastAlertType !== null) {
          settingsCache.updateAlertState({
            last_crime_alert_type: null,
            last_crime_alert_sent_at: null,
          });
        }

        if (shouldAlert && alertType) {
          const nowIso = new Date().toISOString();
          const baseDescription =
            alertType === "aggressive"
              ? `Nerve is full. Commit a crime immediately.`
              : `Nerve is at ${nerveCurrent}/${nerveMaximum}.`;

          await sendIpcRequest("send-push", {
            title: alertType === "aggressive" ? "Nerve Full!" : "Nerve Alert",
            body: baseDescription,
            url: "https://www.torn.com/crimes.php",
          });

          settingsCache.updateAlertState({
            last_crime_alert_type: alertType,
            last_crime_alert_sent_at: nowIso,
          });
        }
      }
    }

    const duration = Date.now() - startTime;
    logger.success("Tick completed successfully", duration);
  } catch (error) {
    logger.error("Tick failed", error, Date.now() - startTime);
  }
}

export function startStateTicker(): void {
  startDbScheduledRunner({
    worker: WORKER_NAME,
    defaultCadenceSeconds: 30, // Tick state every 30 seconds
    pollIntervalMs: 5000,
    handler: async () => {
      return await executeSync({
        name: WORKER_NAME,
        timeout: 25000,
        handler: tickState,
      });
    },
  });
}
