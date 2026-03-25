/* eslint-disable no-useless-escape */
import { renderAssistUserscriptTemplate } from "./assist-userscript-template.js";

type AssistUserscriptOptions = {
  uuid: string;
  apiBaseUrl: string;
  eventAuthToken: string;
};

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function buildConnectMetadata(normalizedApiBaseUrl: string): string {
  const hosts = new Set<string>();

  try {
    const parsed = new URL(normalizedApiBaseUrl);
    hosts.add(parsed.host);
    hosts.add(parsed.hostname);

    // Tampermonkey can treat localhost and 127.0.0.1 differently.
    if (parsed.hostname === "127.0.0.1") {
      hosts.add("localhost");
    }

    if (parsed.hostname === "localhost") {
      hosts.add("127.0.0.1");
    }
  } catch {
    return "// @connect      *";
  }

  const values = Array.from(hosts).filter(Boolean);
  if (values.length === 0) {
    return "// @connect      *";
  }

  return values.map((value) => `// @connect      ${value}`).join("\n");
}

export function buildAssistUserscript({
  uuid,
  apiBaseUrl,
  eventAuthToken,
}: AssistUserscriptOptions): string {
  const normalizedApiBaseUrl = stripTrailingSlash(apiBaseUrl);
  const connectMetadata = buildConnectMetadata(normalizedApiBaseUrl);
  return renderAssistUserscriptTemplate({
    uuid,
    normalizedApiBaseUrl,
    eventAuthToken,
    connectMetadata,
  });
}
