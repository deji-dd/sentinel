"use client";

import React, { useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { GymStateData, calculateEfficiencyData, BuildType, StatType } from "@/lib/gym-math";
import { Dumbbell, Loader2 } from "lucide-react";

interface EfficiencyTableProps {
  state: GymStateData | null;
  onPreferenceChanged: () => void;
}

const buildTypeLabels: Record<BuildType, string> = {
  balanced: "Balanced",
  one_stat: "One Stat Focus",
  two_stats: "Two Stat Focus",
  hanks: "Hank's Ratio",
  baldrs: "Baldr's Ratio",
};

const statLabels: Record<StatType, string> = {
  strength: "Strength",
  defense: "Defense",
  speed: "Speed",
  dexterity: "Dexterity",
};

export function EfficiencyTable({ state, onPreferenceChanged }: EfficiencyTableProps) {
  const [buildType, setBuildType] = useState<BuildType>(state?.gym_build_preference?.build_type || "balanced");
  const [highStat, setHighStat] = useState<StatType>(state?.gym_build_preference?.high_stat || "strength");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async (newBuild: BuildType, newHigh: StatType) => {
    setIsSaving(true);
    setBuildType(newBuild);
    setHighStat(newHigh);

    try {
      await fetch("/api/gym/build-preference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          build_type: newBuild,
          high_stat: newHigh,
        }),
      });
      onPreferenceChanged();
    } catch (error) {
      console.error("Failed to save build preference", error);
    } finally {
      setIsSaving(false);
    }
  };
  const efficiencyData = useMemo(() => {
    if (!state || !state.battlestats) return [];
    return calculateEfficiencyData(state);
  }, [state]);

  if (!state || !state.battlestats) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-6 text-muted-foreground">
          No battlestats found. Train your stats to begin tracking efficiency.
        </CardContent>
      </Card>
    );
  }

  const bestStat = efficiencyData[0];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Stat Builder</CardTitle>
            <CardDescription>
              Select your target stat ratio to calculate the optimal stat to train.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 space-y-2">
              <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                Target Build Ratio
              </label>
              <Select
                value={buildType}
                onValueChange={(val) => handleSave(val as BuildType, highStat)}
                disabled={isSaving}
              >
                <SelectTrigger className="w-full">
                  <span>{buildTypeLabels[buildType] || "Select ratio"}</span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="balanced">Balanced</SelectItem>
                  <SelectItem value="hanks">Hank&apos;s Ratio</SelectItem>
                  <SelectItem value="baldrs">Baldr&apos;s Ratio</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {buildType !== "balanced" && (
              <div className="flex-1 space-y-2">
                <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                  High Stat
                </label>
                <Select
                  value={highStat}
                  onValueChange={(val) => handleSave(buildType, val as StatType)}
                  disabled={isSaving}
                >
                  <SelectTrigger className="w-full">
                    <span>{statLabels[highStat] || "Select high stat"}</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="strength">Strength</SelectItem>
                    <SelectItem value="defense">Defense</SelectItem>
                    <SelectItem value="speed">Speed</SelectItem>
                    <SelectItem value="dexterity">Dexterity</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {isSaving && (
              <div className="flex items-end pb-2">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </CardContent>
        </Card>

        <Alert className="bg-primary/5 border-primary/20 flex flex-col">

          <AlertTitle className="text-primary flex gap-2 font-bold">
            <Dumbbell className="size-4 text-primary" />
            Recommendation: Train {bestStat?.stat.charAt(0).toUpperCase() + bestStat?.stat.slice(1)}!
          </AlertTitle>
          <AlertDescription className="md:mt-7">
            Based on your current ratio deficit and gym perks, training{" "}
            <span className="font-semibold capitalize text-foreground">
              {bestStat?.stat}
            </span>{" "}
            at{" "}
            <span className="font-semibold text-foreground">
              {bestStat?.bestGym?.name}
            </span>{" "}
            provides the highest combined efficiency score.
          </AlertDescription>
        </Alert>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Efficiency & Target Ratio</CardTitle>
          <CardDescription>
            Calculated using your current perks, maximum happy, and highest unlocked gyms.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stat</TableHead>
                  <TableHead className="hidden md:table-cell">Best Gym</TableHead>
                  <TableHead>Efficiency (dS/E)</TableHead>
                  <TableHead className="w-[200px]">Ratio Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {efficiencyData.map((row) => (
                  <TableRow key={row.stat} className={row.stat === bestStat?.stat ? "bg-primary/10" : ""}>
                    <TableCell className="font-medium capitalize">{row.stat}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      {row.bestGym?.name || "None"}
                    </TableCell>
                    <TableCell>
                      {row.efficiency > 0
                        ? row.efficiency.toLocaleString(undefined, { maximumFractionDigits: 2 })
                        : "0"}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span>{row.currentPercentage.toFixed(1)}%</span>
                          <span className="text-muted-foreground">Target: {row.targetPercentage.toFixed(1)}%</span>
                        </div>
                        <Progress
                          value={(row.currentPercentage / row.targetPercentage) * 100}
                          className={`h-2 ${row.currentPercentage < row.targetPercentage ? "bg-red-500/20" : ""}`}
                        />
                        <div className="text-[10px] text-muted-foreground text-right">
                          {row.deficitPercentage > 0
                            ? `${row.deficitPercentage.toFixed(1)}% behind`
                            : `${Math.abs(row.deficitPercentage).toFixed(1)}% over`}
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
