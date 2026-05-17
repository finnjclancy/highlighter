// YouTube companion for Highlighter.
//
// YouTube blocks programmatic transcript loads — segments only populate
// when a trusted user gesture triggers the panel. Strategy:
//   1. Try the immediate auto-click as soon as the player is ready
//      (works sometimes — depends on video / signed-in state).
//   2. If after 4s the segments still haven't loaded, install a one-time
//      capture-phase click listener on the whole page. The first time you
//      click ANYTHING (commonly the play button), we synchronously
//      re-trigger YouTube's 'Show transcript' button inside that same
//      gesture chain — which YouTube usually accepts as trusted.
//   3. Always enhance YouTube's native engagement panel (taller, smaller
//      font, indigo accent + a 'select to highlight' hint chip).
//
// We never inject our own panel; we only style YouTube's. Highlights
// scope per video via the ?v= page key in content.js.

(() => {
  if (!/(^|\.)youtube\.com$/.test(location.hostname)) return;
  if (window.__hlYouTubeLoaded) return;
  window.__hlYouTubeLoaded = true;

  const LOG = (...a) => console.info("[Highlighter/YT]", ...a);
  LOG("script loaded on", location.href);

  let lastVideoId = null;
  let pendingTimer = null;
  let firstClickHook = null;

  const PANEL_SELS = [
    'ytd-engagement-panel-section-list-renderer[target-id*="transcript"]',
    'ytd-engagement-panel-section-list-renderer[panel-identifier*="transcript"]'
  ];

  function videoIdFromUrl() {
    if (!location.pathname.startsWith("/watch")) return null;
    return new URLSearchParams(location.search).get("v");
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function findTranscriptPanel() {
    for (const sel of PANEL_SELS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function findShowTranscriptButton() {
    const buttons = [...document.querySelectorAll(
      "ytd-video-description-transcript-section-renderer button, " +
      "ytd-button-renderer button, " +
      "tp-yt-paper-button, " +
      "yt-button-shape button, " +
      "button"
    )];
    return buttons.find(b => {
      const t = (b.textContent || b.ariaLabel || b.getAttribute("aria-label") || "").trim();
      return /show transcript/i.test(t);
    }) || document.querySelector('[aria-label*="transcript" i]:not([aria-label*="close" i])');
  }

  function fireRealClick(el) {
    try { el.click(); } catch (_) {}
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      try {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 }));
      } catch (_) {}
    }
  }

  function panelHasSegments() {
    const panel = findTranscriptPanel();
    if (!panel) return false;
    return panel.querySelectorAll("ytd-transcript-segment-renderer").length > 0;
  }

  function enhancePanel() {
    const panel = findTranscriptPanel();
    if (!panel) return;
    if (panel.dataset.hlEnhanced) return;
    panel.dataset.hlEnhanced = "1";
    panel.classList.add("hl-yt-enhanced");
    LOG("enhanced YouTube transcript panel");

    const header = panel.querySelector("ytd-engagement-panel-title-header-renderer")
                || panel.querySelector("#header");
    if (header && !header.querySelector(".hl-yt-hint")) {
      const hint = document.createElement("span");
      hint.className = "hl-yt-hint";
      hint.innerHTML = `<span class="hl-yt-hint-logo">✦</span> Drag-select to highlight`;
      header.appendChild(hint);
    }
  }

  async function waitForPlayerReady(timeoutMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const p = document.getElementById("movie_player");
      if (p && typeof p.getPlayerResponse === "function") {
        try {
          const pr = p.getPlayerResponse();
          if (pr && pr.videoDetails) return p;
        } catch (_) {}
      }
      await sleep(200);
    }
    return null;
  }

  function clickTranscriptButton() {
    const btn = findShowTranscriptButton();
    if (!btn) return false;
    fireRealClick(btn);
    return true;
  }

  function installFirstClickHook() {
    if (firstClickHook) return;
    LOG("installing first-click hook — auto-load failed, piggybacking on your next click");
    firstClickHook = (e) => {
      // Don't disturb the user's click — just take the gesture with us
      if (panelHasSegments()) {
        document.removeEventListener("click", firstClickHook, true);
        document.removeEventListener("pointerdown", firstClickHook, true);
        firstClickHook = null;
        return;
      }
      if (clickTranscriptButton()) {
        LOG("piggybacked transcript-open onto user click");
        setTimeout(() => {
          if (panelHasSegments()) {
            LOG("transcript loaded via gesture piggyback");
            enhancePanel();
          }
        }, 1500);
      }
      // Keep listening in case the first click happened to not produce segments
    };
    document.addEventListener("click", firstClickHook, true);
    document.addEventListener("pointerdown", firstClickHook, true);
  }

  async function tryAutoOpen() {
    LOG("attempting auto-open of transcript");
    if (panelHasSegments()) { LOG("already loaded"); enhancePanel(); return true; }
    if (!clickTranscriptButton()) {
      LOG("no transcript button on this layout — giving up auto-open");
      return false;
    }
    // Wait up to 4s for segments
    for (let i = 0; i < 20; i++) {
      await sleep(200);
      if (panelHasSegments()) {
        LOG("auto-open succeeded");
        enhancePanel();
        return true;
      }
    }
    LOG("panel didn't populate after 4s — falling back to gesture piggyback");
    return false;
  }

  async function refresh() {
    const vid = videoIdFromUrl();
    if (!vid) { LOG("not a watch page, skipping"); return; }
    if (vid === lastVideoId) return;
    lastVideoId = vid;

    const player = await waitForPlayerReady();
    if (!player) LOG("player not ready after 12s, trying anyway");
    await sleep(600);  // let the description hydrate

    const ok = await tryAutoOpen();
    if (!ok) installFirstClickHook();
  }

  // Always keep the panel styled if it opens later (e.g. user opens it manually)
  const observer = new MutationObserver(() => {
    const panel = findTranscriptPanel();
    if (panel) enhancePanel();
  });
  observer.observe(document.documentElement, { subtree: true, childList: true });

  function schedule() {
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(refresh, 350);
  }
  schedule();

  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastVideoId = null;
      schedule();
    }
  }).observe(document.documentElement, { subtree: true, childList: true });
})();
