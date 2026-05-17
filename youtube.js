// YouTube companion for Highlighter.
//
// Two jobs only:
//   1. Auto-open YouTube's native transcript panel (using a gesture
//      piggyback if YouTube refuses our scripted click).
//   2. Inject a small "drag-select to highlight" hint chip in the
//      transcript panel header once it exists.
//
// All visual styling is in youtube.css and uses attribute selectors on
// the engagement panel directly — no JS-toggled class — so YouTube
// re-renders cannot strip the styling. The MutationObserver below is
// scoped to body, debounced 500ms, and the hint chip insertion is
// idempotent so the per-mutation cost is essentially nothing.

(() => {
  if (!/(^|\.)youtube\.com$/.test(location.hostname)) return;
  if (window.__hlYouTubeLoaded) return;
  window.__hlYouTubeLoaded = true;

  const LOG = (...a) => console.info("[Highlighter/YT]", ...a);
  LOG("script loaded");

  const PANEL_SEL = 'ytd-engagement-panel-section-list-renderer[target-id*="transcript"], ytd-engagement-panel-section-list-renderer[panel-identifier*="transcript"]';

  let lastVideoId = null;
  let firstClickHook = null;
  let hintTimer = null;
  let navTimer = null;

  function videoIdFromUrl() {
    if (!location.pathname.startsWith("/watch")) return null;
    return new URLSearchParams(location.search).get("v");
  }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function findPanel() { return document.querySelector(PANEL_SEL); }
  function panelHasSegments() {
    const p = findPanel();
    return !!(p && p.querySelector("ytd-transcript-segment-renderer"));
  }

  function findShowTranscriptButton() {
    const buttons = [
      ...document.querySelectorAll(
        "ytd-video-description-transcript-section-renderer button, " +
        "ytd-button-renderer button, " +
        "tp-yt-paper-button, " +
        "yt-button-shape button, " +
        "button"
      )
    ];
    return buttons.find(b => {
      const t = (b.textContent || b.ariaLabel || b.getAttribute("aria-label") || "").trim();
      return /show transcript/i.test(t);
    }) || document.querySelector('[aria-label*="transcript" i]:not([aria-label*="close" i])');
  }

  function fireRealClick(el) {
    try { el.click(); } catch (_) {}
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      try {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true, cancelable: true, view: window, button: 0, buttons: 1
        }));
      } catch (_) {}
    }
  }

  function clickTranscriptButton() {
    const btn = findShowTranscriptButton();
    if (!btn) return false;
    fireRealClick(btn);
    return true;
  }

  function ensureHint() {
    // Debounced + idempotent. Cheap on idle.
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      const panel = findPanel();
      if (!panel) return;
      const header = panel.querySelector(
        "ytd-engagement-panel-title-header-renderer, #header"
      );
      if (!header || header.querySelector(".hl-yt-hint")) return;
      const hint = document.createElement("span");
      hint.className = "hl-yt-hint";
      hint.innerHTML = `<span class="hl-yt-hint-logo">✦</span> Drag-select to highlight`;
      header.appendChild(hint);
    }, 500);
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
      await sleep(250);
    }
    return null;
  }

  function installFirstClickHook() {
    if (firstClickHook) return;
    LOG("auto-open didn't populate — piggybacking on your next click");
    firstClickHook = () => {
      if (panelHasSegments()) {
        document.removeEventListener("click", firstClickHook, true);
        firstClickHook = null;
        return;
      }
      clickTranscriptButton();
    };
    document.addEventListener("click", firstClickHook, true);
  }

  async function tryAutoOpen() {
    if (panelHasSegments()) return true;
    if (!clickTranscriptButton()) return false;
    for (let i = 0; i < 20; i++) {
      await sleep(200);
      if (panelHasSegments()) return true;
    }
    return false;
  }

  async function refresh() {
    const vid = videoIdFromUrl();
    if (!vid || vid === lastVideoId) return;
    lastVideoId = vid;
    LOG("refreshing for", vid);
    await waitForPlayerReady();
    await sleep(600);
    const ok = await tryAutoOpen();
    if (!ok) installFirstClickHook();
  }

  // Single lightweight observer — scoped to body, no attribute watching.
  // The whole callback does nothing but schedule a debounced hint check,
  // so per-mutation cost is microseconds.
  const observer = new MutationObserver(ensureHint);
  observer.observe(document.body, { subtree: true, childList: true });

  // Initial check + SPA navigation handling
  function schedule() {
    clearTimeout(navTimer);
    navTimer = setTimeout(refresh, 350);
  }
  schedule();
  ensureHint();

  let lastUrl = location.href;
  // SPA URL change watcher — also lightweight; only re-arms on URL change
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastVideoId = null;
      schedule();
    }
  }, 800);
})();
