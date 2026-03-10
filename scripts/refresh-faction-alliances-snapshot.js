#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ALLIANCE_JSON_URL =
  "https://raw.githubusercontent.com/Marches0/torn-public/25b7cef36fd0949237b7ce2ee3fa53a9b7e5bc53/factions/alliances/factionAlliances.json";

const outputPath = path.join(
  __dirname,
  "..",
  "apps",
  "bot",
  "src",
  "data",
  "faction-alliances.snapshot.json",
);

function assertValidPayload(payload) {
  if (
    !payload ||
    typeof payload !== "object" ||
    !Array.isArray(payload.alliances)
  ) {
    throw new Error("Invalid payload: expected top-level `alliances` array");
  }
}

async function main() {
  console.log(`[alliances] Fetching snapshot from ${ALLIANCE_JSON_URL}`);

  const response = await fetch(ALLIANCE_JSON_URL, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch JSON: HTTP ${response.status}`);
  }

  const payload = await response.json();
  assertValidPayload(payload);

  const pretty = `${JSON.stringify(payload, null, 2)}\n`;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, pretty, "utf-8");

  console.log(
    `[alliances] Snapshot updated at apps/bot/src/data/faction-alliances.snapshot.json (${Buffer.byteLength(pretty)} bytes)`,
  );
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`[alliances] Failed to refresh snapshot: ${msg}`);
  process.exit(1);
});
