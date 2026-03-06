type AssistUserscriptOptions = {
  uuid: string;
  apiBaseUrl: string;
};

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function buildAssistUserscript({
  uuid,
  apiBaseUrl,
}: AssistUserscriptOptions): string {
  const normalizedApiBaseUrl = stripTrailingSlash(apiBaseUrl);

  let connectHost = "*";
  try {
    connectHost = new URL(normalizedApiBaseUrl).host;
  } catch {
    connectHost = "*";
  }

  return `// ==UserScript==
// @name         Sentinel Combat Assist
// @namespace    https://sentinel.assist
// @version      2.0.0
// @description  Send assist alerts from Torn attack pages.
// @author       Sentinel
// @match        https://www.torn.com/loader.php?sid=attack*
// @grant        GM_xmlhttpRequest
// @connect      ${connectHost}
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  const ASSIST_UUID = ${JSON.stringify(uuid)};
  const API_URL = ${JSON.stringify(`${normalizedApiBaseUrl}/api/assist-events`)};
  const BUTTON_ID = "sentinel-assist-button";

  let buttonMounted = false;
  let lastAttackerCount = null;

  function getTargetId() {
    const params = new URLSearchParams(window.location.search);
    return params.get("user2ID");
  }

  function sendAssistEvent(method, payload) {
    GM_xmlhttpRequest({
      method,
      url: API_URL,
      headers: {
        "Content-Type": "application/json",
      },
      data: JSON.stringify({
        uuid: ASSIST_UUID,
        source: "tampermonkey",
        occurred_at: new Date().toISOString(),
        target_torn_id: Number.parseInt(getTargetId() || "0", 10) || undefined,
        ...payload,
      }),
      onerror: () => {
        // Keep failures silent for end users.
      },
    });
  }

  function injectButton() {
    if (buttonMounted || document.getElementById(BUTTON_ID)) {
      buttonMounted = true;
      return;
    }

    const topSection = document.querySelector('[class*="topSection"]');
    if (!topSection || !topSection.parentNode) {
      return;
    }

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.textContent = "Send Assist Alert";
    button.style.cssText = [
      "margin-top: 8px",
      "padding: 6px 10px",
      "font-size: 12px",
      "font-weight: 700",
      "color: #ffffff",
      "background: #c02626",
      "border: 1px solid #7f1d1d",
      "border-radius: 4px",
      "cursor: pointer",
    ].join(";");

    button.addEventListener("click", () => {
      sendAssistEvent("POST", {
        action: "manual_alert",
        result: "button_click",
      });
    });

    topSection.parentNode.insertBefore(button, topSection.nextSibling);
    buttonMounted = true;
  }

  function monitorAttackerCount() {
    const statsHeader = document.getElementById("stats-header");
    if (!statsHeader) {
      return;
    }

    const readCount = () => {
      const node = statsHeader.querySelector('[class*="titleNumber"]');
      if (!node) {
        return;
      }

      const current = Number.parseInt((node.textContent || "").trim(), 10);
      if (!Number.isFinite(current)) {
        return;
      }

      if (lastAttackerCount !== null && current !== lastAttackerCount) {
        sendAssistEvent("PATCH", {
          action: "attacker_count_changed",
          details:
            "Attacker count changed: " +
            String(lastAttackerCount) +
            " -> " +
            String(current),
          result: "count_changed",
        });
      }

      lastAttackerCount = current;
    };

    const observer = new MutationObserver(readCount);
    observer.observe(statsHeader, {
      subtree: true,
      childList: true,
      characterData: true,
    });

    readCount();
  }

  window.addEventListener("beforeunload", () => {
    sendAssistEvent("DELETE", {
      action: "session_end",
      result: "page_unload",
    });
  });

  const mountLoop = window.setInterval(() => {
    injectButton();
    if (buttonMounted) {
      window.clearInterval(mountLoop);
    }
  }, 400);

  if (document.readyState === "complete") {
    injectButton();
    monitorAttackerCount();
  } else {
    window.addEventListener("load", () => {
      injectButton();
      monitorAttackerCount();
    });
  }
})();
`;
}
