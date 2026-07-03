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
    other: number;
    total: number;
  };
  expenses: {
    consumables: number;
    upkeep: number;
    loan_interest: number;
    inbound_mugs: number;
    rehab: number;
    other: number;
    total: number;
  };
  transactions: ParsedTransaction[];
}

export function parseFinanceLedger(
  dbLogs: RawFinanceLog[],
  itemMap: Map<number, { name: string; value: number }>,
  itemNameMap: Map<string, { item_id: number; name: string; value: number }>,
  pointPrice: number
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
    other: 0,
    total: 0,
  };
  const expenses = {
    consumables: 0,
    upkeep: 0,
    loan_interest: 0,
    inbound_mugs: 0,
    rehab: 0,
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

    // A. Stocks
    if (category === "stocks" || title.includes("stock") || title.includes("dividend")) {
      amount = Number(logData.money_gained || logData.cash || logData.money || logData.payout || logData.dividend || 0);
      if (amount > 0) {
        isIncome = true;
        transactionCategory = "stocks";
        description = `Stock block payout: ${logData.stock_acronym || logData.stock || "dividend"}`;
      }
    }
    // B. Bazaar
    else if (category === "bazaars" || title.includes("bazaar")) {
      amount = Number(logData.money_gained || logData.money_received || logData.total_price || logData.price || logData.money || 0);
      if (amount > 0) {
        isIncome = true;
        transactionCategory = "bazaar";
        description = `Bazaar sale: ${logData.item_name || logData.type || "items"}`;
      }
    }
    // C. Item Market
    else if (category === "item market" || category === "itemmarket" || title.includes("item market")) {
      amount = Number(logData.cost_total || logData.money_gained || logData.money_received || logData.total_price || logData.price || logData.money || 0);
      if (amount > 0) {
        if (title.includes("sell") || title.includes("sold") || title.includes("bought by") || title.includes("receive")) {
          isIncome = true;
          transactionCategory = "item_market";
          description = `Item market sale: ${logData.item_name || logData.type || "item"}`;
        } else {
          isExpense = true;
          transactionCategory = "consumables";
          description = `Bought from Item Market: ${logData.item_name || logData.type || "item"}`;
        }
      }
    }
    // D. Company
    else if (category === "company" || title.includes("company")) {
      amount = Number(logData.wages || logData.salary || logData.profit || logData.payout || logData.dividend || logData.cash || logData.money || 0);
      if (amount > 0) {
        if (title.includes("profit") || title.includes("payout") || title.includes("dividend")) {
          isIncome = true;
          transactionCategory = "company";
          description = `Company profit payout`;
        } else if (title.includes("salary") || title.includes("wage") || title.includes("pay")) {
          isIncome = true;
          transactionCategory = "company";
          description = `Company pay / salary`;
        }
      }
    }
    // E. Crimes
    else if (category === "crimes" || title.includes("crime")) {
      amount = Number(logData.money_gained || logData.money || logData.cash || 0);
      if (amount > 0) {
        isIncome = true;
        transactionCategory = "crimes";
        description = `Crime success: ${logData.crime_action || "crime"}`;
      }
    }
    // F. Mugs
    else if (title.includes("mug") || title.includes("attack")) {
      if (title.includes("mugged by") || title.includes("inbound") || title.includes("lose money")) {
        amount = Number(logData.money_lost || logData.money || logData.cash || logData.mugged_amount || 0);
        if (amount > 0) {
          isExpense = true;
          transactionCategory = "inbound_mugs";
          description = `Mugged by ${logData.attacker_name || logData.attacker || "someone"}`;
        }
      } else if (title.includes("mug success") || title.includes("mugged") || title.includes("outbound")) {
        amount = Number(logData.money_gained || logData.money || logData.cash || logData.mugged_amount || logData.money_mugged || 0);
        if (amount > 0) {
          isIncome = true;
          transactionCategory = "outbound_mugs";
          description = `Mugged ${logData.defender_name || logData.defender || "target"}`;
        }
      }
    }
    // G. Faction
    else if (category === "faction" || title.includes("faction")) {
      amount = Number(logData.money_given || logData.money || logData.amount || logData.cash || 0);
      if (amount > 0) {
        if (title.includes("receive") || title.includes("withdraw") || title.includes("payout")) {
          isIncome = true;
          transactionCategory = "faction_withdrawals";
          description = `Faction funds received/withdrawn`;
        } else if (title.includes("send") || title.includes("deposit")) {
          isExpense = true;
          transactionCategory = "other";
          description = `Faction funds sent/deposited`;
        }
      }
    }
    // H. Upkeep
    else if (category === "upkeep" || title.includes("upkeep") || title.includes("property pay")) {
      amount = Number(logData.upkeep || logData.amount || logData.cost || logData.money || 0);
      if (amount > 0) {
        isExpense = true;
        transactionCategory = "upkeep";
        description = `Property upkeep payment`;
      }
    }
    // I. Loan Interest
    else if (category === "loan" || title.includes("loan") || title.includes("interest")) {
      amount = Number(logData.returned || logData.fee_paid || logData.interest || logData.amount || logData.cost || logData.money || 0);
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
        const itemId = Number(logData.item || logData.item_id || logData.id || 0);
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
        if (itemVal > 0) {
          amount = itemVal * quantity;
          if (isFaction) {
            description = `Used faction consumable: ${itemName} x${quantity} (Armoury)`;
            transactions.push({
              id: logId,
              timestamp,
              type: "expense",
              category: "faction_consumable",
              title: row.title,
              amount,
              description,
            });
          } else {
            isExpense = true;
            transactionCategory = "consumables";
            description = `Used consumable: ${itemName} x${quantity}`;
          }
        }
      }
    }
    // K. Rehab
    else if (category === "travel" && title === "rehab" || title.toLowerCase() === "rehab") {
      amount = Number(logData.cost || 0);
      if (amount > 0) {
        isExpense = true;
        transactionCategory = "rehab";
        description = `Rehab: cost $${amount.toLocaleString()}`;
      }
    }
    // L. Bounties
    else if (category === "bounties" || category === "bounty" || title.toLowerCase().includes("bounty")) {
      const titleLow = title.toLowerCase();
      // "lister" = user placed the bounty, someone else claimed it → EXPENSE (payout from user's vault)
      // "place"/"paid"/"put" in title, or bounty_amount/cost field → EXPENSE
      const isPlacement = titleLow.includes("lister") || titleLow.includes("place") || titleLow.includes("paid") ||
                          titleLow.includes("put") || logData.bounty_amount !== undefined || logData.cost !== undefined;
      // "claim"/"collect" WITHOUT lister → user collected bounty money → INCOME
      const isClaim = !isPlacement && (titleLow.includes("claim") || titleLow.includes("collect") || logData.bounty_reward !== undefined);

      if (isPlacement) {
        amount = Number(logData.bounty_amount || logData.bounty_reward || logData.cost || logData.amount || logData.money || 0);
        if (amount > 0) {
          isExpense = true;
          transactionCategory = "other";
          description = `Bounty paid out on: ${logData.target_name || logData.target || "target"}`;
        }
      } else if (isClaim) {
        amount = Number(logData.bounty_reward || logData.money_gained || logData.reward || logData.money || 0);
        if (amount > 0) {
          isIncome = true;
          transactionCategory = "other";
          description = `Collected bounty on: ${logData.target_name || logData.target || "target"}`;
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
