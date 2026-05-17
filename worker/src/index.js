// Cloudflare Worker for Highlighter share URLs.
//
// Why this exists: messaging apps (iMessage, Slack, WhatsApp, etc.) generate
// link-preview cards by SCRAPING the page's HTML on the server side. They
// don't run JavaScript, so any <title> / og:* tags injected client-side are
// invisible to them. This Worker decodes the share payload from the URL,
// pulls out the custom name + title + count, and serves HTML with proper
// per-link meta tags BEFORE any JavaScript runs.
//
// The page body still includes the existing v.js viewer from GitHub Pages,
// so the rendered gallery is unchanged for actual visitors.

const STATIC_BASE = "https://finnjclancy.github.io/highlighter";
const PROMO_IMAGE = STATIC_BASE + "/icons/promo-440x280.png";

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // /v?d=<payload>  — render a share gallery with custom OG tags
    if (url.pathname === "/v" || url.pathname === "/v.html") {
      const enc = url.searchParams.get("d");
      if (!enc) return Response.redirect(STATIC_BASE + "/", 302);
      const meta = await decodeMetadata(enc);
      return renderHtml(meta, enc);
    }

    // Anything else → landing page
    return Response.redirect(STATIC_BASE + "/", 302);
  }
};

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
  <script src="${STATIC_BASE}/v.js?v=3"></script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html;charset=utf-8",
      // Cache previews for an hour at the edge; long enough to be fast,
      // short enough that re-shares with edited names refresh quickly.
      "cache-control": "public, max-age=300, s-maxage=3600"
    }
  });
}
