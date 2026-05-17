// Runs in YouTube's main-world realm (not the content-script isolated world)
// so it can read window.ytInitialPlayerResponse + the live player API.
// Loaded as an extension file via chrome.runtime.getURL() because YouTube's
// CSP blocks inline <script>.
//
// Three layered approaches to find the caption tracks (since ytInitial-
// PlayerResponse can be stale after SPA navigation, and YouTube has been
// known to lazy-load captions):
//   1. Live player instance: #movie_player.getPlayerResponse()
//   2. Global window.ytInitialPlayerResponse
//   3. Re-fetch the current /watch?v=… HTML and parse ytInitialPlayerResponse
//      out of the response
(async () => {
  const videoId = new URLSearchParams(location.search).get("v");

  function post(payload) {
    window.postMessage({ source: "hl-yt", videoId, ...payload }, "*");
  }

  function tracksFromPlayerResponse(pr) {
    return pr
      && pr.captions
      && pr.captions.playerCaptionsTracklistRenderer
      && pr.captions.playerCaptionsTracklistRenderer.captionTracks;
  }

  async function getTracks() {
    // 1. Live player — most reliable, reflects the actual loaded video
    try {
      const player = document.getElementById("movie_player");
      if (player && typeof player.getPlayerResponse === "function") {
        const pr = player.getPlayerResponse();
        const tracks = tracksFromPlayerResponse(pr);
        if (tracks && tracks.length) return { tracks, src: "player" };
      }
    } catch (_) { /* fall through */ }

    // 2. Global from initial page render
    try {
      const tracks = tracksFromPlayerResponse(window.ytInitialPlayerResponse);
      if (tracks && tracks.length) return { tracks, src: "global" };
    } catch (_) { /* fall through */ }

    // 3. Re-fetch the watch HTML for a fresh player response
    if (videoId) {
      try {
        const res = await fetch("/watch?v=" + encodeURIComponent(videoId), {
          credentials: "include"
        });
        if (res.ok) {
          const html = await res.text();
          const m = html.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\})\s*;\s*var\s/)
                  || html.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\})\s*;\s*<\/script>/);
          if (m) {
            try {
              const pr = JSON.parse(m[1]);
              const tracks = tracksFromPlayerResponse(pr);
              if (tracks && tracks.length) return { tracks, src: "html" };
            } catch (_) { /* JSON malformed, fall through */ }
          }
        }
      } catch (_) { /* network failed, fall through */ }
    }

    return null;
  }

  try {
    const got = await getTracks();
    if (!got) return post({ error: "no-tracks" });

    const tracks = got.tracks;
    // Prefer manual English → any English → first available
    const eng = tracks.find(t => t.languageCode === "en" && t.kind !== "asr")
             || tracks.find(t => t.languageCode === "en")
             || tracks[0];

    // Force fmt=json3 regardless of what's already in baseUrl — sometimes
    // YouTube hands us URLs preset to srv3 (XML) which our parser can't read.
    let captionUrl;
    try {
      const u = new URL(eng.baseUrl, location.origin);
      u.searchParams.set("fmt", "json3");
      captionUrl = u.toString();
    } catch (_) {
      captionUrl = eng.baseUrl.replace(/&fmt=[^&]*/g, "") + "&fmt=json3";
    }

    const res = await fetch(captionUrl);
    if (!res.ok) return post({ error: "fetch-failed-" + res.status });
    const bodyText = await res.text();
    if (!bodyText) return post({ error: "empty-response" });
    let tx;
    try {
      tx = JSON.parse(bodyText);
    } catch (_) {
      return post({ error: "non-json-response" });
    }
    const lines = [];
    for (const ev of tx.events || []) {
      if (!ev.segs) continue;
      const text = ev.segs.map(s => s.utf8 || "").join("").replace(/\n/g, " ").trim();
      if (!text) continue;
      lines.push({ t: (ev.tStartMs || 0) / 1000, text });
    }

    // Merge very short adjacent lines into 3-8s chunks for readability
    const merged = [];
    for (const l of lines) {
      const last = merged[merged.length - 1];
      if (last && (l.t - last.t) < 3 && (last.text.length + l.text.length) < 200) {
        last.text = last.text + " " + l.text;
      } else {
        merged.push({ ...l });
      }
    }

    post({ lines: merged, source: got.src });
  } catch (e) {
    post({ error: String((e && e.message) || e) });
  }
})();
