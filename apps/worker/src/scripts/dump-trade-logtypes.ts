import { getSystemApiKey } from "../lib/api-keys.js";
import { tornApi } from "../services/torn-client.js";

async function main() {
  const apiKey = await getSystemApiKey("personal");
  if (!apiKey) {
    console.error("No personal API key found");
    return;
  }

  console.log("Fetching logtypes for cat 94...");
  const response = (await tornApi.get("/torn/logtypes", {
    apiKey,
  })) as any;

  const logtypes = response?.logtypes || {};
  console.log("Logtypes keys sample:", Object.keys(logtypes).slice(0, 5));
  console.log("Searching for trade in logtypes...");
  for (const [id, details] of Object.entries(logtypes)) {
    const d = details as any;
    const title = String(d.title || "").toLowerCase();
    const cat = String(d.category || "").toLowerCase();
    if (title.includes("trade") || cat.includes("trade") || id.startsWith("44")) {
      console.log(`- ${id}: ${d.title} (cat: ${d.category})`);
    }
  }
}

main().catch(console.error);
