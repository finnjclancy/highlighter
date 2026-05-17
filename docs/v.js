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
  const hasName = !!(payload.name && payload.name.trim());
  const pageTitle = payload.title || "";
  const host = hostOf(payload.url);
  const displayName = hasName ? payload.name.trim() : (pageTitle || host || "Shared highlights");
  const sourceLabel = pageTitle || host || "Open source";
  const count = payload.highlights.length;
  const live = buildLiveLink(payload);

  document.title = displayName + " — Highlighter";

  // If the user named the share, show name big + page title as the source
  // link. Otherwise the page title is the big title and the host is the
  // source link.
  const sourceRow = hasName
    ? `<a class="source-link" href="${escape(payload.url || "#")}" target="_blank" rel="noopener">
         ${escape(sourceLabel)}
         <span class="arrow">↗</span>
       </a>`
    : (host ? `<a class="source-link" href="${escape(payload.url || "#")}" target="_blank" rel="noopener">${escape(host)}<span class="arrow">↗</span></a>` : "");

  let html = `
    <h2 class="page-title">${escape(displayName)}</h2>
    <div class="meta">
      ${sourceRow}
      ${sourceRow ? `<span class="sep">·</span>` : ""}
      <span>${count} ${count === 1 ? "highlight" : "highlights"}</span>
    </div>
    <div class="cta-row">
      ${live ? `<a class="cta" href="${escape(live)}" rel="noopener">Open on original page →</a>` : ""}
      <a class="cta cta-secondary" href="https://finnjclancy.github.io/highlighter/">About Highlighter</a>
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
