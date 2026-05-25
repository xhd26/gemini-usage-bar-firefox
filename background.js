// Background service worker for Gemini Tweaks

const RULE_ID_1 = 1;

const rules = [
  {
    id: RULE_ID_1,
    priority: 1,
    action: {
      type: "modifyHeaders",
      responseHeaders: [
        { header: "x-frame-options", operation: "remove" },
        { header: "content-security-policy", operation: "remove" }
      ]
    },
    condition: {
      urlFilter: "gemini.google.com/usage",
      resourceTypes: ["sub_frame"]
    }
  }
];

// Register rules on install and startup
function registerRules() {
  chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [RULE_ID_1],
    addRules: rules
  }, () => {
    if (chrome.runtime.lastError) {
      console.error("[Gemini Tweaks] Error updating rules:", chrome.runtime.lastError);
    } else {
      console.log("[Gemini Tweaks] Declarative net request rules registered successfully.");
    }
  });
}

chrome.runtime.onInstalled.addListener(registerRules);
chrome.runtime.onStartup.addListener(registerRules);

// Run immediately in case the service worker is booted without install/startup events
registerRules();

// Listen for keyboard commands
chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-usage-visibility") {
    // Find the active tab and send a message to toggle the usage pill
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "toggle_visibility" });
      }
    });
  }
});

