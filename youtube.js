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

  let lastVideoId = null;
  let panel = null;
  let pendingTimer = null;

  function videoIdFromUrl() {
    if (!location.pathname.startsWith("/watch")) return null;
    return new URLSearchParams(location.search).get("v");
  }

  function waitForElement(selector, timeoutMs = 8000) {
    return new Promise(resolve => {
      const found = document.querySelector(selector);
      if (found) return resolve(found);
      const start = Date.now();
      const obs = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) { obs.disconnect(); resolve(el); }
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
    const secondary = await waitForElement("#secondary");
    if (!secondary) return null;
    if (!panel || !panel.isConnected) buildPanel();
    if (panel.parentElement !== secondary) {
      secondary.insertBefore(panel, secondary.firstChild);
    }
    wireSearch();
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
  // it. So we inject a tiny script that does the fetch in page-world and
  // postMessages the result back.
  function fetchTranscript(videoId) {
    setBody(`<div class="hl-yt-empty">Loading transcript…</div>`);
    const code = `
      (async () => {
        function post(payload) {
          window.postMessage({ source: "hl-yt", videoId: ${JSON.stringify(videoId)}, ...payload }, "*");
        }
        try {
          const data = window.ytInitialPlayerResponse;
          const tracks = data && data.captions && data.captions.playerCaptionsTracklistRenderer && data.captions.playerCaptionsTracklistRenderer.captionTracks;
          if (!tracks || !tracks.length) return post({ error: "no-tracks" });
          // Prefer non-auto English, then any English, then first track
          const eng = tracks.find(t => t.languageCode === "en" && t.kind !== "asr")
                   || tracks.find(t => t.languageCode === "en")
                   || tracks[0];
          const res = await fetch(eng.baseUrl + "&fmt=json3");
          if (!res.ok) return post({ error: "fetch-failed-" + res.status });
          const tx = await res.json();
          const lines = [];
          for (const ev of tx.events || []) {
            if (!ev.segs) continue;
            const text = ev.segs.map(s => s.utf8 || "").join("").replace(/\\n/g, " ").trim();
            if (!text) continue;
            lines.push({ t: (ev.tStartMs || 0) / 1000, text });
          }
          // Group very short adjacent lines into more readable chunks (~3-8s)
          const merged = [];
          for (const l of lines) {
            const last = merged[merged.length - 1];
            if (last && (l.t - last.t) < 3 && (last.text.length + l.text.length) < 200) {
              last.text = last.text + " " + l.text;
            } else {
              merged.push({ ...l });
            }
          }
          post({ lines: merged });
        } catch (e) {
          post({ error: String(e && e.message || e) });
        }
      })();
    `;
    const s = document.createElement("script");
    s.textContent = code;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
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
    renderLines(d.lines || []);
    // Let the rest of the extension know our panel is ready so any saved
    // highlights for this video can be re-applied
    window.dispatchEvent(new CustomEvent("hl-yt-rendered"));
  });

  async function refresh() {
    const vid = videoIdFromUrl();
    if (!vid) return;
    if (vid === lastVideoId && panel && panel.isConnected) return;
    lastVideoId = vid;
    await ensurePanelInDom();
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
