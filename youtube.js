// YouTube companion for Highlighter.
//
// Strategy after a long debug session: YouTube's anti-scraping defenses
// make any programmatic transcript fetch unreliable, and even
// programmatically clicking "Show transcript" leaves the engagement
// panel empty — they release the transcript data only when a real user
// gesture triggers the panel.
//
// So we don't inject our own panel at all. We just:
//   1. Detect when the user opens YouTube's native transcript panel.
//   2. Style it to be tall and fit the right column nicely.
//   3. Show a tiny hint in the panel header telling the user they can
//      drag-select transcript text to highlight it (the existing
//      Highlighter selection toolbar handles the rest).
//
// Per-video storage scoping (already in content.js) makes each video
// keep its own highlight bucket via ?v= in the key.

(() => {
  if (!/(^|\.)youtube\.com$/.test(location.hostname)) return;
  if (window.__hlYouTubeLoaded) return;
  window.__hlYouTubeLoaded = true;

  const LOG = (...a) => console.info("[Highlighter/YT]", ...a);
  LOG("script loaded on", location.href);

  const PANEL_SELS = [
    'ytd-engagement-panel-section-list-renderer[target-id*="transcript"]',
    'ytd-engagement-panel-section-list-renderer[panel-identifier*="transcript"]'
  ];

  function findTranscriptPanel() {
    for (const sel of PANEL_SELS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function enhancePanel(panel) {
    if (panel.dataset.hlEnhanced) return;
    panel.dataset.hlEnhanced = "1";
    panel.classList.add("hl-yt-enhanced");
    LOG("enhanced YouTube transcript panel");

    // Insert a small hint banner above the segments
    const header = panel.querySelector("ytd-engagement-panel-title-header-renderer")
                || panel.querySelector("#header");
    if (header && !header.querySelector(".hl-yt-hint")) {
      const hint = document.createElement("div");
      hint.className = "hl-yt-hint";
      hint.innerHTML = `<span class="hl-yt-hint-logo">✦</span> Select transcript text to highlight it`;
      header.appendChild(hint);
    }
  }

  // Watch for the transcript panel appearing/disappearing
  const observer = new MutationObserver(() => {
    const panel = findTranscriptPanel();
    if (panel && (!panel.hasAttribute("visibility") || panel.getAttribute("visibility") !== "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN")) {
      enhancePanel(panel);
    }
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["visibility"] });

  // Check immediately too, in case the panel is already open from a
  // previous SPA navigation
  const existing = findTranscriptPanel();
  if (existing) enhancePanel(existing);
})();
