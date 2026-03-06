// ==UserScript==
// @name         Torn Attack Webhook Button
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Inject a button on Torn attack page to send opponent ID to webhook
// @author       Sentinel
// @match        https://www.torn.com/loader.php?sid=attack*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const WEBHOOK_URL =
    "https://webhook.site/20fff8eb-cd00-480a-8fb1-6666f2bc0545";
  let buttonInjected = false;

  // Function to extract opponent ID from URL
  function getOpponentId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get("user2ID");
  }

  // Function to send data to webhook
  async function sendToWebhook(opponentId) {
    try {
      const response = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          opponentId: opponentId,
          timestamp: new Date().toISOString(),
          url: window.location.href,
        }),
      });

      if (response.ok) {
        console.log("Yabba Dabba Doo! Data sent successfully!");
        alert("Yabba Dabba Doo! Opponent ID sent to webhook!");
      } else {
        console.error("Failed to send data to webhook");
        alert("Failed to send data. Check console.");
      }
    } catch (error) {
      console.error("Error sending to webhook:", error);
      alert("Error sending data. Check console.");
    }
  }

  // Function to inject the button
  function injectButton() {
    if (buttonInjected) return;

    // Look for the linksContainer
    const linksContainer = document.querySelector('[class*="linksContainer"]');

    if (!linksContainer) {
      console.log("Links container not found yet...");
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
            margin-top: 12px;
            padding: 0 10px;
        `;

    // Create the button
    const button = document.createElement("button");
    button.id = "sentinel-yabba-dabba-button";
    button.textContent = "Yabba Dabba Doo!";
    button.style.cssText = `
            background-color: #ff0000;
            color: white;
            font-size: 14px;
            font-weight: bold;
            padding: 8px 16px;
            border: 2px solid #cc0000;
            border-radius: 6px;
            cursor: pointer;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            transition: all 0.2s ease;
            width: 100%;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        `;

    // Hover effects
    button.onmouseover = () => {
      button.style.backgroundColor = "#cc0000";
      button.style.transform = "translateY(-1px)";
      button.style.boxShadow = "0 3px 6px rgba(0,0,0,0.3)";
    };
    button.onmouseout = () => {
      button.style.backgroundColor = "#ff0000";
      button.style.transform = "translateY(0)";
      button.style.boxShadow = "0 2px 4px rgba(0,0,0,0.2)";
    };

    // Click handler
    button.onclick = () => {
      const opponentId = getOpponentId();
      if (opponentId) {
        sendToWebhook(opponentId);
      } else {
        alert("No opponent ID found in URL!");
      }
    };

    // Assemble and insert
    buttonContainer.appendChild(button);

    // Insert after linksContainer
    linksContainer.parentNode.insertBefore(
      buttonContainer,
      linksContainer.nextSibling,
    );

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
  } else {
    window.addEventListener("load", () => {
      setTimeout(injectButton, 100);
    });
  }

  console.log(
    "Yabba Dabba Doo script loaded and waiting for links container...",
  );
})();
