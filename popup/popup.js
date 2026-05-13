// Elements
const summarizeBtn = document.getElementById("summarizeBtn");
const summarizeManualBtn = document.getElementById("summarizeManualBtn");
const manualText = document.getElementById("manualText");
const resultDiv = document.getElementById("result");
const copyBtn = document.getElementById("copyBtn");
const openREADME = document.getElementById("openREADME");
const clearHistory = document.getElementById("clearHistory");
const historyList = document.getElementById("historyList");
const tabLinks = document.querySelectorAll(".tab-link");
const tabContents = document.querySelectorAll(".tab-content");
const aiStatus = document.getElementById("aiStatus");
const aiLabel = document.getElementById("aiLabel");

// State
let currentHistory = [];

// Initialize
document.addEventListener("DOMContentLoaded", () => {
    loadHistory();
    setupTabs();
});

// Tab Logic
function setupTabs() {
    tabLinks.forEach(link => {
        link.addEventListener("click", () => {
            const target = link.dataset.tab;
            
            tabLinks.forEach(l => l.classList.remove("active"));
            tabContents.forEach(c => c.classList.remove("active"));
            
            link.classList.add("active");
            document.getElementById(target).classList.add("active");
            
            if (target === "history") renderHistory();
        });
    });
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  } catch (err) {
    console.warn("⚠️ Content script injection failed:", err);
  }
}

function sendSummaryRequest(tabId, text = "") {
  chrome.tabs.sendMessage(
    tabId,
    { type: "DEV_SUMMARY_REQUEST", text },
    (response) => {
      if (chrome.runtime.lastError) {
        resultDiv.innerHTML = `<p class="error-text">Could not connect to page. Try reloading.</p>`;
        return;
      }

      if (!response) {
        resultDiv.innerHTML = `<p class="error-text">No response received.</p>`;
        return;
      }

      if (response.ok) {
        const { summary, codeBlocks } = response.result;
        displayResult(summary, codeBlocks);
        saveToHistory(summary, codeBlocks, text);
      } else {
        resultDiv.innerHTML = `<p class="error-text">Error: ${response.error || "unknown"}</p>`;
      }
    },
  );
}

function displayResult(summary, codeBlocks) {
    let html = `<div class="summary-text">${summary || "No summary generated."}</div>`;
    if (codeBlocks?.length) {
        html += `<div class="code-blocks-section">
            <h5>Code Snippets</h5>
            ${codeBlocks.map(c => `<pre><code>${escapeHtml(c)}</code></pre>`).join("")}
        </div>`;
    }
    resultDiv.innerHTML = html;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// History Management
async function loadHistory() {
    const data = await chrome.storage.local.get("history");
    currentHistory = data.history || [];
}

async function saveToHistory(summary, codeBlocks, originalText) {
    const newItem = {
        id: Date.now(),
        date: new Date().toLocaleString(),
        summary,
        codeBlocks,
        preview: summary.substring(0, 100) + "..."
    };
    
    currentHistory.unshift(newItem);
    if (currentHistory.length > 20) currentHistory.pop(); // Keep last 20
    
    await chrome.storage.local.set({ history: currentHistory });
}

function renderHistory() {
    if (currentHistory.length === 0) {
        historyList.innerHTML = `<p class="placeholder-text">No history yet.</p>`;
        return;
    }
    
    historyList.innerHTML = currentHistory.map(item => `
        <div class="history-item" data-id="${item.id}">
            <div class="history-item-date">${item.date}</div>
            <div class="history-item-text">${escapeHtml(item.summary)}</div>
        </div>
    `).join("");
    
    // Add click events to history items
    document.querySelectorAll(".history-item").forEach(el => {
        el.addEventListener("click", () => {
            const id = parseInt(el.dataset.id);
            const item = currentHistory.find(i => i.id === id);
            if (item) {
                // Switch to summarize tab and show result
                document.querySelector('[data-tab="summarize"]').click();
                displayResult(item.summary, item.codeBlocks);
            }
        });
    });
}

clearHistory.addEventListener("click", async () => {
    currentHistory = [];
    await chrome.storage.local.set({ history: [] });
    renderHistory();
});

// Event Listeners
summarizeBtn.addEventListener("click", async () => {
  resultDiv.innerHTML = `<div class="loading-spinner">⏳ Processing with Local AI...</div>`;
  const tab = await getActiveTab();
  if (!tab || !/^https?:\/\//.test(tab.url)) {
    resultDiv.innerHTML = `<p class="error-text">Cannot summarize this page.</p>`;
    return;
  }

  await ensureContentScript(tab.id);
  setTimeout(() => sendSummaryRequest(tab.id), 300);
});

summarizeManualBtn.addEventListener("click", async () => {
  const text = manualText.value.trim();
  if (!text) return;

  resultDiv.innerHTML = `<div class="loading-spinner">⏳ Processing...</div>`;
  const tab = await getActiveTab();
  await ensureContentScript(tab.id);
  setTimeout(() => sendSummaryRequest(tab.id, text), 300);
});

copyBtn.addEventListener("click", () => {
  const txt = resultDiv.innerText;
  if (!txt || txt.includes("Run a summary")) return;
  navigator.clipboard.writeText(txt).then(() => {
    const originalIcon = copyBtn.textContent;
    copyBtn.textContent = "✅";
    setTimeout(() => (copyBtn.textContent = originalIcon), 1200);
  });
});

openREADME.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://github.com/YOUR-USERNAME/YOUR-REPO" });
});
