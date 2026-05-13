// --- simple helpers ---
function splitSentences(text) {
  if (!text) return [];
  return (text.replace(/\n+/g, " ").match(/[^.!?]+[.!?]*/g) || [text]).map(
    (s) => s.trim(),
  );
}
console.log("DevSummarize content script loaded on", location.href);

function tokenize(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}
function jaccard(a, b) {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  const inter = [...A].filter((x) => B.has(x)).length;
  const union = new Set([...A, ...B]).size || 1;
  return inter / union;
}

// PageRank-style ranking (lightweight)
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
  const iterations = 8;

  for (let it = 0; it < iterations; it++) {
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

async function summarizeWithBuiltInAI(text) {
  if (!window.ai || !window.ai.summarizer) {
    console.log("DevSummarize: Built-in AI Summarizer not supported.");
    return null;
  }
  try {
    const capabilities = await window.ai.summarizer.capabilities();
    if (capabilities.available === "no") {
      console.log("DevSummarize: Built-in AI Summarizer not available.");
      return null;
    }

    const summarizer = await window.ai.summarizer.create({
      type: "key-points",
      format: "plain-text",
      length: "medium",
    });

    const summary = await summarizer.summarize(text);
    summarizer.destroy();
    return summary;
  } catch (err) {
    console.warn("DevSummarize: Built-in AI Summarizer failed, falling back.", err);
    return null;
  }
}

function summarizeText(text, k = 4) {
  const sents = splitSentences(text).filter((s) => s.length > 20);
  if (sents.length === 0) return "";
  const ranked = rankSentences(sents)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(k, sents.length));
  // return in original order for coherence
  ranked.sort((a, b) => a.i - b.i);
  return ranked.map((x) => x.text).join(" ");
}

function getTargetText() {
  const url = window.location.href;

  // --- GitHub Specifics ---
  if (url.includes("github.com")) {
    // Try to find the README content first
    const readme = document.querySelector("#readme article");
    if (readme) return readme.innerText;
    
    // Fallback to the main content area
    const main = document.querySelector('main[role="main"]');
    if (main) return main.innerText;
  }

  // --- StackOverflow Specifics ---
  if (url.includes("stackoverflow.com/questions")) {
    // Try to find the accepted answer
    const acceptedAnswer = document.querySelector(".accepted-answer .js-post-body");
    if (acceptedAnswer) return acceptedAnswer.innerText;

    // Fallback to the highest voted answer (first answer in the list)
    const topAnswer = document.querySelector(".answer .js-post-body");
    if (topAnswer) return topAnswer.innerText;

    // Fallback to the question itself if no answers
    const questionBody = document.querySelector(".question .js-post-body");
    if (questionBody) return questionBody.innerText;
  }

  // --- General Article Extraction ---
  const body = document.body;
  let maxText = "";
  // Preference order for semantic tags
  const tags = ["article", "main", "section", "div"];
  for (const tag of tags) {
    const els = Array.from(document.getElementsByTagName(tag));
    for (const el of els) {
      // Basic heuristic: must be long enough and contain many paragraphs
      const t = el.innerText || "";
      if (t.length > maxText.length) maxText = t;
    }
  }

  return maxText && maxText.length > 200
    ? maxText
    : document.body.innerText || "";
}

// Listen for messages from popup or background
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("DevSummarize received message", msg);

  if (msg && msg.type === "DEV_SUMMARY_REQUEST") {
    (async () => {
      try {
        // text preference: use selection (msg.text) else try selecting page main content
        let text = msg.text && msg.text.trim().length > 0 ? msg.text : null;
        if (!text) {
          text = getTargetText();
        }

        // keep code blocks distinguishable: extract them and append after summary
        // For sites like Stack Overflow, we want the code from the SPECIFIC target
        const codeBlocks = Array.from(document.querySelectorAll("pre code"))
          .map((el) => el.innerText)
          .filter((t) => t.length > 10)
          .slice(0, 5);

        // Try Built-in AI first, fallback to local PageRank
        const aiSummary = await summarizeWithBuiltInAI(text);
        const summary = aiSummary || summarizeText(text, 4);

        const result = { summary, codeBlocks };
        // send response back to caller (popup) via sendResponse
        sendResponse({ ok: true, result });
      } catch (err) {
        sendResponse({ ok: false, error: err.message || String(err) });
      }
    })();
    return true; // indicate async response
  }
});
