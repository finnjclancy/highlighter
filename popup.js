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

document.getElementById("share-page").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  let resp;
  try {
    resp = await chrome.tabs.sendMessage(tab.id, { type: "buildShareLink" });
  } catch (e) {
    toast("Open a real web page first.");
    return;
  }
  if (resp?.ok) {
    toast(`✓ Link copied (${resp.count} highlights)`);
  } else if (resp?.url) {
    // Clipboard write failed — fall back to copying via popup
    try {
      await navigator.clipboard.writeText(resp.url);
      toast(`✓ Link copied (${resp.count} highlights)`);
    } catch {
      toast(resp.error || "Couldn't copy.");
    }
  } else {
    toast(resp?.error || "Nothing to share.");
  }
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
