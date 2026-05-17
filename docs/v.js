// Decode a shared-highlights payload from the URL and render it as a clean
// gallery with a "View on original page" button.

function b64UrlToBytes(s) {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}
function b64UrlToUtf8(s) {
  return new TextDecoder().decode(b64UrlToBytes(s));
}

async function gunzipB64Url(s) {
  if (typeof DecompressionStream === "undefined") throw new Error("no DecompressionStream");
  const bytes = b64UrlToBytes(s);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

async function decodeShareEnc(enc) {
  // New format: 'z' prefix means gzipped; rest is base64url.
  // Legacy: raw base64url-encoded JSON.
  if (enc.charAt(0) === "z") {
    try { return await gunzipB64Url(enc.slice(1)); } catch {}
  }
  try { return b64UrlToUtf8(enc); } catch { return null; }
}

function escape(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function renderEmpty(message, hint) {
  const root = document.getElementById("content");
  root.innerHTML = `
    <div class="empty">
      <h2>${escape(message)}</h2>
      ${hint ? `<div>${escape(hint)}</div>` : ""}
    </div>`;
}

async function decodePayload() {
  // Worker can inject the payload server-side as window.__hlPayload (short
  // links). Fall back to the ?d= query param for inline/legacy URLs.
  let enc = (typeof window !== "undefined" && window.__hlPayload) || null;
  if (!enc) {
    const params = new URLSearchParams(location.search);
    enc = params.get("d");
  }
  if (!enc) return null;
  const json = await decodeShareEnc(enc);
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
}

function buildLiveLink(payload) {
  // Append the original payload back to the source URL so people with the
  // extension installed get the highlights painted on the real page.
  if (!payload.url) return null;
  try {
    const u = new URL(payload.url);
    const enc = new URLSearchParams(location.search).get("d");
    if (enc) u.searchParams.set("hlshare", enc);
    return u.toString();
  } catch { return payload.url; }
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

async function init() {
  const payload = await decodePayload();
  if (!payload || !Array.isArray(payload.highlights) || !payload.highlights.length) {
    renderEmpty("No highlights here", "This link doesn't seem to carry any shared highlights.");
    return;
  }

  const root = document.getElementById("content");
  const displayName = (payload.name && payload.name.trim()) || payload.title || hostOf(payload.url) || "Shared highlights";
  const subTitle = payload.name ? (payload.title || hostOf(payload.url)) : "";
  const count = payload.highlights.length;
  const live = buildLiveLink(payload);

  // Update the browser-tab title so the user sees the custom name when the
  // page is open. (Link-preview thumbnails in chat apps don't reflect this —
  // they rely on the static <meta> tags fetched by their scrapers.)
  document.title = displayName + " — Highlighter";

  let html = `
    <h2 class="page-title">${escape(displayName)}</h2>
    <div class="meta">
      ${subTitle ? `<span>${escape(subTitle)}</span><span class="sep">·</span>` : ""}
      <a href="${escape(payload.url || "#")}" target="_blank" rel="noopener">${escape(hostOf(payload.url) || "Open source")}</a>
      <span class="sep">·</span>
      <span>${count} ${count === 1 ? "highlight" : "highlights"}</span>
    </div>
    <div class="cta-row">
      ${live ? `<a class="cta" href="${escape(live)}" rel="noopener">Open on original page →</a>` : ""}
      <a class="cta cta-secondary" href="index.html">About Highlighter</a>
    </div>
    <div class="cards">
  `;

  payload.highlights.forEach(h => {
    const tags = (h.tags || []).map(t => `<span class="chip">#${escape(t)}</span>`).join("");
    const note = h.note ? `<div class="note">${escape(h.note)}</div>` : "";
    html += `
      <div class="card">
        <span class="swatch" style="background:${escape(h.bg || "#fff")}"></span>
        <span class="quote" style="background:${escape(h.bg || "#fff")};color:${escape(h.fg || "#000")}">${escape(h.text || "")}</span>
        ${tags ? `<div class="chip-row">${tags}</div>` : ""}
        ${note}
      </div>`;
  });
  html += `</div>`;

  // Helpful hint about the extension below the cards
  html += `
    <div class="install-hint">
      <strong>Want to see these on the real page?</strong>
      Install the <a href="https://finnjclancy.github.io/highlighter/">Highlighter extension</a> and click "Open on original page" above — your highlights will appear in-context as you read.
    </div>`;

  root.innerHTML = html;
}

init();
