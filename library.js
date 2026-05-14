let allData = {};
let flat = [];
let filter = { type: "all", value: null };
let search = "";
let sortMode = "newest";
let openId = null;

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
  el.innerHTML = `${ico}<span class="label">${escape(label)}</span><span class="badge">${count}</span>`;
  el.addEventListener("click", () => { filter = { type, value }; buildNav(); render(); });
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
  row.appendChild(swatch);
  row.appendChild(text);
  row.appendChild(tags);
  row.appendChild(icons);
  row.appendChild(site);
  row.addEventListener("click", () => openModal(h));
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

load();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") load();
});
