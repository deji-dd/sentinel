// ==UserScript==
// @name         Torn Attack Webhook Button
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  Inject a button on Torn attack page to send opponent ID to webhook + monitor attacker count
// @author       Sentinel
// @match        https://www.torn.com/loader.php?sid=attack*
// @grant        GM_xmlhttpRequest
// @connect      webhook.site
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const WEBHOOK_URL =
    "https://webhook.site/20fff8eb-cd00-480a-8fb1-6666f2bc0545";
  let buttonInjected = false;

  // Function to show a toast notification
  function showToast(message, isSuccess = true) {
    const toast = document.createElement("div");
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${isSuccess ? "linear-gradient(135deg, #06d6a0 0%, #00b894 100%)" : "linear-gradient(135deg, #e63946 0%, #d62828 100%)"};
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      animation: slideIn 0.3s ease;
      max-width: 300px;
    `;
    toast.textContent = message;

    // Add animation keyframes
    const style = document.createElement("style");
    style.textContent = `
      @keyframes slideIn {
        from { transform: translateX(400px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(400px); opacity: 0; }
      }
    `;
    document.head.appendChild(style);

    document.body.appendChild(toast);

    // Auto-remove after 3 seconds
    setTimeout(() => {
      toast.style.animation = "slideOut 0.3s ease";
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // Function to extract opponent ID from URL
  function getOpponentId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get("user2ID");
  }

  // Function to send data to webhook
  async function sendToWebhook(opponentId) {
    try {
      GM_xmlhttpRequest({
        method: "POST",
        url: WEBHOOK_URL,
        headers: {
          "Content-Type": "application/json",
        },
        data: JSON.stringify({
          opponentId: opponentId,
          timestamp: new Date().toISOString(),
          url: window.location.href,
        }),
        onload: function (response) {
          if (response.status >= 200 && response.status < 300) {
            console.log("Yabba Dabba Doo! Data sent successfully!");
            showToast("✓ Opponent ID sent to webhook!", true);
          } else {
            console.error("Failed to send data to webhook");
            showToast("✗ Failed to send data", false);
          }
        },
        onerror: function (error) {
          console.error("Error sending to webhook:", error);
          showToast("✗ Network error occurred", false);
        },
      });
    } catch (error) {
      console.error("Error sending to webhook:", error);
      showToast("✗ Network error occurred", false);
    }
  }

  // Function to send PATCH request with attacker count
  function sendAttackerCountPatch(count) {
    try {
      GM_xmlhttpRequest({
        method: "PATCH",
        url: WEBHOOK_URL,
        headers: {
          "Content-Type": "application/json",
        },
        data: JSON.stringify({
          opponentId: getOpponentId(),
          attackerCount: count,
          timestamp: new Date().toISOString(),
          url: window.location.href,
        }),
        onload: function (response) {
          if (response.status >= 200 && response.status < 300) {
            console.log(`Attacker count updated: ${count}`);
          } else {
            console.error("Failed to send attacker count update");
          }
        },
        onerror: function (error) {
          console.error("Error sending attacker count:", error);
        },
      });
    } catch (error) {
      console.error("Error sending attacker count:", error);
    }
  }

  // Function to monitor attacker count
  function startAttackerCountMonitor() {
    let previousCount = null;

    const monitorAttackers = () => {
      // Try to find the attacker count element
      const statsHeader = document.getElementById("stats-header");
      if (!statsHeader) {
        console.log("Stats header not found yet...");
        return false;
      }

      const titleNumber = statsHeader.querySelector('[class*="titleNumber"]');
      if (!titleNumber) {
        console.log("Title number element not found...");
        return false;
      }

      // Get current count
      const currentCount = parseInt(titleNumber.textContent.trim(), 10);

      if (isNaN(currentCount)) {
        console.log("Could not parse attacker count");
        return false;
      }

      // Send PATCH if count changed
      if (previousCount !== null && previousCount !== currentCount) {
        console.log(
          `Attacker count changed: ${previousCount} -> ${currentCount}`,
        );
        sendAttackerCountPatch(currentCount);
      }

      previousCount = currentCount;
      return true;
    };

    // Try initial detection
    if (!monitorAttackers()) {
      // If not found initially, use MutationObserver
      const attacker = new MutationObserver(() => {
        monitorAttackers();
      });

      attacker.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      console.log("Attacker count monitor initialized with MutationObserver");
      return;
    }

    // Also observe for count changes after first detection
    const statsHeader = document.getElementById("stats-header");
    if (statsHeader) {
      const attacker = new MutationObserver(() => {
        monitorAttackers();
      });

      attacker.observe(statsHeader, {
        subtree: true,
        characterData: true,
        childList: true,
      });

      console.log("Attacker count monitor active");
    }
  }

  // Function to inject the button
  function injectButton() {
    if (buttonInjected) return;

    // Look for the topSection container
    const topSection = document.querySelector('[class*="topSection"]');

    if (!topSection) {
      console.log("Top section not found yet...");
      return;
    }

    // Check if button already exists
    if (document.getElementById("sentinel-yabba-dabba-button")) {
      buttonInjected = true;
      return;
    }

    // Create a container div for our button
    const buttonContainer = document.createElement("div");
    buttonContainer.id = "sentinel-button-container";
    buttonContainer.style.cssText = `
            margin-top: 8px;
            padding: 0;
            text-align: right;
        `;

    // Create the button
    const button = document.createElement("button");
    button.id = "sentinel-yabba-dabba-button";
    button.innerHTML = `<span style="margin-right: 5px;">🎯</span>Yabba Dabba Doo!`;
    button.style.cssText = `
            background: linear-gradient(135deg, #4a90e2 0%, #357abd 100%);
            color: #ffffff;
            font-size: 11px;
            font-weight: 600;
            padding: 5px 10px;
            border: 1px solid rgba(53, 122, 189, 0.4);
            border-radius: 4px;
            cursor: pointer;
            box-shadow: 0 1px 2px rgba(0,0,0,0.1);
            transition: all 0.2s ease;
            text-transform: uppercase;
            letter-spacing: 0.3px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            -webkit-tap-highlight-color: transparent;
            user-select: none;
        `;

    // Hover/Active effects (desktop and mobile)
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

    // Touch feedback for mobile
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

    // Click handler
    button.onclick = () => {
      const opponentId = getOpponentId();
      if (opponentId) {
        sendToWebhook(opponentId);
      } else {
        showToast("✗ No opponent ID found in URL", false);
      }
    };

    // Assemble and insert
    buttonContainer.appendChild(button);

    // Insert after topSection (as a sibling, not a child)
    topSection.parentNode.insertBefore(buttonContainer, topSection.nextSibling);

    buttonInjected = true;
    console.log("Yabba Dabba Doo button injected successfully!");
  }

  // Method 1: MutationObserver (more efficient)
  const observer = new MutationObserver((mutations) => {
    if (!buttonInjected) {
      injectButton();
    }
  });

  // Start observing the document
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Method 2: Fallback setInterval (runs every 500ms)
  const intervalId = setInterval(() => {
    if (buttonInjected) {
      clearInterval(intervalId);
      observer.disconnect();
    } else {
      injectButton();
    }
  }, 500);

  // Initial attempt
  if (document.readyState === "complete") {
    setTimeout(injectButton, 100);
    setTimeout(startAttackerCountMonitor, 100);
  } else {
    window.addEventListener("load", () => {
      setTimeout(injectButton, 100);
      setTimeout(startAttackerCountMonitor, 100);
    });
  }

  console.log("Yabba Dabba Doo script loaded and waiting for top section...");
})();
