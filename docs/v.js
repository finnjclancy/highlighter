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
  // Append the encoded payload back to the source URL so the recipient's
  // extension can decode it and paint highlights on the original page.
  //
  // The payload may live in either of two places depending on how the
  // gallery was reached:
  //   • Short link (/v/<id>): Worker injects window.__hlPayload  ← default
  //   • Long inline link (?d=<payload>): the ?d= query param      ← legacy
  if (!payload.url) return null;
  try {
    const u = new URL(payload.url);
    let enc = null;
    if (typeof window !== "undefined" && window.__hlPayload) {
      enc = window.__hlPayload;
    } else {
      const params = new URLSearchParams(location.search);
      enc = params.get("d");
    }
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
    <div class="meta-bar">
      <div class="meta">
        ${sourceRow}
        ${sourceRow ? `<span class="sep">·</span>` : ""}
        <span>${count} ${count === 1 ? "highlight" : "highlights"}</span>
      </div>
      <div class="cta-row">
        ${live ? `<a class="cta" href="${escape(live)}" rel="noopener">Open on original page →</a>` : ""}
        <a class="cta cta-secondary" href="https://finnjclancy.github.io/highlighter/">About</a>
      </div>
    </div>
    <div class="cards">
  `;

  payload.highlights.forEach(h => {
    const tags = (h.tags || []).map(t => `<span class="chip">#${escape(t)}</span>`).join("");
    const note = h.note
      ? `<div class="note">
           <div class="note-label">💬 Note from the sharer</div>
           <div class="note-text">${escape(h.note)}</div>
         </div>`
      : "";
    html += `
      <div class="card" data-hid="${escape(h.id)}">
        <span class="swatch" style="background:${escape(h.bg || "#fff")}"></span>
        <span class="quote" style="background:${escape(h.bg || "#fff")};color:${escape(h.fg || "#000")}">${escape(h.text || "")}</span>
        ${tags ? `<div class="chip-row">${tags}</div>` : ""}
        ${note}
        <div class="comments-wrap" data-hid="${escape(h.id)}"></div>
      </div>`;
  });
  html += `</div>`;

  // Helpful hint about the extension below the cards
  html += `
    <div class="install-hint">
      <strong>Want to see these on the real page?</strong>
      Install the <a href="https://chromewebstore.google.com/detail/highlighter/hkldppfkemipnahfagbgbombdhcoogeo" target="_blank" rel="noopener">Highlighter extension</a> and click "Open on original page" above — your highlights will appear in-context as you read.
    </div>`;

  root.innerHTML = html;

  // Wire up viewer comments — only when we're on a Worker-rendered short link
  // (legacy ?d=… inline URLs have no share id to attach comments to).
  if (typeof window.__hlShareId === "string" && window.__hlShareId) {
    initComments(window.__hlShareId);
  }
}

const COMMENT_API = "https://highlighter-share.finnjclancy.workers.dev/api/c/";

function escForAttr(s) { return String(s).replace(/"/g, "&quot;"); }

async function initComments(shareId) {
  // Render the comment shell for every highlight card (empty state)
  document.querySelectorAll(".comments-wrap").forEach(el => {
    renderCommentSection(el, [], shareId);
  });
  // Then fetch any existing comments and re-render with them
  try {
    const res = await fetch(COMMENT_API + encodeURIComponent(shareId));
    if (!res.ok) return;
    const data = await res.json();
    const byHl = new Map();
    (data.comments || []).forEach(c => {
      const key = c.highlightId || "";
      if (!byHl.has(key)) byHl.set(key, []);
      byHl.get(key).push(c);
    });
    document.querySelectorAll(".comments-wrap").forEach(el => {
      const hid = el.dataset.hid;
      renderCommentSection(el, byHl.get(hid) || [], shareId);
    });
  } catch {}
}

function renderCommentSection(wrap, comments, shareId) {
  const hid = wrap.dataset.hid;
  const savedAuthor = (function () {
    try { return localStorage.getItem("hl_author") || ""; } catch { return ""; }
  })();

  wrap.innerHTML = "";

  const list = document.createElement("div");
  list.className = "comments-list";
  comments
    .slice()
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .forEach(c => list.appendChild(renderComment(c)));
  wrap.appendChild(list);

  const toggle = document.createElement("button");
  toggle.className = "add-comment-btn";
  toggle.textContent = comments.length
    ? `💬 Add a reply (${comments.length})`
    : "💬 Add a comment";
  wrap.appendChild(toggle);

  const form = document.createElement("div");
  form.className = "comment-form";
  form.style.display = "none";
  form.innerHTML = `
    <input type="text" class="cf-author" placeholder="Your name (optional)" maxlength="40" value="${escForAttr(savedAuthor)}">
    <textarea class="cf-text" placeholder="Write a comment…" maxlength="2000" rows="3"></textarea>
    <div class="cf-actions">
      <button class="cf-cancel">Cancel</button>
      <button class="cf-post">Post</button>
    </div>
  `;
  wrap.appendChild(form);

  toggle.addEventListener("click", () => {
    const showing = form.style.display !== "none";
    form.style.display = showing ? "none" : "block";
    if (!showing) form.querySelector(".cf-text").focus();
  });
  form.querySelector(".cf-cancel").addEventListener("click", () => {
    form.style.display = "none";
  });
  form.querySelector(".cf-post").addEventListener("click", async () => {
    const text = form.querySelector(".cf-text").value.trim();
    const author = form.querySelector(".cf-author").value.trim();
    if (!text) return;
    const postBtn = form.querySelector(".cf-post");
    postBtn.disabled = true;
    postBtn.textContent = "Posting…";
    try {
      const res = await fetch(COMMENT_API + encodeURIComponent(shareId), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, author, highlightId: hid })
      });
      if (!res.ok) throw new Error("post failed");
      const data = await res.json();
      try { if (author) localStorage.setItem("hl_author", author); } catch {}
      // Re-render this card's comments with the updated list filtered to this highlight
      const all = (data.comments || []).filter(c => (c.highlightId || "") === hid);
      renderCommentSection(wrap, all, shareId);
    } catch (e) {
      postBtn.disabled = false;
      postBtn.textContent = "Try again";
    }
  });
}

function renderComment(c) {
  const el = document.createElement("div");
  el.className = "comment";
  const when = c.createdAt ? timeAgo(c.createdAt) : "";
  el.innerHTML = `
    <div class="c-head">
      <span class="c-author">${escape(c.author || "Anonymous")}</span>
      <span class="c-when">${escape(when)}</span>
    </div>
    <div class="c-text">${escape(c.text || "")}</div>
  `;
  return el;
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  if (d < 30) return d + "d ago";
  return new Date(ts).toLocaleDateString();
}

init();
