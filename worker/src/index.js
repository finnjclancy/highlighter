// Cloudflare Worker for Highlighter share URLs.
//
// Two URL shapes:
//   • short:  /v/<id>           — looks up the payload in KV (preferred)
//   • inline: /v?d=<payload>    — payload baked into the URL (legacy / fallback)
//
// Both render HTML with per-link Open Graph meta tags so messaging-app
// preview cards show the share's custom name + description + image,
// instead of the generic "Shared highlights — Highlighter".
//
// The body still loads v.js from GitHub Pages, which decodes the payload
// (either from window.__hlPayload, injected inline, or from ?d=) and
// renders the actual gallery.

const STATIC_BASE = "https://finnjclancy.github.io/highlighter";
const PROMO_IMAGE = STATIC_BASE + "/og-image.png";
const ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // dropped o/l/1/0
const ID_LENGTH = 8;
const KV_TTL_SECONDS = 60 * 60 * 24 * 365; // 1 year

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "content-type"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // POST /api/shorten  { payload: "<gzipped-base64url-payload>" }
    //   → { id, url }
    if (request.method === "POST" && url.pathname === "/api/shorten") {
      try {
        const body = await request.json();
        const payload = (body && body.payload) ? String(body.payload) : null;
        if (!payload || payload.length > 200_000) {
          return json({ error: "missing or too-large payload" }, 400);
        }
        // Try a few times in the (extremely unlikely) event of collision
        let id = randomId(ID_LENGTH);
        for (let i = 0; i < 5; i++) {
          const existing = await env.HIGHLIGHTS.get(id);
          if (!existing) break;
          id = randomId(ID_LENGTH);
        }
        await env.HIGHLIGHTS.put(id, payload, { expirationTtl: KV_TTL_SECONDS });
        return json({ id, url: url.origin + "/v/" + id }, 200);
      } catch (e) {
        return json({ error: "bad request" }, 400);
      }
    }

    // GET /v/<id>  — short link, looked up in KV
    if (url.pathname.startsWith("/v/")) {
      const id = url.pathname.slice(3).replace(/[^a-z0-9]/gi, "");
      if (!id) return Response.redirect(STATIC_BASE + "/", 302);
      const enc = await env.HIGHLIGHTS.get(id);
      if (!enc) return notFound();
      const meta = await decodeMetadata(enc);
      return renderHtml(meta, enc);
    }

    // GET /v?d=<payload>  — inline / legacy long URL
    if (url.pathname === "/v" || url.pathname === "/v.html") {
      const enc = url.searchParams.get("d");
      if (!enc) return Response.redirect(STATIC_BASE + "/", 302);
      const meta = await decodeMetadata(enc);
      return renderHtml(meta, enc);
    }

    return Response.redirect(STATIC_BASE + "/", 302);
  }
};

function randomId(len) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return out;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS }
  });
}

function b64UrlToBytes(s) {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

async function decodeMetadata(enc) {
  const fallback = { name: "Shared highlights", title: "", url: "", count: 0 };
  try {
    let json;
    if (enc.charAt(0) === "z") {
      const bytes = b64UrlToBytes(enc.slice(1));
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      json = await new Response(stream).text();
    } else {
      json = new TextDecoder().decode(b64UrlToBytes(enc));
    }
    const data = JSON.parse(json);
    return {
      name: (data.name && data.name.trim()) || data.title || fallback.name,
      title: data.title || "",
      url: data.url || "",
      count: Array.isArray(data.highlights) ? data.highlights.length : 0
    };
  } catch (e) {
    return fallback;
  }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function hostnameOf(u) {
  try { return new URL(u).hostname; } catch { return ""; }
}

function notFound() {
  const html = `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <title>Link not found — Highlighter</title>
  <link rel="stylesheet" href="${STATIC_BASE}/styles.css">
</head><body>
  <div class="wrap">
    <header class="brand"><span class="logo">✦</span><h1>Highlighter</h1></header>
    <h2 class="page-title">Link not found</h2>
    <p style="color:rgba(250,250,250,0.6);">This share link is invalid or has expired.</p>
    <p><a href="${STATIC_BASE}/">Back to Highlighter →</a></p>
  </div>
</body></html>`;
  return new Response(html, { status: 404, headers: { "content-type": "text/html;charset=utf-8" } });
}

function renderHtml(meta, enc) {
  const title = `${meta.name} — Highlighter`;
  const host = hostnameOf(meta.url);
  const descParts = [];
  if (meta.count) descParts.push(`${meta.count} highlight${meta.count === 1 ? "" : "s"}`);
  if (meta.title) descParts.push(`from ${meta.title}`);
  else if (host) descParts.push(`from ${host}`);
  const description = descParts.join(" ") || "Shared highlights from Highlighter";

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">

  <!-- Open Graph -->
  <meta property="og:title" content="${escapeHtml(meta.name)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${escapeHtml(PROMO_IMAGE)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Highlighter">

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(meta.name)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(PROMO_IMAGE)}">

  <link rel="stylesheet" href="${STATIC_BASE}/styles.css">
  <meta name="robots" content="noindex">
  <script>window.__hlPayload = ${JSON.stringify(enc)};</script>
</head>
<body>
  <div class="wrap">
    <header class="brand">
      <span class="logo">✦</span>
      <h1>Highlighter</h1>
      <span class="sep">·</span>
      <span style="color:var(--text-3);font-size:13px;">Shared highlights</span>
    </header>
    <div id="content"></div>
    <footer class="foot">
      Want to highlight pages yourself? <a href="${STATIC_BASE}/">Get the Highlighter extension →</a>
    </footer>
  </div>
  <script src="${STATIC_BASE}/v.js?v=6"></script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html;charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=3600"
    }
  });
}
