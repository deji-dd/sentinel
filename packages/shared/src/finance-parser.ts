export interface RawFinanceLog {
  log_id: string;
  timestamp: number;
  category: string;
  title: string;
  data: string; // JSON string
}

export interface ParsedTransaction {
  id: string;
  timestamp: number;
  type: "income" | "expense";
  category: string;
  title: string;
  amount: number;
  description: string;
}

export interface ParseFinanceLedgerResult {
  income: {
    stocks: number;
    bazaar: number;
    item_market: number;
    company: number;
    crimes: number;
    outbound_mugs: number;
    faction_withdrawals: number;
    trades: number;
    capital_gains: number;
    other: number;
    total: number;
  };
  expenses: {
    consumables: number;
    upkeep: number;
    loan_interest: number;
    inbound_mugs: number;
    rehab: number;
    trades: number;
    capital_gains: number;
    financing_fees: number;
    donations: number;
    other: number;
    total: number;
  };
  transactions: ParsedTransaction[];
}

function isItemOrLoanEvent(category: string, title: string): boolean {
  const catLower = category.toLowerCase();
  const titleLower = title.toLowerCase();

  if (catLower === "faction") {
    return (
      titleLower.includes("item") ||
      titleLower.includes("borrow") ||
      titleLower.includes("return") ||
      titleLower.includes("loan")
    );
  }

  return (
    catLower === "bazaars" ||
    catLower === "item market" ||
    catLower === "itemmarket" ||
    catLower === "shops" ||
    catLower === "trades" ||
    catLower === "loan" ||
    catLower === "points" ||
    catLower === "points market" ||
    catLower === "pointsmarket" ||
    catLower === "stocks" ||
    catLower === "stock" ||
    catLower.includes("item use") ||
    catLower === "drugs" ||
    catLower === "drug" ||
    titleLower.includes("bazaar") ||
    titleLower.includes("item market") ||
    titleLower.includes("loan") ||
    titleLower.includes("stock") ||
    titleLower.includes("points buy") ||
    titleLower.includes("points sell")
  );
}

export function parseFinanceLedger(
  dbLogs: RawFinanceLog[],
  itemMap: Map<number, { name: string; value: number }>,
  itemNameMap: Map<string, { item_id: number; name: string; value: number }>,
  pointPrice: number,
): ParseFinanceLedgerResult {
  const transactions: ParsedTransaction[] = [];
  const income = {
    stocks: 0,
    bazaar: 0,
    item_market: 0,
    company: 0,
    crimes: 0,
    outbound_mugs: 0,
    faction_withdrawals: 0,
    trades: 0,
    capital_gains: 0,
    other: 0,
    total: 0,
  };
  const expenses = {
    consumables: 0,
    upkeep: 0,
    loan_interest: 0,
    inbound_mugs: 0,
    rehab: 0,
    trades: 0,
    capital_gains: 0,
    financing_fees: 0,
    donations: 0,
    other: 0,
    total: 0,
  };

  for (const row of dbLogs) {
    const logId = row.log_id;
    const timestamp = Number(row.timestamp);
    const category = String(row.category || "").toLowerCase();
    const title = String(row.title || "").toLowerCase();
    let logData: any = {};
    try {
      logData = JSON.parse(row.data);
    } catch {}

    let amount = 0;
    let isIncome = false;
    let isExpense = false;
    let transactionCategory = "other";
    let description = row.title || "";

    const isProcessed = logData.processed_inventory === true;
    const hasSpecialPl = 
      logData.capital_gains_profit !== undefined ||
      logData.consumable_expense !== undefined ||
      logData.financing_fees_outflow !== undefined ||
      logData.donations_outflow !== undefined ||
      logData.is_loan_borrow === true ||
      logData.is_loan_repayment === true;

    if (isProcessed && (hasSpecialPl || isItemOrLoanEvent(category, title))) {
      if (logData.capital_gains_profit !== undefined && logData.capital_gains_profit !== 0) {
        amount = Math.abs(logData.capital_gains_profit);
        if (logData.capital_gains_profit > 0) {
          isIncome = true;
          transactionCategory = "capital_gains";
          description = `Capital Gains profit: ${logData.item_name || logData.type || "item"}`;
        } else {
          isExpense = true;
          transactionCategory = "capital_gains";
          description = `Capital Gains loss: ${logData.item_name || logData.type || "item"}`;
        }
      }
      else if (logData.consumable_expense !== undefined) {
        amount = logData.consumable_expense;
        isExpense = amount > 0;
        transactionCategory = "consumables";
        const itemId = Number(logData.item || logData.item_id || logData.id || 0);
        const qty = Number(logData.quantity || logData.qty || 1);
        const name = itemId && itemMap.has(itemId) ? itemMap.get(itemId)!.name : "consumable";
        description = `Used consumable: ${name} x${qty}`;

        // Handle supply pack / openable cash gains (inflow)
        if (logData.money && Number(logData.money) > 0) {
          const incAmt = Number(logData.money);
          income.other += incAmt;
          income.total += incAmt;
          transactions.push({
            id: `${logId}_inflow`,
            timestamp,
            type: "income",
            category: "other",
            title: row.title,
            amount: incAmt,
            description: `Opened ${name}: Gained $${incAmt.toLocaleString()}`,
          });
        }
      }
      else if (logData.financing_fees_outflow !== undefined && logData.financing_fees_outflow > 0) {
        amount = logData.financing_fees_outflow;
        isExpense = true;
        transactionCategory = "financing_fees";
        description = `Loan interest fee payment`;
      }
      else if (logData.donations_outflow !== undefined && logData.donations_outflow > 0) {
        amount = logData.donations_outflow;
        isExpense = true;
        transactionCategory = "donations";
        const itemId = Number(logData.item || logData.item_id || logData.id || 0);
        const qty = Number(logData.quantity || logData.qty || 1);
        const name = itemId && itemMap.has(itemId) ? itemMap.get(itemId)!.name : "items";
        description = `Donated items to faction: ${name} x${qty}`;
      }
      else {
        // Fallback for sales that didn't calculate capital gains (e.g. missing item details or points/stocks fallback)
        const isSaleEvent = title.includes("sell") || title.includes("sold") || title.includes("bought by") || title.includes("receive");
        if (isSaleEvent) {
          amount = Number(
            logData.cost_total ||
              logData.money_gained ||
              logData.money_received ||
              logData.total_price ||
              logData.price ||
              logData.money ||
              logData.total_value ||
              0,
          );
          if (amount > 0) {
            isIncome = true;
            transactionCategory = category === "bazaars" ? "bazaar" : (category.includes("market") ? "item_market" : (category === "stocks" || category === "stock" ? "stocks" : "other"));
            description = `Sale (Revenue fallback): ${logData.item_name || logData.type || "items"}`;
          }
        } else {
          isIncome = false;
          isExpense = false;
        }
      }
    } else {

    // A. Stocks
    if (
      category === "stocks" ||
      title.includes("stock") ||
      title.includes("dividend")
    ) {
      amount = Number(
        logData.money_gained ||
          logData.cash ||
          logData.money ||
          logData.payout ||
          logData.dividend ||
          0,
      );
      if (amount > 0) {
        isIncome = true;
        transactionCategory = "stocks";
        description = `Stock block payout: ${logData.stock_acronym || logData.stock || "dividend"}`;
      }
    }
    // B. Bazaar
    else if (category === "bazaars" || title.includes("bazaar")) {
      if (title.includes("sell")) {
        amount = Number(
          logData.cost_total ||
            logData.money_gained ||
            logData.money_received ||
            logData.total_price ||
            logData.price ||
            logData.money ||
            0,
        );
        if (amount > 0) {
          isIncome = true;
          transactionCategory = "bazaar";
          description = `Bazaar sale: ${logData.item_name || logData.type || "items"}`;
        }
      }
    }
    // C. Item Market
    else if (
      category === "item market" ||
      category === "itemmarket" ||
      title.includes("item market")
    ) {
      amount = Number(
        logData.cost_total ||
          logData.money_gained ||
          logData.money_received ||
          logData.total_price ||
          logData.price ||
          logData.money ||
          0,
      );
      if (amount > 0) {
        if (
          title.includes("sell") ||
          title.includes("sold") ||
          title.includes("bought by") ||
          title.includes("receive")
        ) {
          isIncome = true;
          transactionCategory = "item_market";
          description = `Item market sale: ${logData.item_name || logData.type || "item"}`;
        } else {
          // Do not count buy as immediate outflow, only when item use is triggered.
          isExpense = false;
        }
      }
    }
    // D. Company
    else if (category === "company" || title.includes("company")) {
      amount = Number(
        logData.money_gained ||
          logData.profit ||
          logData.income ||
          logData.funds ||
          logData.amount ||
          logData.wages ||
          logData.salary ||
          logData.payout ||
          logData.dividend ||
          logData.cash ||
          logData.money ||
          0,
      );
      if (amount > 0) {
        if (
          title.includes("profit") ||
          title.includes("income") ||
          title.includes("payout") ||
          title.includes("dividend") ||
          title.includes("funds added") ||
          title.includes("received")
        ) {
          isIncome = true;
          transactionCategory = "company";
          description = `Company income: ${row.title}`;
        } else if (
          title.includes("salary") ||
          title.includes("wage") ||
          title.includes("pay")
        ) {
          isIncome = true;
          transactionCategory = "company";
          description = `Company wages/salary`;
        } else if (
          title.includes("advertise") ||
          title.includes("ad budget") ||
          title.includes("bill")
        ) {
          isExpense = true;
          transactionCategory = "upkeep";
          description = `Company advertising bill`;
        }
      }
    }
    // E. Crimes
    else if (category === "crimes" || title.includes("crime")) {
      amount = Number(
        logData.money_gained || logData.money || logData.cash || 0,
      );
      if (amount > 0) {
        isIncome = true;
        transactionCategory = "crimes";
        description = `Crime success: ${logData.crime_action || "crime"}`;
      }
    }
    // F. Mugs
    else if (title.includes("mug") || title.includes("attack")) {
      if (
        title.includes("mugged by") ||
        title.includes("inbound") ||
        title.includes("lose money") ||
        title.includes("attack mugged")
      ) {
        amount = Number(
          logData.money_lost ||
            logData.money ||
            logData.cash ||
            logData.mugged_amount ||
            logData.money_mugged ||
            0,
        );
        if (amount > 0) {
          isExpense = true;
          transactionCategory = "inbound_mugs";
          description = `Mugged by ${logData.attacker_name || logData.attacker || "someone"}`;
        }
      } else if (
        title.includes("mug success") ||
        title.includes("mugged") ||
        title.includes("outbound") ||
        title.includes("attack mug")
      ) {
        amount = Number(
          logData.money_gained ||
            logData.money ||
            logData.cash ||
            logData.mugged_amount ||
            logData.money_mugged ||
            0,
        );
        if (amount > 0) {
          isIncome = true;
          transactionCategory = "outbound_mugs";
          description = `Mugged ${logData.defender_name || logData.defender || "target"}`;
        }
      }
    }
    // G. Faction
    else if (category === "faction" || title.includes("faction")) {
      if (
        title.includes("give money send") ||
        title.includes("give money to") ||
        title.includes("deposit item")
      ) {
        // Ignore faction give money send and item deposits to faction entirely
      } else {
        amount = Number(
          logData.money_deposited ||
            logData.money_given ||
            logData.money ||
            logData.amount ||
            logData.cash ||
            0,
        );
        if (amount > 0) {
          if (
            title.includes("receive") ||
            title.includes("withdraw") ||
            title.includes("payout")
          ) {
            isIncome = true;
            transactionCategory = "faction_withdrawals";
            description = `Faction funds received/withdrawn`;
          } else if (title.includes("deposit")) {
            isExpense = true;
            transactionCategory = "other";
            description = `Faction funds deposited`;
          }
        }
      }
    }
    // H. Upkeep
    else if (
      category === "upkeep" ||
      category === "property" ||
      title.includes("upkeep") ||
      title.includes("property pay")
    ) {
      amount = Number(
        logData.upkeep_paid ||
          logData.upkeep_due ||
          logData.upkeep ||
          logData.amount ||
          logData.cost ||
          logData.money ||
          0,
      );
      if (amount > 0) {
        isExpense = true;
        transactionCategory = "upkeep";
        description = `Property upkeep payment`;
      }
    }
    // I. Loan Interest
    else if (
      category === "loan" ||
      title.includes("loan") ||
      title.includes("interest")
    ) {
      amount = Number(
        logData.returned ||
          logData.fee_paid ||
          logData.interest ||
          logData.amount ||
          logData.cost ||
          logData.money ||
          0,
      );
      if (amount > 0) {
        isExpense = true;
        if (title.includes("fee") || title.includes("interest")) {
          transactionCategory = "loan_interest";
          description = `Loan fee/interest payment`;
        } else {
          transactionCategory = "other";
          description = `Loan payment/return`;
        }
      }
    }
    // J. Consumables
    else if (
      category === "drugs" ||
      category === "item use drug" ||
      category.includes("item use") ||
      title.includes("item use") ||
      title.includes("consume") ||
      title.includes("refill")
    ) {
      if (title.includes("point") || logData.points_used) {
        const pts = Number(logData.points_used || 30);
        amount = pts * pointPrice;
        isExpense = true;
        transactionCategory = "consumables";
        description = `Used points refill: ${pts} points`;
      } else {
        const itemId = Number(
          logData.item || logData.item_id || logData.id || 0,
        );
        const quantity = Number(logData.quantity || logData.qty || 1);
        let itemVal = 0;
        let itemName = "Consumable";

        if (logData.historical_item_value !== undefined) {
          itemVal = Number(logData.historical_item_value || 0);
          if (itemId && itemMap.has(itemId)) {
            itemName = itemMap.get(itemId)!.name;
          }
        } else if (itemId && itemMap.has(itemId)) {
          const itemInfo = itemMap.get(itemId)!;
          itemVal = itemInfo.value;
          itemName = itemInfo.name;
        } else {
          const match = title.match(/item use (\w+)/);
          if (match && itemNameMap.has(match[1])) {
            const itemInfo = itemNameMap.get(match[1])!;
            itemVal = itemInfo.value;
            itemName = itemInfo.name;
          }
        }

        const isFaction = logData.faction && Number(logData.faction) > 0;
        
        // 1. Calculate Outflow (Expense of the consumable item itself being consumed)
        if (itemVal > 0 && !isFaction) {
          const expAmt = itemVal * quantity;
          expenses.consumables += expAmt;
          expenses.total += expAmt;
          transactions.push({
            id: logId,
            timestamp,
            type: "expense",
            category: "consumables",
            title: row.title,
            amount: expAmt,
            description: `Used consumable: ${itemName} x${quantity}`,
          });
        }

        // 2. Calculate Inflow (Income of money gained from opening the consumable)
        if (logData.money && Number(logData.money) > 0) {
          const incAmt = Number(logData.money);
          
          if (incAmt > 0) {
            income.other += incAmt;
            income.total += incAmt;
            const incDesc = `Opened ${itemName}: Gained $${incAmt.toLocaleString()}`;
            transactions.push({
              id: `${logId}_inflow`,
              timestamp,
              type: "income",
              category: "other",
              title: row.title,
              amount: incAmt,
              description: incDesc,
            });
          }
        }
      }
    }
    // J2. Shop Sell
    else if (category === "shops" || title.includes("shop sell") || title.includes("item shop sell")) {
      amount = Number(logData.total_value || logData.total_price || logData.money || 0);
      if (amount > 0) {
        isIncome = true;
        transactionCategory = "other";
        const itemId = Number(logData.item || 0);
        const qty = Number(logData.quantity || 1);
        const itemName = itemId && itemMap.has(itemId) ? itemMap.get(itemId)!.name : "items";
        const areaStr = logData.area ? ` ${logData.area}` : "";
        description = `Sold items to shop${areaStr}: ${itemName} x${qty}`;
      }
    }
    // K. Rehab
    else if (
      (category === "travel" && title === "rehab") ||
      title.toLowerCase() === "rehab"
    ) {
      amount = Number(logData.cost || 0);
      if (amount > 0) {
        isExpense = true;
        transactionCategory = "rehab";
        description = `Rehab: cost $${amount.toLocaleString()}`;
      }
    }
    // L. Bounties
    else if (
      category === "bounties" ||
      category === "bounty" ||
      title.toLowerCase().includes("bounty")
    ) {
      const titleLow = title.toLowerCase();
      
      const isPlacement = titleLow.includes("place") || titleLow.includes("placed");
      const isListerClaim = titleLow.includes("lister") || titleLow.includes("claim");

      if (isPlacement) {
        // Ignore placement (pending, no transaction log pushed)
      } else if (isListerClaim) {
        amount = Number(
          logData.bounty_reward ||
            logData.money_lost ||
            logData.cost ||
            logData.money ||
            logData.reward ||
            0,
        );
        if (amount > 0) {
          if (titleLow.includes("lister")) {
            isExpense = true;
            transactionCategory = "other";
            description = `Paid bounty claim: ${logData.target_name || logData.target || "target"}`;
          } else {
            isIncome = true;
            transactionCategory = "other";
            description = `Collected bounty on: ${logData.target_name || logData.target || "target"}`;
          }
        }
      }
    }

    // M. Mission rewards - include mission reward logs as income when present
    else if (
      category === "missions" ||
      title.toLowerCase().includes("mission") ||
      title.toLowerCase().includes("mission reward") ||
      logData.mission_reward !== undefined
    ) {
      amount = Number(
        logData.money_gained ||
          logData.mission_reward ||
          logData.reward ||
          logData.cash ||
          logData.money ||
          0,
      );
      if (amount > 0) {
        isIncome = true;
        transactionCategory = "other";
        description = `Mission reward: ${logData.mission_name || logData.mission || row.title}`;
      }
    }

    // N. Trades
    else if (category === "trades" || title.includes("trade")) {
      if (title === "trade money outgoing") {
        amount = Number(logData.money || 0);
        if (amount > 0) {
          isExpense = true;
          transactionCategory = "trades";
          description = `Trade money outgoing (Trade #${logData.parsed_trade_id || logData.trade_id || ""})`;
        }
      } else if (title === "trade money incoming") {
        amount = Number(logData.money || 0);
        if (amount > 0) {
          isIncome = true;
          transactionCategory = "trades";
          description = `Trade money incoming (Trade #${logData.parsed_trade_id || logData.trade_id || ""})`;
        }
      } else if (title === "trade items incoming") {
        const itemsList = logData.items || [];
        let totalVal = 0;
        let itemNames: string[] = [];
        for (const item of itemsList) {
          const itemId = Number(item.id || 0);
          const qty = Number(item.qty || 0);
          if (itemId && qty > 0) {
            let val = 0;
            if (itemMap.has(itemId)) {
              const itemInfo = itemMap.get(itemId)!;
              val = itemInfo.value;
              itemNames.push(`${itemInfo.name} x${qty}`);
            } else {
              itemNames.push(`Item #${itemId} x${qty}`);
            }
            totalVal += val * qty;
          }
        }
        if (totalVal > 0) {
          amount = totalVal;
          isIncome = true;
          transactionCategory = "trades";
          description = `Trade items incoming: ${itemNames.slice(0, 3).join(", ")}${itemNames.length > 3 ? "..." : ""} (Trade #${logData.parsed_trade_id || logData.trade_id || ""})`;
        }
      } else if (title === "trade items outgoing") {
        const itemsList = logData.items || [];
        let totalVal = 0;
        let itemNames: string[] = [];
        for (const item of itemsList) {
          const itemId = Number(item.id || 0);
          const qty = Number(item.qty || 0);
          if (itemId && qty > 0) {
            let val = 0;
            if (itemMap.has(itemId)) {
              const itemInfo = itemMap.get(itemId)!;
              val = itemInfo.value;
              itemNames.push(`${itemInfo.name} x${qty}`);
            } else {
              itemNames.push(`Item #${itemId} x${qty}`);
            }
            totalVal += val * qty;
          }
        }
        if (totalVal > 0) {
          amount = totalVal;
          isExpense = true;
          transactionCategory = "trades";
          description = `Trade items outgoing: ${itemNames.slice(0, 3).join(", ")}${itemNames.length > 3 ? "..." : ""} (Trade #${logData.parsed_trade_id || logData.trade_id || ""})`;
        }
      }
    }
    // O. Money Transfers (User to User)
    else if (
      category === "money" ||
      title.includes("money send") ||
      title.includes("money receive") ||
      category.includes("money")
    ) {
      amount = Number(logData.money || logData.amount || logData.cash || 0);
      if (amount > 0) {
        if (title.includes("receive")) {
          isIncome = true;
          transactionCategory = "other";
          description = `Received money from ${logData.sender_name || logData.sender || "player"}`;
        } else if (title.includes("send")) {
          isExpense = true;
          transactionCategory = "other";
          description = `Sent money to ${logData.receiver_name || logData.receiver || "player"}`;
        }
      }
    }

    }

    if (isIncome && amount > 0) {
      income[transactionCategory as keyof typeof income] += amount;
      income.total += amount;
      transactions.push({
        id: logId,
        timestamp,
        type: "income",
        category: transactionCategory,
        title: row.title,
        amount,
        description,
      });
    } else if (isExpense && amount > 0) {
      expenses[transactionCategory as keyof typeof expenses] += amount;
      expenses.total += amount;
      transactions.push({
        id: logId,
        timestamp,
        type: "expense",
        category: transactionCategory,
        title: row.title,
        amount,
        description,
      });
    }
  }

  return { income, expenses, transactions };
}
