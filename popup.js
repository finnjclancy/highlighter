document.getElementById("open-library").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("library.html") });
});
document.getElementById("open-options").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("library.html#design") });
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

function utf8ToB64Url(s) {
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function buildShareUrl(pageUrl, list) {
  const payload = {
    v: 1,
    highlights: list.map(h => ({
      id: h.id, bg: h.bg, fg: h.fg,
      text: h.text,
      note: h.note || "",
      tags: h.tags || [],
      r: {
        sx: h.range.startXPath, so: h.range.startOffset,
        ex: h.range.endXPath,   eo: h.range.endOffset
      }
    }))
  };
  const enc = utf8ToB64Url(JSON.stringify(payload));
  const u = new URL(pageUrl);
  // Use query param (survives most messaging apps; fragments are often stripped)
  u.searchParams.set("hlshare", enc);
  return u.toString();
}

// Robust clipboard copy that works in MV3 popups
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

document.getElementById("share-page").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) { toast("Open a real web page first."); return; }
  let key;
  try {
    const u = new URL(tab.url);
    if (!/^https?:$/.test(u.protocol)) { toast("Open a real web page first."); return; }
    key = "hl_page_" + u.origin + u.pathname;
  } catch {
    toast("Open a real web page first."); return;
  }
  const data = await chrome.storage.local.get(key);
  const list = data[key] || [];
  if (!list.length) { toast("No highlights on this page yet."); return; }
  const shareUrl = buildShareUrl(tab.url, list);
  await copyToClipboard(shareUrl);
  toast(`✓ Link copied (${list.length} ${list.length === 1 ? "highlight" : "highlights"})`);
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
