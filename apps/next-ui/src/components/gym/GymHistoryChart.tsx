import React, { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";

export interface GymLedgerEntry {
  id: string;
  timestamp: number;
  stat_type: "strength" | "defense" | "speed" | "dexterity";
  trains: number;
  energy_used: number;
  stat_gained: number;
}

interface GymHistoryChartProps {
  data: GymLedgerEntry[];
  timeRange: "7d" | "30d" | "90d" | "all";
}

const chartConfig = {
  strength: {
    label: "Strength",
    color: "#22c55e", // green
  },
  defense: {
    label: "Defense",
    color: "#3b82f6", // blue
  },
  speed: {
    label: "Speed",
    color: "#eab308", // yellow
  },
  dexterity: {
    label: "Dexterity",
    color: "#ec4899", // pink
  },
} satisfies ChartConfig;

export function GymHistoryChart({ data, timeRange }: GymHistoryChartProps) {
  const [isMobile, setIsMobile] = useState(false);

  React.useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const chartData = useMemo(() => {
    // Determine the cutoff timestamp based on timeRange
    let cutoffDate = new Date(0);
    const now = new Date();
    if (timeRange === "7d") {
      cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (timeRange === "30d") {
      cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (timeRange === "90d") {
      cutoffDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    }

    const filteredData = data.filter((entry) => {
      const entryDate = new Date(entry.timestamp * 1000);
      return entryDate.getTime() > cutoffDate.getTime();
    });

    // Group by Day
    const grouped = filteredData.reduce((acc, entry) => {
      const d = new Date(entry.timestamp * 1000);
      const dateStr = d.toISOString().split("T")[0];
      if (!acc[dateStr]) {
        acc[dateStr] = {
          date: dateStr,
          strength: 0,
          defense: 0,
          speed: 0,
          dexterity: 0,
        };
      }
      if (
        entry.stat_type === "strength" ||
        entry.stat_type === "defense" ||
        entry.stat_type === "speed" ||
        entry.stat_type === "dexterity"
      ) {
        acc[dateStr][entry.stat_type] += entry.stat_gained;
      }
      return acc;
    }, {} as Record<string, { date: string; strength: number; defense: number; speed: number; dexterity: number }>);

    // Convert back to array and sort by date ascending
    const result = Object.values(grouped).sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    // Pad missing dates
    if (result.length > 0) {
      const paddedResult = [];
      const startDate = new Date(result[0].date);
      const endDate = new Date(result[result.length - 1].date);

      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split("T")[0];
        const existing = result.find(r => r.date === dateStr);
        if (existing) {
          paddedResult.push(existing);
        } else {
          paddedResult.push({
            date: dateStr,
            strength: 0,
            defense: 0,
            speed: 0,
            dexterity: 0,
          });
        }
      }
      return paddedResult;
    }

    return result;
  }, [data, timeRange]);

  const yAxisFormatter = (value: number) => {
    if (value >= 1_000_000_000) {
      return `${(value / 1_000_000_000).toFixed(1)}B`;
    }
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1)}M`;
    }
    if (value >= 1_000) {
      return `${(value / 1_000).toFixed(1)}K`;
    }
    return value.toString();
  };

  return (
    <Card>
      <CardHeader className="flex md:items-center items-end flex-col md:flex-row md:gap-2 gap-5 space-y-0 border-b py-5">
        <div className="grid flex-1 gap-1 text-center sm:text-left">
          <CardTitle>Gym Gains - Historical Area Chart</CardTitle>
          <CardDescription>
            Showing total stats gained in the selected time range
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer
          config={chartConfig}
          className="aspect-auto h-[350px] w-full"
        >
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="fillStrength" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-strength)"
                  stopOpacity={0.4}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-strength)"
                  stopOpacity={0.0}
                />
              </linearGradient>
              <linearGradient id="fillDefense" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-defense)"
                  stopOpacity={0.4}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-defense)"
                  stopOpacity={0.0}
                />
              </linearGradient>
              <linearGradient id="fillSpeed" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-speed)"
                  stopOpacity={0.4}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-speed)"
                  stopOpacity={0.0}
                />
              </linearGradient>
              <linearGradient id="fillDexterity" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-dexterity)"
                  stopOpacity={0.4}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-dexterity)"
                  stopOpacity={0.0}
                />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={(value) => {
                const date = new Date(value);
                return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
              }}
            />
            <YAxis
              hide={isMobile}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={yAxisFormatter}
              width={50}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => {
                    return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                  }}
                  indicator="dot"
                />
              }
            />
            <Area
              dataKey="strength"
              type="monotone"
              fill="url(#fillStrength)"
              stroke="var(--color-strength)"
              strokeWidth={2}
            />
            <Area
              dataKey="defense"
              type="monotone"
              fill="url(#fillDefense)"
              stroke="var(--color-defense)"
              strokeWidth={2}
            />
            <Area
              dataKey="speed"
              type="monotone"
              fill="url(#fillSpeed)"
              stroke="var(--color-speed)"
              strokeWidth={2}
            />
            <Area
              dataKey="dexterity"
              type="monotone"
              fill="url(#fillDexterity)"
              stroke="var(--color-dexterity)"
              strokeWidth={2}
            />
            <ChartLegend content={<ChartLegendContent />} />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
