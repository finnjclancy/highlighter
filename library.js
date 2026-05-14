let allData = {};
let flat = [];
let filter = { type: "all", value: null };
let search = "";
let sortMode = "newest";
let openId = null;
let selected = new Set();

const resultsEl = document.getElementById("results");
const viewTitleEl = document.getElementById("view-title");
const viewCountEl = document.getElementById("view-count");
const searchEl = document.getElementById("search");
const sortEl = document.getElementById("sort");

searchEl.addEventListener("input", () => { search = searchEl.value.trim().toLowerCase(); render(); });
sortEl.addEventListener("change", () => { sortMode = sortEl.value; render(); });

async function load() {
  const all = await chrome.storage.local.get(null);
  allData = {};
  flat = [];
  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith("hl_page_") || !Array.isArray(v)) continue;
    allData[k] = v;
    v.forEach(h => flat.push({ ...h, pageKey: k, tags: h.tags || [], note: h.note || "" }));
  }
  buildNav();
  render();
  // Hash deep-link: #<id> opens that highlight's modal
  const hashId = location.hash.slice(1);
  if (hashId) {
    const found = flat.find(h => h.id === hashId);
    if (found) openModal(found);
  }
}

function buildNav() {
  const navMain = document.getElementById("nav-main");
  navMain.innerHTML = "";
  navMain.appendChild(navItem("all", null, "All quotes", flat.length, "✦"));

  const navTags = document.getElementById("nav-tags");
  navTags.innerHTML = "";
  const tagCounts = {};
  flat.forEach(h => (h.tags || []).forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));
  const sortedTags = Object.entries(tagCounts).sort((a,b) => a[0].localeCompare(b[0]));
  if (!sortedTags.length) {
    navTags.innerHTML = `<div style="font-size:11px;color:var(--text-4);padding:6px 8px">No folders yet</div>`;
  } else {
    sortedTags.forEach(([t, n]) => navTags.appendChild(navItem("tag", t, t, n, "▸")));
  }

  const navSites = document.getElementById("nav-sites");
  navSites.innerHTML = "";
  const siteCounts = {};
  flat.forEach(h => {
    try { const u = new URL(h.url); siteCounts[u.hostname] = (siteCounts[u.hostname] || 0) + 1; } catch {}
  });
  Object.entries(siteCounts).sort((a,b) => b[1] - a[1]).forEach(([host, n]) => {
    navSites.appendChild(navItem("site", host, host, n));
  });
}

function navItem(type, value, label, count, icon) {
  const el = document.createElement("div");
  el.className = "nav-item";
  if (filter.type === type && filter.value === value) el.classList.add("active");
  const ico = icon ? `<span class="folder-ico">${escape(icon)}</span>` : "";
  const showExport = type === "tag" || type === "site";
  el.innerHTML = `${ico}<span class="label">${escape(label)}</span>` +
                 (showExport ? `<span class="nav-export" title="Export this folder">⬇</span>` : "") +
                 `<span class="badge">${count}</span>`;
  el.addEventListener("click", () => { filter = { type, value }; selected.clear(); buildNav(); render(); });
  const exp = el.querySelector(".nav-export");
  if (exp) {
    exp.addEventListener("click", e => {
      e.stopPropagation();
      const items = flat.filter(h => {
        if (type === "tag") return (h.tags || []).includes(value);
        if (type === "site") { try { return new URL(h.url).hostname === value; } catch { return false; } }
        return false;
      });
      downloadMarkdown(items, label);
    });
  }
  return el;
}

function filterFlat() {
  let list = flat.slice();
  if (filter.type === "tag") list = list.filter(h => (h.tags || []).includes(filter.value));
  else if (filter.type === "site") list = list.filter(h => {
    try { return new URL(h.url).hostname === filter.value; } catch { return false; }
  });
  if (search) {
    list = list.filter(h =>
      (h.text || "").toLowerCase().includes(search) ||
      (h.note || "").toLowerCase().includes(search) ||
      (h.tags || []).some(t => t.toLowerCase().includes(search)) ||
      (h.title || "").toLowerCase().includes(search) ||
      (h.url || "").toLowerCase().includes(search)
    );
  }
  if (sortMode === "newest") list.sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
  else if (sortMode === "oldest") list.sort((a,b) => (a.createdAt||0) - (b.createdAt||0));
  else if (sortMode === "site") list.sort((a,b) => (a.url || "").localeCompare(b.url || ""));
  return list;
}

function render() {
  const list = filterFlat();
  viewTitleEl.textContent = titleForFilter();
  viewCountEl.textContent = list.length;
  resultsEl.innerHTML = "";
  if (!list.length) {
    resultsEl.innerHTML = `<div class="empty"><div class="em-ico">✦</div><h3>Nothing here yet</h3><div>Highlights you make will show up here.</div></div>`;
    return;
  }
  if (sortMode === "site") {
    const groups = {};
    list.forEach(h => {
      if (!groups[h.pageKey]) groups[h.pageKey] = { title: h.title, url: h.url, items: [] };
      groups[h.pageKey].items.push(h);
    });
    Object.entries(groups).forEach(([k, g]) => {
      const grp = document.createElement("div");
      grp.className = "group";
      grp.innerHTML = `
        <div class="group-head">
          <span class="gtitle">${escape(g.title || g.url)}</span>
          <a class="gopen" href="${escape(g.url)}" target="_blank">Open ↗</a>
        </div>`;
      const listEl = document.createElement("div");
      listEl.className = "list";
      g.items.forEach(h => listEl.appendChild(renderRow(h)));
      grp.appendChild(listEl);
      resultsEl.appendChild(grp);
    });
  } else {
    const listEl = document.createElement("div");
    listEl.className = "list";
    list.forEach(h => listEl.appendChild(renderRow(h)));
    resultsEl.appendChild(listEl);
  }
}

function titleForFilter() {
  if (filter.type === "all") return "All quotes";
  if (filter.type === "tag") return filter.value;
  if (filter.type === "site") return filter.value;
  return "";
}

function renderRow(h) {
  const row = document.createElement("div");
  row.className = "row";
  if (selected.has(h.id)) row.classList.add("selected");

  const check = document.createElement("div");
  check.className = "rcheck";
  check.title = "Select";
  check.addEventListener("click", e => {
    e.stopPropagation();
    if (selected.has(h.id)) selected.delete(h.id);
    else selected.add(h.id);
    row.classList.toggle("selected");
    renderSelectionBar();
  });

  const swatch = document.createElement("div");
  swatch.className = "swatch";
  swatch.style.background = h.bg;
  const text = document.createElement("div");
  text.className = "rtext";
  text.textContent = h.text;
  const tags = document.createElement("div");
  tags.className = "rtags";
  (h.tags || []).slice(0, 3).forEach(t => {
    const c = document.createElement("span");
    c.className = "rtag";
    c.textContent = "#" + t;
    tags.appendChild(c);
  });
  const icons = document.createElement("div");
  icons.className = "ricons";
  if (h.note) icons.textContent = "💬";
  const site = document.createElement("div");
  site.className = "rsite";
  try { site.textContent = new URL(h.url).hostname; } catch {}
  row.appendChild(check);
  row.appendChild(swatch);
  row.appendChild(text);
  row.appendChild(tags);
  row.appendChild(icons);
  row.appendChild(site);
  row.addEventListener("click", e => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      if (selected.has(h.id)) selected.delete(h.id); else selected.add(h.id);
      row.classList.toggle("selected");
      renderSelectionBar();
      return;
    }
    openModal(h);
  });
  return row;
}

// ---------- modal ----------
const modalBg = document.getElementById("modal-bg");
const mTitle = document.getElementById("m-title");
const mText = document.getElementById("m-text");
const mTags = document.getElementById("m-tags");
const mNote = document.getElementById("m-note");
const mMeta = document.getElementById("m-meta");
const mGoto = document.getElementById("m-goto");
const mDel = document.getElementById("m-del");
const mClose = document.getElementById("m-close");

function openModal(h) {
  openId = h.id;
  mTitle.textContent = h.title || h.url;
  mText.textContent = h.text;
  mText.style.background = h.bg;
  mText.style.color = h.fg;
  mNote.value = h.note || "";
  renderModalTags(h);
  const date = h.createdAt ? new Date(h.createdAt).toLocaleString() : "";
  let host = ""; try { host = new URL(h.url).hostname; } catch {}
  mMeta.textContent = host + " · " + date;
  modalBg.classList.add("show");
}

function renderModalTags(h) {
  mTags.innerHTML = "";
  (h.tags || []).forEach(t => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.innerHTML = `#${escape(t)} <span class="x">×</span>`;
    chip.querySelector(".x").addEventListener("click", () => {
      h.tags = h.tags.filter(x => x !== t);
      saveHighlight(h);
      renderModalTags(h);
    });
    mTags.appendChild(chip);
  });
  const input = document.createElement("input");
  input.className = "chip-input";
  input.placeholder = "+ tag";
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && input.value.trim()) {
      const t = input.value.trim().replace(/^#/, "");
      h.tags = h.tags || [];
      if (!h.tags.includes(t)) h.tags.push(t);
      saveHighlight(h);
      input.value = "";
      renderModalTags(h);
    }
  });
  mTags.appendChild(input);
}

function closeModal() {
  modalBg.classList.remove("show");
  openId = null;
  if (location.hash) history.replaceState(null, "", location.pathname);
}
mClose.addEventListener("click", closeModal);
modalBg.addEventListener("click", e => { if (e.target === modalBg) closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

let noteTimer;
mNote.addEventListener("input", () => {
  if (!openId) return;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    const h = flat.find(x => x.id === openId);
    if (!h) return;
    h.note = mNote.value;
    saveHighlight(h, { silent: true });
  }, 300);
});

mGoto.addEventListener("click", () => {
  const h = flat.find(x => x.id === openId);
  if (h) chrome.tabs.create({ url: h.url + "#hl=" + h.id });
});
mDel.addEventListener("click", () => {
  const h = flat.find(x => x.id === openId);
  if (h) { removeHighlight(h); closeModal(); }
});

async function saveHighlight(h, opts = {}) {
  const list = allData[h.pageKey] || [];
  const idx = list.findIndex(x => x.id === h.id);
  if (idx < 0) return;
  list[idx].tags = h.tags;
  list[idx].note = h.note;
  allData[h.pageKey] = list;
  await chrome.storage.local.set({ [h.pageKey]: list });
  notifyTabs(h.pageKey, { type: "updateHighlight", id: h.id, patch: { tags: h.tags, note: h.note } });
  if (!opts.silent) { buildNav(); render(); }
  else buildNav();
}

async function removeHighlight(h) {
  const list = (allData[h.pageKey] || []).filter(x => x.id !== h.id);
  allData[h.pageKey] = list;
  if (list.length) await chrome.storage.local.set({ [h.pageKey]: list });
  else await chrome.storage.local.remove(h.pageKey);
  flat = flat.filter(x => x.id !== h.id);
  notifyTabs(h.pageKey, { type: "removeHighlight", id: h.id });
  buildNav(); render();
}

async function notifyTabs(pageKey, msg) {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (!t.url) continue;
    try {
      const u = new URL(t.url);
      if ("hl_page_" + u.origin + u.pathname === pageKey) {
        try { await chrome.tabs.sendMessage(t.id, msg); } catch {}
      }
    } catch {}
  }
}

function escape(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

// ---------- export ----------
function toMarkdown(items, title) {
  const today = new Date().toISOString().slice(0, 10);
  let md = `# ${title}\n\n_Exported ${today} · ${items.length} ${items.length === 1 ? "quote" : "quotes"}_\n\n`;

  // Group by source page for readability
  const groups = new Map();
  items.forEach(h => {
    const key = h.url;
    if (!groups.has(key)) groups.set(key, { title: h.title || h.url, url: h.url, items: [] });
    groups.get(key).items.push(h);
  });

  for (const [, g] of groups) {
    md += `## [${(g.title || "Untitled").replace(/\]/g, "\\]")}](${g.url})\n\n`;
    g.items.forEach(h => {
      const quoted = (h.text || "").split("\n").map(line => `> ${line}`).join("\n");
      md += quoted + "\n";
      if (h.tags && h.tags.length) {
        md += `>\n> _Tags: ${h.tags.map(t => "`#" + t + "`").join(" ")}_\n`;
      }
      if (h.note) {
        const note = h.note.split("\n").map(line => `> 💬 ${line}`).join("\n");
        md += `>\n${note}\n`;
      }
      md += `>\n> [Open in context ↗](${h.url}#hl=${h.id})\n\n`;
    });
    md += `---\n\n`;
  }
  return md;
}

function downloadMarkdown(items, title) {
  if (!items || !items.length) return;
  const md = toMarkdown(items, title);
  const safe = String(title).replace(/[^a-z0-9\-_]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "highlights";
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${safe}-${stamp}.md`;
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

document.getElementById("export-view").addEventListener("click", () => {
  const items = filterFlat();
  downloadMarkdown(items, titleForFilter());
});

// ---------- selection bar ----------
let selBar;
function renderSelectionBar() {
  if (!selBar) {
    selBar = document.createElement("div");
    selBar.style.cssText = `
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      background: rgba(16,16,19,0.96); color: #fafafa;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 999px;
      padding: 8px 10px 8px 16px;
      display: flex; align-items: center; gap: 10px;
      box-shadow: 0 12px 36px rgba(0,0,0,0.5);
      backdrop-filter: blur(20px) saturate(180%);
      font: 500 12px -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
      letter-spacing: -0.005em;
      z-index: 90;
    `;
    selBar.innerHTML = `
      <span class="sel-count"></span>
      <button class="sel-clear" style="background:transparent;border:none;color:rgba(250,250,250,0.5);cursor:pointer;font:inherit;padding:4px 6px;border-radius:6px;">Clear</button>
      <button class="sel-export" style="background:#6366f1;border:none;color:#fff;cursor:pointer;font:inherit;font-weight:500;padding:6px 12px;border-radius:999px;">⬇ Export selected</button>
    `;
    document.body.appendChild(selBar);
    selBar.querySelector(".sel-clear").addEventListener("click", () => {
      selected.clear();
      document.querySelectorAll(".row.selected").forEach(r => r.classList.remove("selected"));
      renderSelectionBar();
    });
    selBar.querySelector(".sel-export").addEventListener("click", () => {
      const items = flat.filter(h => selected.has(h.id));
      downloadMarkdown(items, `selected-${items.length}`);
    });
  }
  if (selected.size === 0) {
    selBar.style.display = "none";
    return;
  }
  selBar.style.display = "flex";
  selBar.querySelector(".sel-count").textContent = selected.size + " selected";
}

load();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") load();
});
