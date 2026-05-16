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
    const key = "hl_page_" + u.origin + u.pathname;
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

function buildShareUrl(pageUrl, list) {
  const payload = {
    v: 2,
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
      // Text-quote selector for resilient fallback (~40 chars each side)
      if (h.prefix) out.p = h.prefix;
      if (h.suffix) out.s = h.suffix;
      return out;
    })
  };
  const enc = utf8ToB64Url(JSON.stringify(payload));
  const u = new URL(pageUrl);
  u.searchParams.set("hlshare", enc);
  return u.toString();
}

document.getElementById("share-link").addEventListener("click", async () => {
  const r = await getPageHighlights();
  if (r.error) { toast(r.error); return; }
  if (!r.list.length) { toast("No highlights on this page yet."); return; }
  // Ask the content script to enrich each highlight with prefix/suffix context
  // (best-effort; if it fails, we still build the URL with what we have)
  let enriched = r.list;
  try {
    const ctx = await chrome.tabs.sendMessage(r.tab.id, { type: "getContextForShare" });
    if (ctx?.ok && Array.isArray(ctx.highlights)) enriched = ctx.highlights;
  } catch {}
  const url = buildShareUrl(r.tab.url, enriched);
  await copyToClipboard(url);
  const n = enriched.length;
  toast(`✓ Live link copied (${n} ${n === 1 ? "highlight" : "highlights"})`);
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
      const key = "hl_page_" + u.origin + u.pathname;
      const list = all[key] || [];
      document.getElementById("count-page").textContent = list.length;
    } catch {}
  }
}
loadStats();
