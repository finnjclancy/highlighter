// Runs in YouTube's main-world realm (not the content-script isolated world)
// so it can read window.ytInitialPlayerResponse. Loaded as an extension file
// via chrome.runtime.getURL() because YouTube's CSP blocks inline <script>.
//
// Reads the current video id from location.search and postMessages results
// back to the content script via window.postMessage.
(async () => {
  const videoId = new URLSearchParams(location.search).get("v");

  function post(payload) {
    window.postMessage({ source: "hl-yt", videoId, ...payload }, "*");
  }

  try {
    const data = window.ytInitialPlayerResponse;
    const tracks = data
      && data.captions
      && data.captions.playerCaptionsTracklistRenderer
      && data.captions.playerCaptionsTracklistRenderer.captionTracks;
    if (!tracks || !tracks.length) return post({ error: "no-tracks" });

    // Prefer manual English → any English → first available
    const eng = tracks.find(t => t.languageCode === "en" && t.kind !== "asr")
             || tracks.find(t => t.languageCode === "en")
             || tracks[0];

    const res = await fetch(eng.baseUrl + "&fmt=json3");
    if (!res.ok) return post({ error: "fetch-failed-" + res.status });

    const tx = await res.json();
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

    post({ lines: merged });
  } catch (e) {
    post({ error: String((e && e.message) || e) });
  }
})();
