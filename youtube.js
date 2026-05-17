// YouTube transcript companion for Highlighter.
//
// On any youtube.com/watch?v=… page, this script injects a transcript panel
// above the right-side recommendations. The transcript is rendered as
// selectable lines with click-to-seek timestamps. Selecting any text in the
// transcript triggers the normal Highlighter selection toolbar — so all the
// usual highlighting / folders / comments / sharing flows just work,
// scoped per video.
//
// SPA navigation between videos is handled; the panel rebuilds itself when
// the ?v=… param changes.

(() => {
  if (!/(^|\.)youtube\.com$/.test(location.hostname)) return;
  if (window.__hlYouTubeLoaded) return;
  window.__hlYouTubeLoaded = true;

  const LOG = (...a) => console.info("[Highlighter/YT]", ...a);
  LOG("script loaded on", location.href);

  let lastVideoId = null;
  let panel = null;
  let pendingTimer = null;
  let keepAliveObserver = null;

  // YouTube uses different right-column containers depending on layout /
  // experiments. Try them in order until one is in the DOM.
  const CONTAINER_SELECTORS = [
    "#secondary-inner",
    "#secondary",
    "ytd-watch-next-secondary-results-renderer",
    "#related",
    "ytd-watch-grid #related"
  ];

  function videoIdFromUrl() {
    if (!location.pathname.startsWith("/watch")) return null;
    return new URLSearchParams(location.search).get("v");
  }

  function findContainer() {
    for (const sel of CONTAINER_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return { el, sel };
    }
    return null;
  }

  function waitForContainer(timeoutMs = 15000) {
    return new Promise(resolve => {
      const initial = findContainer();
      if (initial) return resolve(initial);
      const start = Date.now();
      const obs = new MutationObserver(() => {
        const got = findContainer();
        if (got) { obs.disconnect(); resolve(got); }
        else if (Date.now() - start > timeoutMs) { obs.disconnect(); resolve(null); }
      });
      obs.observe(document.documentElement, { subtree: true, childList: true });
    });
  }

  function buildPanel() {
    if (panel && panel.isConnected) return;
    panel = document.createElement("div");
    panel.id = "hl-yt-panel";
    panel.innerHTML = `
      <div class="hl-yt-head">
        <span class="hl-yt-logo">✦</span>
        <span class="hl-yt-title">Transcript</span>
        <span class="hl-yt-status"></span>
        <input class="hl-yt-search" type="search" placeholder="Search…">
      </div>
      <div class="hl-yt-body">
        <div class="hl-yt-empty">Loading transcript…</div>
      </div>
    `;
    return panel;
  }

  async function ensurePanelInDom() {
    const container = await waitForContainer();
    if (!container) {
      LOG("could not find a sidebar container — layout may have changed");
      return null;
    }
    LOG("using container", container.sel);
    if (!panel || !panel.isConnected) buildPanel();
    if (panel.parentElement !== container.el) {
      container.el.insertBefore(panel, container.el.firstChild);
    }
    wireSearch();
    // If YouTube's polymer wipes the container, re-insert
    if (keepAliveObserver) keepAliveObserver.disconnect();
    keepAliveObserver = new MutationObserver(() => {
      if (!panel.isConnected) {
        const c = findContainer();
        if (c) c.el.insertBefore(panel, c.el.firstChild);
      }
    });
    keepAliveObserver.observe(document.body, { childList: true, subtree: true });
    return panel;
  }

  function setStatus(text) {
    if (!panel) return;
    const el = panel.querySelector(".hl-yt-status");
    if (el) el.textContent = text || "";
  }

  function setBody(html) {
    if (!panel) return;
    panel.querySelector(".hl-yt-body").innerHTML = html;
  }

  function formatTime(t) {
    const total = Math.max(0, Math.floor(t));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0
      ? `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
      : `${m}:${s.toString().padStart(2, "0")}`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function renderLines(lines) {
    if (!lines || !lines.length) {
      setBody(`<div class="hl-yt-empty">No transcript available for this video.</div>`);
      return;
    }
    const html = lines.map(l => `
      <div class="hl-yt-line" data-t="${l.t}">
        <button class="hl-yt-ts" type="button">${formatTime(l.t)}</button>
        <span class="hl-yt-text">${escapeHtml(l.text)}</span>
      </div>
    `).join("");
    setBody(html);
    wireSeek();
  }

  function wireSeek() {
    const body = panel.querySelector(".hl-yt-body");
    body.addEventListener("click", e => {
      // Only seek when the timestamp pill is clicked — leave text alone so
      // the user can select & highlight freely
      const ts = e.target.closest(".hl-yt-ts");
      if (!ts) return;
      const line = ts.closest(".hl-yt-line");
      const t = parseFloat(line?.dataset.t || "0");
      const video = document.querySelector("video");
      if (video) { video.currentTime = t; video.play().catch(() => {}); }
    });
  }

  function wireSearch() {
    const search = panel.querySelector(".hl-yt-search");
    if (!search || search.__wired) return;
    search.__wired = true;
    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      const lines = panel.querySelectorAll(".hl-yt-line");
      let visible = 0;
      lines.forEach(line => {
        const txt = line.querySelector(".hl-yt-text")?.textContent.toLowerCase() || "";
        const show = !q || txt.includes(q);
        line.style.display = show ? "" : "none";
        if (show) visible++;
      });
      setStatus(q ? `${visible} of ${lines.length} lines` : "");
    });
  }

  // Fetching the transcript needs access to window.ytInitialPlayerResponse,
  // which lives in the page's main-world realm — content scripts can't see
  // it. YouTube's CSP blocks inline scripts, so we load a file from the
  // extension instead. We pass the target video id via a window hint set
  // immediately before the script element is appended.
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function parseTimeString(s) {
    const parts = (s || "").trim().split(":").map(p => parseInt(p, 10) || 0);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
  }

  async function waitForAny(selectors, timeoutMs = 4000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        if (els.length) return Array.from(els);
      }
      await sleep(150);
    }
    return null;
  }

  function findShowTranscriptButton() {
    // Several places to look — YouTube moves this around
    const candidates = [
      ...document.querySelectorAll(
        "ytd-video-description-transcript-section-renderer button, " +
        "ytd-button-renderer button, " +
        "tp-yt-paper-button, " +
        "yt-button-shape button, " +
        "button"
      )
    ];
    return candidates.find(b => {
      const t = (b.textContent || b.ariaLabel || b.getAttribute("aria-label") || "").trim();
      return /show transcript/i.test(t);
    }) || document.querySelector('[aria-label*="transcript" i]:not([aria-label*="close" i])');
  }

  // Primary method: open YouTube's own transcript panel and read its rendered
  // segments. Works on any video where the transcript button is offered, since
  // we're reading the same data YouTube itself shows.
  function fireRealClick(el) {
    // Some YT buttons want a richer event sequence to fire their Polymer
    // bindings reliably.
    try { el.click(); } catch (_) {}
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); } catch (_) {}
    }
  }

  async function waitForInside(parent, selectors, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      for (const sel of selectors) {
        const els = parent.querySelectorAll(sel);
        if (els.length) return Array.from(els);
      }
      await sleep(200);
    }
    return null;
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  async function getTranscriptFromUi() {
    LOG("UI method: looking for 'Show transcript' button");
    let btn = findShowTranscriptButton();
    if (btn) LOG("  found button immediately:", btn.tagName, btn.textContent?.trim().slice(0, 40));

    if (!btn) {
      LOG("  not visible; expanding description first");
      const expand = document.querySelector("tp-yt-paper-button#expand")
                  || document.querySelector("#expand");
      if (expand) {
        fireRealClick(expand);
        await sleep(600);
        btn = findShowTranscriptButton();
        if (btn) LOG("  found button after expand");
      } else {
        LOG("  no expand button either");
      }
    }
    if (!btn) return { error: "no-transcript-button" };

    LOG("UI method: clicking button (rich event sequence)");
    fireRealClick(btn);

    // Wait up to 10s for the transcript engagement panel to appear AND be visible
    LOG("UI method: waiting for engagement panel (transcript) to open");
    const PANEL_SELS = [
      'ytd-engagement-panel-section-list-renderer[target-id*="transcript"]',
      'ytd-engagement-panel-section-list-renderer[panel-identifier*="transcript"]',
      'ytd-transcript-renderer',
      'ytd-transcript-search-panel-renderer'
    ];
    let transcriptPanelEl = null;
    const panelStart = Date.now();
    while (Date.now() - panelStart < 10000) {
      for (const sel of PANEL_SELS) {
        const el = document.querySelector(sel);
        if (el && isVisible(el)) { transcriptPanelEl = el; break; }
      }
      if (transcriptPanelEl) break;
      await sleep(200);
    }
    if (!transcriptPanelEl) {
      LOG("  engagement panel never opened — clicking once more");
      fireRealClick(btn);
      await sleep(800);
      transcriptPanelEl = PANEL_SELS.map(s => document.querySelector(s)).find(Boolean);
    }
    if (!transcriptPanelEl) {
      LOG("  panel still missing after 10s, giving up on UI method");
      return { error: "panel-never-opened" };
    }
    LOG("  panel found:", transcriptPanelEl.tagName);

    // Now wait up to 12s for segments inside the panel
    LOG("UI method: waiting for transcript segments inside the panel");
    const segments = await waitForInside(transcriptPanelEl, [
      "ytd-transcript-segment-renderer",
      "[class*='transcript-segment']",
      "ytd-transcript-segment-list-renderer ytd-transcript-segment-renderer"
    ], 12000);
    if (!segments || !segments.length) {
      LOG("  panel opened but no segments inside after 12s");
      return { error: "no-segments-in-panel" };
    }
    LOG("UI method: got", segments.length, "segments");

    const lines = [];
    for (const seg of segments) {
      const timeEl = seg.querySelector(".segment-timestamp, [class*='timestamp']");
      const textEl = seg.querySelector(".segment-text, yt-formatted-string.segment-text, [class*='segment-text']");
      const text = (textEl?.textContent || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      lines.push({ t: parseTimeString(timeEl?.textContent), text });
    }
    if (!lines.length) return { error: "no-segments" };

    // Close YouTube's native transcript panel to give our panel the space back
    const close = document.querySelector(
      'ytd-engagement-panel-section-list-renderer[target-id*="transcript"] button[aria-label*="lose" i], ' +
      'ytd-engagement-panel-title-header-renderer button[aria-label*="lose" i]'
    );
    close?.click();

    return { lines };
  }

  // Fallback: page-world script that tries multiple caption-fetch formats
  function injectPageFetcher() {
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("youtube-page.js");
    s.addEventListener("load", () => s.remove());
    (document.head || document.documentElement).appendChild(s);
  }

  async function fetchTranscript(videoId) {
    setBody(`<div class="hl-yt-empty">Loading transcript…</div>`);

    // 1) Try YouTube's own UI first
    const uiResult = await getTranscriptFromUi();
    if (uiResult.lines) {
      LOG("transcript loaded via UI:", uiResult.lines.length, "lines");
      renderMerged(uiResult.lines);
      return;
    }
    LOG("UI method failed:", uiResult.error, "— falling back to fetch");

    // 2) Fall back to the page-world fetch with multiple format attempts
    //    (kept for the small fraction of videos where it works). We wait
    //    briefly for the result and only show the manual button if it fails.
    injectPageFetcher();
    showManualLoadFallback(uiResult.error);
  }

  function renderMerged(lines) {
    const merged = [];
    for (const l of lines) {
      const last = merged[merged.length - 1];
      if (last && (l.t - last.t) < 3 && (last.text.length + l.text.length) < 200) {
        last.text = last.text + " " + l.text;
      } else {
        merged.push({ ...l });
      }
    }
    renderLines(merged);
    window.dispatchEvent(new CustomEvent("hl-yt-rendered"));
  }

  // YouTube blocks programmatic caption loads — segments only populate
  // when a real user gesture triggers the transcript panel. This fallback
  // surfaces a button so the click chain originates from the user.
  function showManualLoadFallback(reason) {
    setBody(`
      <div class="hl-yt-empty" style="padding: 24px 16px;">
        <div style="font-size: 14px; color: rgba(250,250,250,0.9); margin-bottom: 8px;">
          YouTube blocked the auto-load
        </div>
        <div style="margin-bottom: 16px; font-size: 12px; line-height: 1.5;">
          They require a real user click to release the transcript data.
          Press the button below and the transcript will load here.
        </div>
        <button id="hl-yt-load" style="
          background: #6366f1; border: none; color: #fff;
          padding: 10px 18px; border-radius: 8px;
          font: inherit; font-weight: 500; font-size: 13px;
          cursor: pointer;
        ">Load transcript</button>
      </div>
    `);
    const btn = panel?.querySelector("#hl-yt-load");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Loading…";
      // Real user gesture is live here — click YouTube's button synchronously
      const ytBtn = findShowTranscriptButton();
      if (!ytBtn) {
        setBody(`<div class="hl-yt-empty">Couldn't find YouTube's transcript button on this layout.</div>`);
        return;
      }
      fireRealClick(ytBtn);
      // Now wait for segments — with a real gesture, YouTube will fill the panel
      const lines = await waitForUserTriggeredSegments();
      if (!lines.length) {
        setBody(`<div class="hl-yt-empty">YouTube didn't load segments even with a real click — this video may not have a usable transcript.</div>`);
        return;
      }
      renderMerged(lines);
    });
  }

  async function waitForUserTriggeredSegments() {
    // Panel may open in any of these containers; segments may appear under any
    const PANEL_SELS = [
      'ytd-engagement-panel-section-list-renderer[target-id*="transcript"]',
      'ytd-engagement-panel-section-list-renderer[panel-identifier*="transcript"]',
      'ytd-transcript-renderer',
      'ytd-transcript-search-panel-renderer'
    ];
    const start = Date.now();
    while (Date.now() - start < 15000) {
      for (const sel of PANEL_SELS) {
        const p = document.querySelector(sel);
        if (!p) continue;
        const segs = p.querySelectorAll("ytd-transcript-segment-renderer, [class*='transcript-segment']");
        if (segs.length) {
          const out = [];
          for (const seg of segs) {
            const timeEl = seg.querySelector(".segment-timestamp, [class*='timestamp']");
            const textEl = seg.querySelector(".segment-text, yt-formatted-string.segment-text, [class*='segment-text']");
            const text = (textEl?.textContent || "").replace(/\s+/g, " ").trim();
            if (!text) continue;
            out.push({ t: parseTimeString(timeEl?.textContent), text });
          }
          if (out.length) return out;
        }
      }
      await sleep(200);
    }
    return [];
  }

  window.addEventListener("message", e => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== "hl-yt") return;
    if (d.videoId !== lastVideoId) return;  // ignore stale results from previous video
    if (d.error) {
      const msg = d.error === "no-tracks"
        ? "This video has no transcript / captions."
        : "Couldn't load transcript (" + d.error + ")";
      setBody(`<div class="hl-yt-empty">${escapeHtml(msg)}</div>`);
      return;
    }
    LOG("transcript loaded via fetcher:", (d.lines || []).length, "lines from", d.source);
    renderMerged(d.lines || []);
  });

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

  async function refresh() {
    const vid = videoIdFromUrl();
    if (!vid) { LOG("not a watch page, skipping"); return; }
    if (vid === lastVideoId && panel && panel.isConnected) return;
    LOG("refreshing for video", vid);
    lastVideoId = vid;
    const p = await ensurePanelInDom();
    if (!p) { LOG("ensurePanelInDom failed — no container"); return; }

    setBody(`<div class="hl-yt-empty">Waiting for player…</div>`);
    const player = await waitForPlayerReady();
    if (!player) {
      LOG("player not ready after 12s, attempting transcript anyway");
    } else {
      LOG("player ready");
    }
    // Give YouTube an extra moment to wire the description / engagement panels
    await sleep(800);
    fetchTranscript(vid);
  }

  // Initial run + watch for SPA navigation
  function schedule() {
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(refresh, 350);
  }

  schedule();
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      schedule();
    }
  }).observe(document.documentElement, { subtree: true, childList: true });
})();
