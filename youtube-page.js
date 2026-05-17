// Runs in YouTube's main-world realm so it can read ytInitialPlayerResponse
// and use the live player API. Loaded via chrome.runtime.getURL() because
// YouTube's CSP blocks inline <script>.
(async () => {
  const videoId = new URLSearchParams(location.search).get("v");

  const LOG = (...a) => console.info("[Highlighter/YT-page]", ...a);
  LOG("page-fetcher started for", videoId);

  function post(payload) {
    LOG("posting", payload.error ? "error: " + payload.error : (payload.lines?.length || 0) + " lines");
    window.postMessage({ source: "hl-yt", videoId, ...payload }, "*");
  }

  function tracksFromPlayerResponse(pr) {
    return pr
      && pr.captions
      && pr.captions.playerCaptionsTracklistRenderer
      && pr.captions.playerCaptionsTracklistRenderer.captionTracks;
  }

  async function getTracks() {
    LOG("trying source: player.getPlayerResponse()");
    try {
      const player = document.getElementById("movie_player");
      if (player && typeof player.getPlayerResponse === "function") {
        const tracks = tracksFromPlayerResponse(player.getPlayerResponse());
        if (tracks && tracks.length) { LOG("  player provided", tracks.length, "tracks"); return { tracks, src: "player" }; }
        LOG("  player has no caption tracks");
      } else { LOG("  player not available"); }
    } catch (e) { LOG("  player source threw:", e.message); }

    LOG("trying source: window.ytInitialPlayerResponse");
    try {
      const tracks = tracksFromPlayerResponse(window.ytInitialPlayerResponse);
      if (tracks && tracks.length) { LOG("  global provided", tracks.length, "tracks"); return { tracks, src: "global" }; }
      LOG("  global has no caption tracks");
    } catch (e) { LOG("  global source threw:", e.message); }

    if (videoId) {
      LOG("trying source: re-fetch /watch?v=" + videoId);
      try {
        const res = await fetch("/watch?v=" + encodeURIComponent(videoId), { credentials: "include" });
        LOG("  /watch returned", res.status);
        if (res.ok) {
          const html = await res.text();
          const m = html.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\})\s*;\s*var\s/)
                  || html.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\})\s*;\s*<\/script>/);
          if (!m) LOG("  couldn't find ytInitialPlayerResponse in HTML");
          else {
            try {
              const tracks = tracksFromPlayerResponse(JSON.parse(m[1]));
              if (tracks && tracks.length) { LOG("  html provided", tracks.length, "tracks"); return { tracks, src: "html" }; }
              LOG("  html parsed but no caption tracks present");
            } catch (e) { LOG("  html JSON parse failed:", e.message); }
          }
        }
      } catch (e) { LOG("  /watch fetch threw:", e.message); }
    }
    return null;
  }

  function urlWithFmt(baseUrl, fmt) {
    try {
      const u = new URL(baseUrl, location.origin);
      u.searchParams.set("fmt", fmt);
      return u.toString();
    } catch (_) {
      return baseUrl.replace(/[?&]fmt=[^&]*/g, "") + (baseUrl.includes("?") ? "&" : "?") + "fmt=" + fmt;
    }
  }

  function parseJson3(text) {
    const json = JSON.parse(text);
    const out = [];
    for (const ev of json.events || []) {
      if (!ev.segs) continue;
      const t = (ev.segs.map(s => s.utf8 || "").join("")).replace(/\n/g, " ").trim();
      if (!t) continue;
      out.push({ t: (ev.tStartMs || 0) / 1000, text: t });
    }
    return out;
  }

  function parseSrv3(xmlText) {
    // <p t="ms" d="ms"><s>chunk</s>…</p>
    const doc = new DOMParser().parseFromString(xmlText, "text/xml");
    const out = [];
    for (const p of doc.querySelectorAll("p")) {
      const t = parseInt(p.getAttribute("t") || "0", 10) / 1000;
      const text = p.textContent.replace(/\n/g, " ").trim();
      if (!text) continue;
      out.push({ t, text });
    }
    return out;
  }

  function parseSrv1(xmlText) {
    // <text start="sec" dur="sec">…</text>
    const doc = new DOMParser().parseFromString(xmlText, "text/xml");
    const out = [];
    for (const node of doc.querySelectorAll("text")) {
      const t = parseFloat(node.getAttribute("start") || "0");
      const text = decodeEntities(node.textContent).replace(/\n/g, " ").trim();
      if (!text) continue;
      out.push({ t, text });
    }
    return out;
  }

  function decodeEntities(s) {
    const ta = document.createElement("textarea");
    ta.innerHTML = s;
    return ta.value;
  }

  async function fetchCaptions(baseUrl) {
    const attempts = [
      { fmt: "json3", parse: parseJson3 },
      { fmt: "srv3",  parse: parseSrv3  },
      { fmt: "srv1",  parse: parseSrv1  },
      { fmt: "",      parse: parseSrv3  }  // raw baseUrl as last resort
    ];
    let lastErr = "empty-response";
    for (const attempt of attempts) {
      const url = attempt.fmt ? urlWithFmt(baseUrl, attempt.fmt) : baseUrl;
      LOG("fetching transcript", attempt.fmt || "raw", "→", url.slice(0, 140) + (url.length > 140 ? "…" : ""));
      try {
        const res = await fetch(url, { credentials: "include" });
        LOG("  status", res.status, "content-type", res.headers.get("content-type"));
        if (!res.ok) { lastErr = "http-" + res.status; continue; }
        const body = await res.text();
        LOG("  body length", body.length);
        if (!body || body.length < 20) { lastErr = "empty"; continue; }
        try {
          const lines = attempt.parse(body);
          if (lines && lines.length) { LOG("  parsed", lines.length, "lines"); return { lines, fmt: attempt.fmt || "raw" }; }
          LOG("  parser returned 0 lines");
          lastErr = "no-lines-" + (attempt.fmt || "raw");
        } catch (e) {
          LOG("  parser threw:", e.message);
          lastErr = "parse-" + (attempt.fmt || "raw");
        }
      } catch (e) {
        LOG("  fetch threw:", e.message);
        lastErr = "fetch-" + (attempt.fmt || "raw");
      }
    }
    return { error: lastErr };
  }

  try {
    const got = await getTracks();
    if (!got) return post({ error: "no-tracks" });

    const tracks = got.tracks;
    const eng = tracks.find(t => t.languageCode === "en" && t.kind !== "asr")
             || tracks.find(t => t.languageCode === "en")
             || tracks[0];

    const result = await fetchCaptions(eng.baseUrl);
    if (result.error) return post({ error: result.error });

    // Merge very short adjacent lines into 3-8s chunks for readability
    const lines = result.lines;
    const merged = [];
    for (const l of lines) {
      const last = merged[merged.length - 1];
      if (last && (l.t - last.t) < 3 && (last.text.length + l.text.length) < 200) {
        last.text = last.text + " " + l.text;
      } else {
        merged.push({ ...l });
      }
    }

    post({ lines: merged, source: got.src, fmt: result.fmt });
  } catch (e) {
    post({ error: String((e && e.message) || e) });
  }
})();
