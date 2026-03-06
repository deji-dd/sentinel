type AssistUserscriptOptions = {
  uuid: string;
  apiBaseUrl: string;
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
}: AssistUserscriptOptions): string {
  const normalizedApiBaseUrl = stripTrailingSlash(apiBaseUrl);
  const connectMetadata = buildConnectMetadata(normalizedApiBaseUrl);

  return `// ==UserScript==
// @name         Sentinel Assist
// @namespace    https://sentinel.assist
// @version      2.0.0
// @description  Send assist alerts from Torn attack pages.
// @author       Blasted [1934909]
// @match        https://www.torn.com/loader.php?sid=attack*
// @grant        GM_xmlhttpRequest
${connectMetadata}
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  const ASSIST_UUID = ${JSON.stringify(uuid)};
  const API_URL = ${JSON.stringify(`${normalizedApiBaseUrl}/api/assist-events`)};
  const BUTTON_ID = "sentinel-assist-button";
  const TOAST_ID = "sentinel-assist-toast";

  let buttonMounted = false;
  let lastAttackerCount = null;

  function showToast(message, isSuccess = true) {
    const existing = document.getElementById(TOAST_ID);
    if (existing) {
      existing.remove();
    }

    const toast = document.createElement("div");
    toast.id = TOAST_ID;
    toast.textContent = message;
    toast.style.cssText = [
      "position: fixed",
      "top: 20px",
      "right: 20px",
      "z-index: 999999",
      "max-width: 320px",
      "padding: 10px 14px",
      "border-radius: 8px",
      "color: #ffffff",
      "font-size: 12px",
      "font-weight: 600",
      'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      "box-shadow: 0 4px 12px rgba(0,0,0,0.25)",
      isSuccess
        ? "background: linear-gradient(135deg, #06d6a0 0%, #00b894 100%)"
        : "background: linear-gradient(135deg, #e63946 0%, #d62828 100%)",
      "opacity: 0",
      "transform: translateX(16px)",
      "transition: opacity 0.2s ease, transform 0.2s ease",
    ].join(";");

    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translateX(0)";
    });

    window.setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(16px)";
      window.setTimeout(() => {
        toast.remove();
      }, 220);
    }, 2200);
  }

  function getTargetId() {
    const params = new URLSearchParams(window.location.search);
    return params.get("user2ID");
  }

  function sendAssistEvent(method, payload, options) {
    const notify = options?.notify === true;

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
      onload: (response) => {
        if (!notify) {
          return;
        }

        if (response.status >= 200 && response.status < 300) {
          showToast("Assist alert sent", true);
          return;
        }

        if (response.status === 429) {
          showToast("Rate limited. Try again in a few seconds", false);
          return;
        }

        showToast(
          "Failed to send assist alert (" + String(response.status) + ")",
          false,
        );
      },
      onerror: () => {
        if (notify) {
          showToast("Network error while sending assist alert", false);
        }
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

    const buttonContainer = document.createElement("div");
    buttonContainer.style.cssText = [
      "margin-top: 8px",
      "padding: 0",
      "text-align: right",
    ].join(";");

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.textContent = "Yabba Dabba Doo!";
    button.style.cssText = [
      "background: linear-gradient(135deg, #4a90e2 0%, #357abd 100%)",
      "color: #ffffff",
      "font-size: 11px",
      "font-weight: 600",
      "padding: 5px 10px",
      "border: 1px solid rgba(53, 122, 189, 0.4)",
      "border-radius: 4px",
      "cursor: pointer",
      "box-shadow: 0 1px 2px rgba(0,0,0,0.1)",
      "transition: all 0.2s ease",
      "text-transform: uppercase",
      "letter-spacing: 0.3px",
      'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      "display: inline-flex",
      "align-items: center",
      "justify-content: center",
      "-webkit-tap-highlight-color: transparent",
      "user-select: none",
    ].join(";");

    button.onmouseover = () => {
      button.style.background =
        "linear-gradient(135deg, #357abd 0%, #2a5f8f 100%)";
      button.style.transform = "translateY(-1px)";
      button.style.boxShadow = "0 2px 4px rgba(0,0,0,0.15)";
    };

    button.onmouseout = () => {
      button.style.background =
        "linear-gradient(135deg, #4a90e2 0%, #357abd 100%)";
      button.style.transform = "translateY(0)";
      button.style.boxShadow = "0 1px 2px rgba(0,0,0,0.1)";
    };

    button.ontouchstart = () => {
      button.style.background =
        "linear-gradient(135deg, #2a5f8f 0%, #1e4a6f 100%)";
      button.style.transform = "scale(0.98)";
    };

    button.ontouchend = () => {
      button.style.background =
        "linear-gradient(135deg, #4a90e2 0%, #357abd 100%)";
      button.style.transform = "scale(1)";
    };

    button.addEventListener("click", () => {
      sendAssistEvent("POST", {
        action: "manual_alert",
        result: "button_click",
      }, {
        notify: true,
      });
    });

    buttonContainer.appendChild(button);
    topSection.parentNode.insertBefore(buttonContainer, topSection.nextSibling);
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
