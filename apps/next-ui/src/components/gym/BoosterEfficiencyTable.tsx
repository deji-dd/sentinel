"use client";

import React, { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  GymStateData,
  calculateBoosterEfficiency,
  StatType,
  BoosterEfficiency,
} from "@/lib/gym-math";
import { GymLedgerEntry } from "./GymHistoryChart";

interface BoosterEfficiencyTableProps {
  gymState: GymStateData;
  historyData: GymLedgerEntry[];
}

const formatNumber = (num: number) => {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}m`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
  // Format to 1 decimal place if it has decimals, otherwise whole number
  return Number.isInteger(num) ? num.toString() : num.toFixed(1);
};

const formatCurrency = (num: number) => {
  return "$" + num.toLocaleString();
};

export function BoosterEfficiencyTable({ gymState, historyData }: BoosterEfficiencyTableProps) {
  const [sortBy, setSortBy] = useState<"time" | "cost" | "true_cost">("true_cost");

  const [now] = useState(() => Date.now() / 1000);
  const efficiencies = useMemo(() => {
    const data = calculateBoosterEfficiency(gymState);
    
    // 1. Calculate historical daily gain for each stat
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60);
    const recentHistory = historyData.filter(entry => entry.timestamp >= thirtyDaysAgo);
    
    const gainsByStat: Record<string, number> = { strength: 0, defense: 0, speed: 0, dexterity: 0 };
    recentHistory.forEach(entry => {
      const stat = entry.stat_type.toLowerCase();
      if (gainsByStat[stat] !== undefined) {
        gainsByStat[stat] += entry.stat_gained;
      }
    });

    // Determine the actual time span of the data we have, up to 30 days
    const oldestEntry = recentHistory.length > 0 ? recentHistory[0].timestamp : now;
    // Use the difference between now and the oldest entry, minimum 1 day to avoid Infinity
    const actualDaysPassed = Math.max(1, (now - oldestEntry) / (24 * 60 * 60));

    // 2. Calculate Personal Value of Time (PVT) for each stat
    const pvtByStat: Record<string, number> = { strength: 0, defense: 0, speed: 0, dexterity: 0 };
    
    // Create a new sorted copy based on the selected metric
    const sortedData = { ...data };
    
    Object.keys(sortedData).forEach((statKey) => {
      const stat = statKey as StatType;
      
      const dailyGain = gainsByStat[stat] / actualDaysPassed;
      if (dailyGain > 0) {
        // Find the SE for this stat to use as baseline
        const seItem = sortedData[stat].find(i => i.itemType === "stat_enhancer");
        if (seItem) {
          const daysSaved = seItem.statGain / dailyGain;
          const valuePerDay = seItem.marketPrice / daysSaved;
          pvtByStat[stat] = valuePerDay / 24; // PVT in dollars per hour of CD
        }
      }

      const pvtPerHour = pvtByStat[stat] || 0; // Fallback to 0 if no history
      
      const dataWithTrueCost = sortedData[stat].map(item => ({
        ...item,
        trueCostToTarget: item.costToTarget + (item.cdToTarget * pvtPerHour)
      }));

      sortedData[stat] = dataWithTrueCost.sort((a, b) => {
        if (sortBy === "true_cost") {
          return a.trueCostToTarget - b.trueCostToTarget;
        } else if (sortBy === "time") {
          return a.cdToTarget - b.cdToTarget; // Lowest CD hours first
        } else {
          return a.costToTarget - b.costToTarget; // Lowest Cost first
        }
      });
    });
    
    return {
      sortedData: sortedData as Record<StatType, (BoosterEfficiency & { trueCostToTarget: number })[]>,
      pvtByStat
    };
  }, [gymState, sortBy, historyData, now]);

  const { sortedData, pvtByStat } = efficiencies;

  const stats: { value: StatType; label: string }[] = [
    { value: "strength", label: "Strength" },
    { value: "defense", label: "Defense" },
    { value: "speed", label: "Speed" },
    { value: "dexterity", label: "Dexterity" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Booster Efficiency</CardTitle>
        <CardDescription>
          Find the most cost-effective items to boost your stats. Calculates
          efficiency based on your current stats, best gym, and perks.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="strength" className="w-full">
          {stats.map((stat) => (
            <TabsContent key={`pvt-${stat.value}`} value={stat.value} className="mt-0">
              {pvtByStat[stat.value] > 0 ? (
                <div className="mb-4 text-sm text-muted-foreground bg-primary/5 p-3 rounded-md border border-primary/20">
                  Based on your historical growth, an SE saves you enough time to price 1 hour of Booster CD at 
                  <span className="font-semibold text-primary ml-1">{formatCurrency(Math.floor(pvtByStat[stat.value]))}</span>.
                </div>
              ) : (
                <div className="mb-4 text-sm text-muted-foreground bg-muted p-3 rounded-md border">
                  Train this stat to establish a natural growth rate and unlock True Cost analysis.
                </div>
              )}
            </TabsContent>
          ))}

          <div className="flex items-center justify-between mb-4">
            <TabsList>
              {stats.map((stat) => (
                <TabsTrigger key={stat.value} value={stat.value}>
                  {stat.label}
                </TabsTrigger>
              ))}
            </TabsList>

            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Sort By:</span>
              <div className="flex bg-muted p-1 rounded-md overflow-x-auto whitespace-nowrap">
                <button
                  className={`px-3 py-1 rounded-sm transition-all ${
                    sortBy === "true_cost" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setSortBy("true_cost")}
                >
                  True Cost (Cost + PVT)
                </button>
                <button
                  className={`px-3 py-1 rounded-sm transition-all ${
                    sortBy === "cost" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setSortBy("cost")}
                >
                  Cost per 1% Gain
                </button>
                <button
                  className={`px-3 py-1 rounded-sm transition-all ${
                    sortBy === "time" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setSortBy("time")}
                >
                  CD per 1% Gain
                </button>
              </div>
            </div>
          </div>
          {stats.map((stat) => (
            <TabsContent key={stat.value} value={stat.value}>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Est. Gain</TableHead>
                      <TableHead className="text-right">Market Price</TableHead>
                      <TableHead className="text-right font-bold">Cost per 1%</TableHead>
                      <TableHead className="text-right font-bold">
                        CD per 1%
                      </TableHead>
                      <TableHead className="text-right font-bold text-primary">True Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedData[stat.value].map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">
                          {item.name}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatNumber(item.statGain)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(item.marketPrice)}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-primary/90">
                          {formatCurrency(Math.floor(item.costToTarget))}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {formatNumber(item.cdToTarget)}h
                        </TableCell>
                        <TableCell className="text-right font-bold text-primary">
                          {pvtByStat[stat.value] > 0 ? formatCurrency(Math.floor(item.trueCostToTarget)) : "N/A"}
                        </TableCell>
                      </TableRow>
                    ))}
                    {sortedData[stat.value].length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-4 text-muted-foreground">
                          No booster data available.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}
