/* eslint-disable no-useless-escape */
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

  return `// ==UserScript==
// @name         Sentinel Assist
// @namespace    https://sentinel.assist
// @version      2.7.4
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
  const ASSIST_EVENT_AUTH_TOKEN = ${JSON.stringify(eventAuthToken)};
  const API_URL = ${JSON.stringify(`${normalizedApiBaseUrl}/api/assist-events`)};
  const BUTTON_ID = "sentinel-assist-button";
  const TOAST_ID = "sentinel-assist-toast";
  const COOLDOWN_STORAGE_KEY = "sentinel_assist_cooldown_until_" + ASSIST_UUID;
  const ACTIVE_SESSION_STORAGE_KEY = "sentinel_assist_active_until_" + ASSIST_UUID;
  const DEFAULT_COOLDOWN_MS = 30000;
  const ASSIST_UNAVAILABLE_COOLDOWN_MS = 2 * 60 * 1000;
  const ACTIVE_SESSION_WINDOW_MS = 5 * 60 * 1000;
  const LOG_PREFIX = "[Sentinel Assist]";

  let buttonMounted = false;
  let lastAttackerCount = null;
  let assistButtonEl = null;
  let cooldownInterval = null;
  let cooldownUntil = 0;
  let assistRequestInFlight = false;
  let assistSessionActiveUntil = 0;
  let lastFightStatus = null;
  let lastAttackerSnapshot = null;
  let lastHealthSnapshot = null;
  let mountTargetMissingLogged = false;

  function logInfo(...args) {
    console.log(LOG_PREFIX, ...args);
  }

  function logWarn(...args) {
    console.warn(LOG_PREFIX, ...args);
  }

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

  function toSentenceCase(value) {
    const compact = String(value || "").replace(/\s+/g, " ").trim();
    if (!compact) {
      return null;
    }

    const lower = compact.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }

  function detectFightOutcomeStatus() {
    const actionButtons = Array.from(
      document.querySelectorAll(
        '[class*="dialogWrapper"] [class*="dialogButtons"] button[type="submit"]',
      ),
    )
      .map((node) => (node.textContent || "").trim().toLowerCase())
      .filter(Boolean);

    if (
      actionButtons.includes("leave") &&
      actionButtons.includes("mug") &&
      actionButtons.includes("hospitalize")
    ) {
      return "Target is down";
    }

    const dialogText = toSentenceCase(
      document.querySelector('[class*="dialogWrapper"]')?.textContent || "",
    );

    if (!dialogText) {
      return null;
    }

    const compact = dialogText.replace(/\s+/g, " ").trim();

    const extract = (pattern) => {
      const match = compact.match(pattern);
      if (!match) {
        return null;
      }

      const phrase = (match[0] || "").replace(/\s+/g, " ").trim();
      return phrase || null;
    };

    const orderedPatterns = [
      /you defeated .+?(?=[.!?]|$)/i,
      /you mugged .+?(?=[.!?]|$)/i,
      /you hospitalized .+?(?=[.!?]|$)/i,
      /you arrested .+?(?=[.!?]|$)/i,
      /you stalemated(?=[.!?]|$)/i,
      /you lost(?=[.!?]|$)/i,
      /.+? took down your opponent/i,
      /.+? was defeated by .+?(?=[.!?]|$)/i,
      /.+? was sent to hospital/i,
      /.+? was surrounded by police/i,
    ];

    for (const pattern of orderedPatterns) {
      const phrase = extract(pattern);
      if (phrase) {
        return phrase;
      }
    }

    return null;
  }

  function detectFightState() {
    const outcomeStatus = detectFightOutcomeStatus();
    if (outcomeStatus) {
      return outcomeStatus;
    }

    const startButton = document.querySelector(
      '[class*="dialogWrapper"] [class*="dialogButtons"] button[type="submit"]',
    );

    if (startButton) {
      const buttonText = (startButton.textContent || "").trim().toLowerCase();
      if (buttonText.includes("start fight")) {
        return "Not Started";
      }
    }

    return "Ongoing";
  }

  function normalizeFightStatus(fightStatus) {
    if (!fightStatus || typeof fightStatus !== "string") {
      return "Unknown";
    }

    const lower = fightStatus.toLowerCase();

    if (
      lower.includes("target is down") ||
      lower.includes("you defeated") ||
      lower.includes("you mugged") ||
      lower.includes("you hospitalized") ||
      lower.includes("you arrested")
    ) {
      return "Target is down";
    }

    if (lower.includes("you stalemated")) {
      return "Requester stalemated";
    }

    if (lower.includes("you lost")) {
      return "Requester is down";
    }

    if (lower.includes("took down your opponent")) {
      return "Third party defeated target";
    }

    if (lower.includes("was defeated by")) {
      return "Third party defeated target";
    }

    if (lower.includes("was sent to hospital")) {
      return "Third party hospitalized target";
    }

    if (lower.includes("was surrounded by police")) {
      return "Third party arrested target";
    }

    return "Fight ended";
  }

  function parseIntText(value) {
    const cleaned = String(value || "").replace(/[^0-9-]/g, "");
    const parsed = Number.parseInt(cleaned, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function readEnemyHealth() {
    const enemyHeader = document.querySelector('[class*="headerWrapper"][class*="rose"]');
    if (!enemyHeader) {
      return null;
    }

    const healthValueNode = enemyHeader.querySelector(
      '[class*="entry"] [class*="iconHealth"] + span',
    );
    const healthText = (healthValueNode?.textContent || "").trim();
    let match = healthText.match(/([\\d,]+)\\s*\\/\\s*([\\d,]+)/);
    if (!match) {
      // Mobile layouts sometimes expose health as "Health X of Y" via aria-live summary text.
      const summaryNode = enemyHeader.querySelector('[id$="-summary"]');
      const summaryText = (summaryNode?.textContent || "").trim();
      match = summaryText.match(/health\\s+([\\d,]+)\\s+(?:of|\\/)\\s+([\\d,]+)/i);
    }

    if (!match) {
      return null;
    }

    const current = parseIntText(match[1]);
    const max = parseIntText(match[2]);
    if (!Number.isFinite(current) || !Number.isFinite(max) || !max || max <= 0) {
      return null;
    }

    const percent = Math.max(0, Math.min(100, (current / max) * 100));
    return {
      current,
      max,
      percent,
    };
  }

  function setButtonState(disabled, label) {
    if (!assistButtonEl) {
      return;
    }

    assistButtonEl.disabled = disabled;
    assistButtonEl.textContent = label;
    assistButtonEl.style.opacity = disabled ? "0.7" : "1";
    assistButtonEl.style.cursor = disabled ? "not-allowed" : "pointer";
    assistButtonEl.style.filter = disabled ? "grayscale(0.15)" : "none";
  }

  function formatRemainingSeconds(msRemaining) {
    return Math.max(1, Math.ceil(msRemaining / 1000));
  }

  function clearCooldownInterval() {
    if (cooldownInterval !== null) {
      window.clearInterval(cooldownInterval);
      cooldownInterval = null;
    }
  }

  function setCooldownUntil(nextCooldownUntil) {
    cooldownUntil = Math.max(cooldownUntil, nextCooldownUntil);

    try {
      window.localStorage.setItem(COOLDOWN_STORAGE_KEY, String(cooldownUntil));
    } catch {
    }

    clearCooldownInterval();

    const renderCooldownState = () => {
      const remaining = cooldownUntil - Date.now();
      if (remaining <= 0) {
        cooldownUntil = 0;
        clearCooldownInterval();
        setButtonState(false, "Yabba Dabba Doo!");
        try {
          window.localStorage.removeItem(COOLDOWN_STORAGE_KEY);
        } catch {
          // Ignore storage errors.
        }
        return;
      }

      setButtonState(true, "Wait " + String(formatRemainingSeconds(remaining)) + "s");
    };

    renderCooldownState();
    cooldownInterval = window.setInterval(renderCooldownState, 500);
  }

  function loadPersistedCooldown() {
    try {
      const raw = window.localStorage.getItem(COOLDOWN_STORAGE_KEY);
      if (!raw) {
        return;
      }

      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed > Date.now()) {
        setCooldownUntil(parsed);
      } else {
        window.localStorage.removeItem(COOLDOWN_STORAGE_KEY);
      }
    } catch {
    }
  }

  function setActiveAssistSessionUntil(nextActiveUntil) {
    assistSessionActiveUntil = Math.max(assistSessionActiveUntil, nextActiveUntil);
    try {
      window.localStorage.setItem(
        ACTIVE_SESSION_STORAGE_KEY,
        String(assistSessionActiveUntil),
      );
    } catch {
    }
  }

  function clearActiveAssistSession() {
    assistSessionActiveUntil = 0;
    try {
      window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
    } catch {
    }
  }

  function hasActiveAssistSession() {
    if (assistSessionActiveUntil <= Date.now()) {
      if (assistSessionActiveUntil !== 0) {
        clearActiveAssistSession();
      }
      return false;
    }

    return true;
  }

  function loadPersistedActiveAssistSession() {
    try {
      const raw = window.localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
      if (!raw) {
        return;
      }

      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed > Date.now()) {
        assistSessionActiveUntil = parsed;
      } else {
        window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
      }
    } catch {
    }
  }

  function getFriendlyAssistErrorMessage(response) {
    if (response.status === 0) {
      return "Could not reach Assist service. Check your internet connection and try again.";
    }

    if (response.status === 412) {
      return "Assist is not set up for this server yet. Ask a server admin to configure Assist in Discord.";
    }

    if (response.status === 429 || response.status === 409) {
      const retryAfter = Number.parseInt(
        String(response.body?.retry_after_seconds || "0"),
        10,
      );

      if (Number.isFinite(retryAfter) && retryAfter > 0) {
        return "Please wait " + String(retryAfter) + "s before sending another assist alert.";
      }

      return "Please wait a few seconds before sending another assist alert.";
    }

    if (response.status === 401 || response.status === 403) {
      return "Your Assist link is no longer valid. Reinstall the userscript from Discord.";
    }

    const serverMessage =
      typeof response.body?.error === "string" ? response.body.error : "";
    if (serverMessage) {
      return serverMessage;
    }

    return "Could not send Assist alert (HTTP " + String(response.status) + "). Please try again.";
  }

  function sendAssistEvent(method, payload) {
    const detectedFightStatus = detectFightState();

    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method,
        url: API_URL,
        headers: {
          "Content-Type": "application/json",
        },
        data: JSON.stringify({
          uuid: ASSIST_UUID,
          auth_token: ASSIST_EVENT_AUTH_TOKEN,
          source: "tampermonkey",
          occurred_at: new Date().toISOString(),
          fight_status: detectedFightStatus,
          target_torn_id: Number.parseInt(getTargetId() || "0", 10) || undefined,
          ...payload,
        }),
        onload: (response) => {
          let body = null;
          try {
            body = response.responseText ? JSON.parse(response.responseText) : null;
          } catch {
            body = null;
          }

          resolve({
            ok: response.status >= 200 && response.status < 300,
            status: response.status,
            body,
          });
        },
        onerror: () => {
          logWarn("Request failed before receiving a response", method);
          resolve({
            ok: false,
            status: 0,
            body: null,
          });
        },
      });
    });
  }

  function injectButton() {
    if (buttonMounted || document.getElementById(BUTTON_ID)) {
      buttonMounted = true;
      return;
    }

    const topSection = document.querySelector('[class*="topSection"]');
    if (!topSection || !topSection.parentNode) {
      if (!mountTargetMissingLogged) {
        mountTargetMissingLogged = true;
        logWarn("Mount target not ready yet; waiting for topSection node.");
      }
      return;
    }

    mountTargetMissingLogged = false;

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

    assistButtonEl = button;
    loadPersistedCooldown();
    loadPersistedActiveAssistSession();

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

    button.addEventListener("click", async () => {
      if (assistRequestInFlight || Date.now() < cooldownUntil) {
        return;
      }

      assistRequestInFlight = true;
      setButtonState(true, "Sending...");

      const response = await sendAssistEvent("POST", {
        action: "manual_alert",
        result: "button_click",
      });

      if (response.ok) {
        logInfo("Assist alert sent successfully");
        showToast("Assist alert sent", true);
        setActiveAssistSessionUntil(Date.now() + ACTIVE_SESSION_WINDOW_MS);
        lastFightStatus = detectFightState();
        setCooldownUntil(Date.now() + DEFAULT_COOLDOWN_MS);
      } else if (response.status === 429 || response.status === 409) {
        const retryAfter = Number.parseInt(
          String(response.body?.retry_after_seconds || "0"),
          10,
        );
        const cooldownMs =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : DEFAULT_COOLDOWN_MS;
        setCooldownUntil(Date.now() + cooldownMs);
        showToast(getFriendlyAssistErrorMessage(response), false);
      } else if (response.status === 412) {
        setCooldownUntil(Date.now() + ASSIST_UNAVAILABLE_COOLDOWN_MS);
        showToast(getFriendlyAssistErrorMessage(response), false);
      } else if (response.status === 0) {
        showToast(getFriendlyAssistErrorMessage(response), false);
        setButtonState(false, "Yabba Dabba Doo!");
      } else {
        showToast(getFriendlyAssistErrorMessage(response), false);
        setButtonState(false, "Yabba Dabba Doo!");
      }

      assistRequestInFlight = false;
    });

    buttonContainer.appendChild(button);
    topSection.parentNode.insertBefore(buttonContainer, topSection.nextSibling);
    buttonMounted = true;
  }

  function monitorAttackerCount() {
    const notifyAttackerPatch = (payload) => {
      if (!hasActiveAssistSession()) {
        return;
      }

      sendAssistEvent("PATCH", payload).then((response) => {
        if (response.status === 404 || response.status === 410) {
          clearActiveAssistSession();
        }
      });
    };

    const readCountFrom = (statsHeader) => {
      const node = statsHeader.querySelector('[class*="titleNumber"]');
      if (!node) {
        if (lastAttackerSnapshot !== "unavailable") {
          lastAttackerSnapshot = "unavailable";
          notifyAttackerPatch({
            action: "attacker_count_unavailable",
            attacker_count_state: "mobile_unavailable",
            details: "Attacker count unavailable",
            result: "count_unavailable",
          });
        }
        return;
      }

      const current = Number.parseInt((node.textContent || "").trim(), 10);
      if (!Number.isFinite(current)) {
        if (lastAttackerSnapshot !== "unavailable") {
          lastAttackerSnapshot = "unavailable";
          notifyAttackerPatch({
            action: "attacker_count_unavailable",
            attacker_count_state: "mobile_unavailable",
            details: "Attacker count unavailable",
            result: "count_unavailable",
          });
        }
        return;
      }

      const currentSnapshot = "count:" + String(current);
      if (lastAttackerSnapshot !== null && currentSnapshot !== lastAttackerSnapshot) {
        const previousValue =
          lastAttackerSnapshot === "unavailable"
            ? "unavailable"
            : String(lastAttackerCount);

        notifyAttackerPatch({
          action: "attacker_count_changed",
          attacker_count: current,
          attacker_count_state: "available",
          details:
            "Attacker count changed: " +
            previousValue +
            " -> " +
            String(current),
          result: "count_changed",
        });
      }

      lastAttackerCount = current;
      lastAttackerSnapshot = currentSnapshot;
    };

    let attackerObserverAttached = false;

    const tryAttach = () => {
      const statsHeader = document.getElementById("stats-header");
      if (!statsHeader) {
        return;
      }

      if (!attackerObserverAttached) {
        const observer = new MutationObserver(() => {
          readCountFrom(statsHeader);
        });
        observer.observe(statsHeader, {
          subtree: true,
          childList: true,
          characterData: true,
        });
        attackerObserverAttached = true;
      }

      readCountFrom(statsHeader);
    };

    const bodyObserver = new MutationObserver(tryAttach);
    bodyObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });

    tryAttach();
  }

  function monitorFightLifecycle() {
    const evaluateStatus = () => {
      const currentStatus = detectFightState();

      if (lastFightStatus === null) {
        lastFightStatus = currentStatus;
        return;
      }

      if (currentStatus === lastFightStatus) {
        return;
      }

      const previousStatus = lastFightStatus;
      lastFightStatus = currentStatus;

      if (!hasActiveAssistSession()) {
        return;
      }

      const looksEnded =
        currentStatus !== "Not Started" && currentStatus !== "Ongoing";

      if (looksEnded) {
        clearActiveAssistSession();
        sendAssistEvent("DELETE", {
          action: "session_end",
          details:
            "Fight status changed: " +
            String(previousStatus) +
            " -> " +
            String(currentStatus),
          result: "fight_ended",
          fight_status: normalizeFightStatus(currentStatus),
        });
        return;
      }

      if (previousStatus === "Not Started" && currentStatus === "Ongoing") {
        const initialHealth = readEnemyHealth();
        if (initialHealth) {
          lastHealthSnapshot =
            String(Math.round(initialHealth.current)) +
            "/" +
            String(Math.round(initialHealth.max));
          sendAssistEvent("PATCH", {
            action: "fight_started",
            details:
              "Fight status changed: " +
              String(previousStatus) +
              " -> " +
              String(currentStatus),
            result: "status_changed",
            fight_status: currentStatus,
            enemy_health_current: Math.round(initialHealth.current),
            enemy_health_max: Math.round(initialHealth.max),
            enemy_health_percent: Math.round(initialHealth.percent),
          }).then((response) => {
            if (response.status === 404 || response.status === 410) {
              clearActiveAssistSession();
            }
          });
          return;
        }
      }

      sendAssistEvent("PATCH", {
        action: "fight_status_changed",
        details:
          "Fight status changed: " +
          String(previousStatus) +
          " -> " +
          String(currentStatus),
        result: "status_changed",
        fight_status: currentStatus,
      }).then((response) => {
        if (response.status === 404 || response.status === 410) {
          clearActiveAssistSession();
        }
      });
    };

    const statusObserver = new MutationObserver(evaluateStatus);
    statusObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });

    evaluateStatus();
  }

  function monitorEnemyHealth() {
    let observedEnemyHeader = null;
    let healthObserver = null;

    const onHealthMutated = () => {
      if (!hasActiveAssistSession()) {
        return;
      }

      const health = readEnemyHealth();
      if (!health) {
        return;
      }

      const snapshot =
        String(Math.round(health.current)) + "/" + String(Math.round(health.max));
      if (snapshot === lastHealthSnapshot) {
        return;
      }
      lastHealthSnapshot = snapshot;

      sendAssistEvent("PATCH", {
        action: "enemy_health_updated",
        result: "health_update",
        enemy_health_current: Math.round(health.current),
        enemy_health_max: Math.round(health.max),
        enemy_health_percent: Math.round(health.percent),
      }).then((response) => {
        if (response.status === 404 || response.status === 410) {
          clearActiveAssistSession();
        }
      });
    };

    const tryAttach = () => {
      const enemyHeader = document.querySelector('[class*="headerWrapper"][class*="rose"]');
      if (!enemyHeader) {
        return;
      }

      if (enemyHeader !== observedEnemyHeader) {
        if (healthObserver) {
          healthObserver.disconnect();
        }

        healthObserver = new MutationObserver(onHealthMutated);
        healthObserver.observe(enemyHeader, {
          subtree: true,
          childList: true,
          characterData: true,
        });
        observedEnemyHeader = enemyHeader;
      }

      onHealthMutated();
    };

    const bodyObserver = new MutationObserver(tryAttach);
    bodyObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });

    tryAttach();
  }

  window.addEventListener("beforeunload", () => {
    if (!hasActiveAssistSession()) {
      return;
    }

    clearActiveAssistSession();
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
    monitorFightLifecycle();
    monitorEnemyHealth();
  } else {
    window.addEventListener("load", () => {
      injectButton();
      monitorAttackerCount();
      monitorFightLifecycle();
      monitorEnemyHealth();
    });
  }
})();
`;
}
