// --- Core Summarization Logic (Duplicated for standalone popup support) ---
function splitSentences(text) {
  if (!text) return [];
  return (text.replace(/\n+/g, " ").match(/[^.!?]+[.!?]*/g) || [text]).map(s => s.trim());
}

function tokenize(s) {
  return s.toLowerCase().replace(/[^a-z0-9_]+/g, " ").split(/\s+/).filter(Boolean);
}

function jaccard(a, b) {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  const inter = [...A].filter(x => B.has(x)).length;
  const union = new Set([...A, ...B]).size || 1;
  return inter / union;
}

function rankSentences(sentences) {
  const n = sentences.length;
  if (n === 0) return [];
  if (n <= 3) return sentences.map((t, i) => ({ i, score: 1, text: t }));
  const W = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j) W[i][j] = jaccard(sentences[i], sentences[j]);
    }
  }
  let scores = new Array(n).fill(1);
  const damping = 0.85;
  for (let it = 0; it < 8; it++) {
    const newScores = new Array(n).fill(1 - damping);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const out = W[j].reduce((a, b) => a + b, 0) || 1;
        if (W[j][i] > 0) newScores[i] += damping * (W[j][i] / out) * scores[j];
      }
    }
    scores = newScores;
  }
  return sentences.map((text, i) => ({ i, score: scores[i], text }));
}

function localSummarize(text, k = 4) {
  const sents = splitSentences(text).filter(s => s.length > 20);
  if (sents.length === 0) return text.substring(0, 200) + "...";
  const ranked = rankSentences(sents).sort((a, b) => b.score - a.score).slice(0, Math.min(k, sents.length));
  ranked.sort((a, b) => a.i - b.i);
  return ranked.map(x => x.text).join(" ");
}

async function aiSummarize(text) {
  if (!window.ai?.summarizer) return null;
  try {
    const capabilities = await window.ai.summarizer.capabilities();
    if (capabilities.available === "no") return null;
    const summarizer = await window.ai.summarizer.create({ type: "key-points", format: "plain-text", length: "medium" });
    const result = await summarizer.summarize(text);
    summarizer.destroy();
    return result;
  } catch (err) {
    console.warn("AI Summarizer failed:", err);
    return null;
  }
}

async function runSummarization(text) {
  const aiResult = await aiSummarize(text);
  return aiResult || localSummarize(text);
}

// --- UI Logic ---
const summarizeTab = document.getElementById("summarizeTab");
const historyTab = document.getElementById("historyTab");
const summarizeView = document.getElementById("summarizeView");
const historyView = document.getElementById("historyView");
const summarizeBtn = document.getElementById("summarizeBtn");
const summarizeManualBtn = document.getElementById("summarizeManualBtn");
const manualText = document.getElementById("manualText");
const resultDiv = document.getElementById("result");
const historyList = document.getElementById("historyList");
const clearHistory = document.getElementById("clearHistory");
const copyBtn = document.getElementById("copyBtn");
const aiStatus = document.getElementById("aiStatus");

let history = [];

document.addEventListener("DOMContentLoaded", async () => {
    const data = await chrome.storage.local.get("history");
    history = data.history || [];
    checkAI();
});

async function checkAI() {
    if (window.ai?.summarizer) {
        const caps = await window.ai.summarizer.capabilities();
        if (caps.available !== "no") {
            aiStatus.textContent = "AI ready";
            return;
        }
    }
    aiStatus.textContent = "Offline engine";
}

// Tabs
summarizeTab.onclick = () => {
    summarizeTab.classList.add("active");
    historyTab.classList.remove("active");
    summarizeView.classList.remove("hidden");
    historyView.classList.add("hidden");
};

historyTab.onclick = () => {
    historyTab.classList.add("active");
    summarizeTab.classList.remove("active");
    historyView.classList.remove("hidden");
    summarizeView.classList.add("hidden");
    renderHistory();
};

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  } catch {}
}

function displayResult(summary, codeBlocks) {
    let html = `<div class="summary-text">${summary}</div>`;
    if (codeBlocks?.length) {
        html += `<div class="code-blocks-section">
            <h5>Snippets</h5>
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

async function saveHistory(summary, codeBlocks) {
    const item = { id: Date.now(), date: new Date().toLocaleTimeString(), summary, codeBlocks };
    history.unshift(item);
    if (history.length > 20) history.pop();
    await chrome.storage.local.set({ history });
}

function renderHistory() {
    if (history.length === 0) {
        historyList.innerHTML = `<div class="empty-state">No history.</div>`;
        return;
    }
    historyList.innerHTML = history.map(item => `
        <div class="history-item" data-id="${item.id}">
            <div class="history-date">${item.date}</div>
            <div class="history-preview">${escapeHtml(item.summary)}</div>
        </div>
    `).join("");
    
    document.querySelectorAll(".history-item").forEach(el => {
        el.onclick = () => {
            const item = history.find(i => i.id == el.dataset.id);
            if (item) {
                summarizeTab.click();
                displayResult(item.summary, item.codeBlocks);
            }
        };
    });
}

summarizeBtn.onclick = async () => {
  const tab = await getActiveTab();
  if (!tab || !/^https?:\/\//.test(tab.url)) {
    resultDiv.innerHTML = `<div class="empty-state">Can't read this page. Try 'Paste' instead.</div>`;
    return;
  }
  
  resultDiv.innerHTML = `<div class="empty-state">Analyzing...</div>`;
  await ensureContentScript(tab.id);
  
  chrome.tabs.sendMessage(tab.id, { type: "DEV_SUMMARY_REQUEST" }, async (res) => {
    if (res?.ok) {
        displayResult(res.result.summary, res.result.codeBlocks);
        saveHistory(res.result.summary, res.result.codeBlocks);
    } else {
        resultDiv.innerHTML = `<div class="empty-state">Error: ${res?.error || "Connection failed"}</div>`;
    }
  });
};

summarizeManualBtn.onclick = async () => {
    const text = manualText.value.trim();
    if (!text) return;
    
    resultDiv.innerHTML = `<div class="empty-state">Processing...</div>`;
    const summary = await runSummarization(text);
    displayResult(summary, []);
    saveHistory(summary, []);
};

copyBtn.onclick = () => {
    const text = resultDiv.innerText;
    if (text.includes("Results will appear")) return;
    navigator.clipboard.writeText(text);
    const old = copyBtn.textContent;
    copyBtn.textContent = "Saved";
    setTimeout(() => copyBtn.textContent = old, 1000);
};

clearHistory.onclick = async () => {
    history = [];
    await chrome.storage.local.set({ history: [] });
    renderHistory();
};
