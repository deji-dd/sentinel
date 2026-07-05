import { tornApi } from "../services/torn-client.js";
import { getSystemApiKey } from "../lib/api-keys.js";

async function main() {
  const apiKey = await getSystemApiKey("personal");
  console.log("Using API Key:", apiKey ? apiKey.substring(0, 5) + "..." : "none");

  try {
    const res = await tornApi.get("/user/log" as any, {
      apiKey,
      queryParams: {
        limit: "100",
        from: "1356998400", // Jan 1, 2013
      },
    }) as any;
    console.log("Log count returned:", res.log?.length);
    if (res.log && res.log.length > 0) {
      console.log("Newest:", res.log[0].timestamp, new Date(res.log[0].timestamp * 1000).toISOString());
      console.log("Oldest:", res.log[res.log.length - 1].timestamp, new Date(res.log[res.log.length - 1].timestamp * 1000).toISOString());
    }
  } catch (err) {
    console.error("Error fetching logs:", err);
  }
}

main();
