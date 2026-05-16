const DEFAULT_PALETTE = [
  { name: "Yellow",  bg: "#fff59d", fg: "#1a1a1a" },
  { name: "Green",   bg: "#b9f6ca", fg: "#0b3d1a" },
  { name: "Pink",    bg: "#f8bbd0", fg: "#4a0028" },
  { name: "Blue",    bg: "#b3e5fc", fg: "#0b2a3d" },
  { name: "Orange",  bg: "#ffcc80", fg: "#3d1f00" },
  { name: "Purple",  bg: "#d1c4e9", fg: "#1c0b3d" },
  { name: "Red",     bg: "#ffab91", fg: "#3d0b00" },
  { name: "Dark",    bg: "#263238", fg: "#ffffff" }
];

chrome.runtime.onInstalled.addListener(async (details) => {
  const { palette } = await chrome.storage.sync.get("palette");
  if (!palette) await chrome.storage.sync.set({ palette: DEFAULT_PALETTE });

  // Open the welcome page only on first install (not on updates or browser restart)
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "openUrl") {
    chrome.tabs.create({ url: msg.url });
    sendResponse({ ok: true });
  }
  return true;
});
