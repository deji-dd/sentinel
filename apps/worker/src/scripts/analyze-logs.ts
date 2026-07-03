/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fs from "fs";
import * as path from "path";

function main() {
  const jsonPath = path.resolve("./src/scripts/recent-logs.json");
  if (!fs.existsSync(jsonPath)) {
    console.error("No recent-logs.json found");
    return;
  }

  const logsObj = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  const logs = Object.values(logsObj) as any[];

  console.log(`Analyzing ${logs.length} logs...`);
  const analysis: Record<string, { count: number; sampleDataKeys: string[]; sampleData: any }> = {};

  for (const log of logs) {
    const key = `${log.category} -> ${log.title}`;
    if (!analysis[key]) {
      analysis[key] = {
        count: 0,
        sampleDataKeys: Object.keys(log.data || {}),
        sampleData: log.data,
      };
    }
    analysis[key].count++;
  }

  console.log(JSON.stringify(analysis, null, 2));
}

main();
