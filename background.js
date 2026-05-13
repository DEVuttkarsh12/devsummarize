chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "devsummarize-sel",
    title: "DevSummarize: Summarize selection",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "devsummarize-sel" && tab?.id) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
      console.log("✅ Content script ensured on context menu click.");
    } catch (err) {
      console.warn("⚠️ Script injection failed from background:", err);
    }

    chrome.tabs.sendMessage(tab.id, {
      type: "DEV_SUMMARY_REQUEST",
      text: info.selectionText || "",
    });
  }
});
