document.getElementById("open-library").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("library.html") });
});
document.getElementById("toggle-panel").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    try { await chrome.tabs.sendMessage(tab.id, { type: "togglePanel" }); } catch {}
  }
  window.close();
});

function computePageKey(u) {
  return "hl_page_" + u.origin + u.pathname;
}

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.style.display = "block";
}

function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
  } catch {}
  return new Promise(resolve => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch {}
    ta.remove();
    resolve();
  });
}

async function getPageHighlights() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return { error: "Open a real web page first." };
  try {
    const u = new URL(tab.url);
    if (!/^https?:$/.test(u.protocol)) return { error: "Open a real web page first." };
    const key = computePageKey(u);
    const data = await chrome.storage.local.get(key);
    const list = data[key] || [];
    return { tab, list };
  } catch {
    return { error: "Open a real web page first." };
  }
}

function buildPlainText(tab, list) {
  const title = (tab.title || tab.url).trim();
  const parts = [title, tab.url, ""];
  list.forEach(h => {
    parts.push((h.text || "").trim());
    if (h.tags && h.tags.length) parts.push("Tags: " + h.tags.join(", "));
    if (h.note) parts.push("Note: " + h.note.trim());
    parts.push("");
  });
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function utf8ToB64Url(s) {
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bytesToB64Url(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function gzipB64Url(jsonStr) {
  // Returns the gzipped JSON as a URL-safe base64 string, prefixed with "z"
  // so receivers know to gunzip. Falls back to raw base64 if the browser
  // lacks CompressionStream (none of the current targets, but be safe).
  if (typeof CompressionStream === "undefined") return utf8ToB64Url(jsonStr);
  try {
    const stream = new Blob([jsonStr]).stream().pipeThrough(new CompressionStream("gzip"));
    const buf = new Uint8Array(await new Response(stream).arrayBuffer());
    return "z" + bytesToB64Url(buf);
  } catch {
    return utf8ToB64Url(jsonStr);
  }
}

const GALLERY_BASE = "https://highlighter-share.finnjclancy.workers.dev/v";
const SHORTEN_ENDPOINT = "https://highlighter-share.finnjclancy.workers.dev/api/shorten";

function buildPayload(pageUrl, pageTitle, list, shareName) {
  return {
    v: 3,
    url: pageUrl,
    title: pageTitle || "",
    name: shareName || "",
    highlights: list.map(h => {
      const out = {
        id: h.id, bg: h.bg, fg: h.fg,
        text: h.text,
        note: h.note || "",
        tags: h.tags || []
      };
      if (h.range) {
        out.r = {
          sx: h.range.startXPath, so: h.range.startOffset,
          ex: h.range.endXPath,   eo: h.range.endOffset
        };
      }
      if (h.prefix) out.p = h.prefix;
      if (h.suffix) out.s = h.suffix;
      return out;
    })
  };
}

async function buildShareUrl(pageUrl, pageTitle, list, shareName) {
  const payload = buildPayload(pageUrl, pageTitle, list, shareName);
  const enc = await gzipB64Url(JSON.stringify(payload));
  const u = new URL(pageUrl);
  u.searchParams.set("hlshare", enc);
  return u.toString();
}

async function buildEncodedPayload(pageUrl, pageTitle, list, shareName) {
  const payload = buildPayload(pageUrl, pageTitle, list, shareName);
  return await gzipB64Url(JSON.stringify(payload));
}

async function shortenViaWorker(enc) {
  try {
    const res = await fetch(SHORTEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: enc })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.url ? data.url : null;
  } catch {
    return null;
  }
}

async function buildGalleryUrl(pageUrl, pageTitle, list, shareName) {
  const enc = await buildEncodedPayload(pageUrl, pageTitle, list, shareName);
  const short = await shortenViaWorker(enc);
  return short || (GALLERY_BASE + "?d=" + enc);
}

let pendingShare = null;  // { tab, enriched } captured when share-link clicked

const shareForm = document.getElementById("share-form");
const shareNameInput = document.getElementById("share-name");
const shareCancel = document.getElementById("share-cancel");
const shareCopy = document.getElementById("share-copy");

document.getElementById("share-link").addEventListener("click", async () => {
  const r = await getPageHighlights();
  if (r.error) { toast(r.error); return; }
  if (!r.list.length) { toast("No highlights on this page yet."); return; }
  let enriched = r.list;
  try {
    const ctx = await chrome.tabs.sendMessage(r.tab.id, { type: "getContextForShare" });
    if (ctx?.ok && Array.isArray(ctx.highlights)) enriched = ctx.highlights;
  } catch {}
  pendingShare = { tab: r.tab, enriched };
  // Default the input to the page title so the user just hits Enter to use it
  shareNameInput.value = (r.tab.title || "").trim();
  shareForm.style.display = "block";
  shareNameInput.focus();
  shareNameInput.select();
});

shareCancel.addEventListener("click", () => {
  shareForm.style.display = "none";
  pendingShare = null;
});

async function doShareCopy() {
  if (!pendingShare) return;
  const { tab, enriched } = pendingShare;
  const name = shareNameInput.value.trim();
  const url = await buildGalleryUrl(tab.url, tab.title, enriched, name);
  await copyToClipboard(url);
  const n = enriched.length;
  shareForm.style.display = "none";
  pendingShare = null;
  toast(`✓ Link copied (${n} ${n === 1 ? "highlight" : "highlights"})`);
}

shareCopy.addEventListener("click", doShareCopy);
shareNameInput.addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); doShareCopy(); }
  else if (e.key === "Escape") { shareForm.style.display = "none"; pendingShare = null; }
});

document.getElementById("share-text").addEventListener("click", async () => {
  const r = await getPageHighlights();
  if (r.error) { toast(r.error); return; }
  if (!r.list.length) { toast("No highlights on this page yet."); return; }
  await copyToClipboard(buildPlainText(r.tab, r.list));
  toast(`✓ Copied (${r.list.length} ${r.list.length === 1 ? "quote" : "quotes"})`);
});

document.getElementById("toggle-draw").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    try { await chrome.tabs.sendMessage(tab.id, { type: "toggleDrawing" }); } catch {}
  }
  window.close();
});

async function loadStats() {
  const all = await chrome.storage.local.get(null);
  let total = 0;
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith("hl_page_") && Array.isArray(v)) total += v.length;
  }
  document.getElementById("count-all").textContent = total;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url) {
    try {
      const u = new URL(tab.url);
      const key = computePageKey(u);
      const list = all[key] || [];
      document.getElementById("count-page").textContent = list.length;
    } catch {}
  }
}
loadStats();
