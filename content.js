(() => {
  if (window.__highlighterLoaded) return;
  window.__highlighterLoaded = true;

  const PAGE_KEY = "hl_page_" + location.origin + location.pathname;
  let palette = [];
  let highlights = [];
  let toolbar = null;
  let panel = null;
  let popover = null;
  let shareBanner = null;
  let pendingShared = [];  // highlights from a #hlshare= link, not yet saved

  // ---------- storage ----------
  async function loadPalette() {
    const { palette: p } = await chrome.storage.sync.get("palette");
    palette = p || [];
  }
  async function loadHighlights() {
    const data = await chrome.storage.local.get(PAGE_KEY);
    highlights = data[PAGE_KEY] || [];
  }
  async function saveHighlights() {
    await chrome.storage.local.set({ [PAGE_KEY]: highlights });
  }

  // ---------- range serialization (XPath + offsets) ----------
  function getXPath(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentNode;
      const idx = Array.from(parent.childNodes).filter(n => n.nodeType === Node.TEXT_NODE).indexOf(node);
      return getXPath(parent) + "/text()[" + (idx + 1) + "]";
    }
    if (node === document.body) return "/html/body";
    if (!node.parentNode) return "";
    const siblings = Array.from(node.parentNode.children).filter(n => n.tagName === node.tagName);
    const idx = siblings.indexOf(node) + 1;
    return getXPath(node.parentNode) + "/" + node.tagName.toLowerCase() + "[" + idx + "]";
  }
  function resolveXPath(xpath) {
    try {
      const r = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      return r.singleNodeValue;
    } catch { return null; }
  }

  function serializeRange(range) {
    return {
      startXPath: getXPath(range.startContainer),
      startOffset: range.startOffset,
      endXPath: getXPath(range.endContainer),
      endOffset: range.endOffset,
      text: range.toString()
    };
  }

  function deserializeRange(s) {
    const start = resolveXPath(s.startXPath);
    const end = resolveXPath(s.endXPath);
    if (!start || !end) return null;
    try {
      const r = document.createRange();
      r.setStart(start, Math.min(s.startOffset, start.length ?? s.startOffset));
      r.setEnd(end, Math.min(s.endOffset, end.length ?? s.endOffset));
      return r;
    } catch { return null; }
  }

  // ---------- highlight rendering ----------
  function wrapRange(range, id, bg, fg) {
    // Collect text nodes inside the range
    const nodes = [];
    const walker = document.createTreeWalker(
      range.commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(n) {
          if (!n.nodeValue.length) return NodeFilter.FILTER_REJECT;
          if (!range.intersectsNode(n)) return NodeFilter.FILTER_REJECT;
          // skip if inside another highlight already covering same id
          if (n.parentElement && n.parentElement.closest("script,style,#hl-toolbar,#hl-panel")) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    let n;
    while ((n = walker.nextNode())) nodes.push(n);

    nodes.forEach(node => {
      let from = 0, to = node.nodeValue.length;
      if (node === range.startContainer) from = range.startOffset;
      if (node === range.endContainer) to = range.endOffset;
      if (from >= to) return;

      const before = node.nodeValue.slice(0, from);
      const middle = node.nodeValue.slice(from, to);
      const after  = node.nodeValue.slice(to);

      const mark = document.createElement("span");
      mark.className = "hl-mark";
      mark.dataset.hlId = id;
      mark.style.backgroundColor = bg;
      mark.style.color = fg;
      mark.textContent = middle;
      mark.addEventListener("click", e => {
        e.stopPropagation();
        const h = highlights.find(x => x.id === id);
        if (h) showPopover(h, e.clientX, e.clientY);
      });

      const frag = document.createDocumentFragment();
      if (before) frag.appendChild(document.createTextNode(before));
      frag.appendChild(mark);
      if (after) frag.appendChild(document.createTextNode(after));
      node.parentNode.replaceChild(frag, node);
    });
  }

  function applyHighlight(h) {
    const range = deserializeRange(h.range);
    if (!range) return false;
    wrapRange(range, h.id, h.bg, h.fg);
    return true;
  }

  function applyAllHighlights() {
    document.querySelectorAll(".hl-mark").forEach(m => {
      const txt = document.createTextNode(m.textContent);
      m.parentNode.replaceChild(txt, m);
    });
    document.body.normalize();
    highlights.forEach(applyHighlight);
  }

  function removeHighlight(id) {
    document.querySelectorAll(`.hl-mark[data-hl-id="${id}"]`).forEach(m => {
      const txt = document.createTextNode(m.textContent);
      m.parentNode.replaceChild(txt, m);
    });
    document.body.normalize();
    highlights = highlights.filter(h => h.id !== id);
    saveHighlights();
    renderPanel();
  }

  function scrollToHighlight(id) {
    const first = document.querySelector(`.hl-mark[data-hl-id="${id}"]`);
    if (!first) return;
    first.scrollIntoView({ behavior: "smooth", block: "center" });
    document.querySelectorAll(`.hl-mark[data-hl-id="${id}"]`).forEach(m => {
      m.classList.remove("hl-flash");
      void m.offsetWidth;
      m.classList.add("hl-flash");
    });
  }

  // ---------- selection toolbar ----------
  function hideToolbar() {
    if (toolbar) { toolbar.remove(); toolbar = null; }
  }

  function showToolbar(rect) {
    hideToolbar();
    toolbar = document.createElement("div");
    toolbar.id = "hl-toolbar";
    palette.forEach((c, i) => {
      const sw = document.createElement("button");
      sw.className = "hl-swatch";
      sw.style.backgroundColor = c.bg;
      sw.style.color = c.fg;
      sw.title = c.name + " — text " + c.fg + ", bg " + c.bg;
      sw.textContent = "A";
      sw.addEventListener("mousedown", e => {
        e.preventDefault();
        e.stopPropagation();
        highlightSelection(c.bg, c.fg);
      });
      toolbar.appendChild(sw);
    });

    const div = document.createElement("div");
    div.className = "hl-divider";
    toolbar.appendChild(div);

    const opts = document.createElement("button");
    opts.className = "hl-btn";
    opts.textContent = "⚙";
    opts.title = "Edit colors";
    opts.addEventListener("mousedown", e => {
      e.preventDefault();
      chrome.runtime.sendMessage({ type: "openUrl", url: chrome.runtime.getURL("library.html#design") });
    });
    toolbar.appendChild(opts);

    document.body.appendChild(toolbar);
    const tw = toolbar.offsetWidth;
    const th = toolbar.offsetHeight;
    let top = window.scrollY + rect.top - th - 8;
    if (top < window.scrollY + 4) top = window.scrollY + rect.bottom + 8;
    let left = window.scrollX + rect.left + rect.width / 2 - tw / 2;
    left = Math.max(window.scrollX + 4, Math.min(left, window.scrollX + document.documentElement.clientWidth - tw - 4));
    toolbar.style.top = top + "px";
    toolbar.style.left = left + "px";
  }

  function highlightSelection(bg, fg) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const serialized = serializeRange(range);
    if (!serialized.text.trim()) return;
    const id = "h_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    const h = {
      id, bg, fg,
      text: serialized.text,
      range: serialized,
      url: location.href,
      title: document.title,
      tags: [],
      note: "",
      createdAt: Date.now()
    };
    highlights.push(h);
    if (applyHighlight(h)) saveHighlights();
    sel.removeAllRanges();
    hideToolbar();
    renderPanel();
  }

  document.addEventListener("mouseup", e => {
    if (toolbar && toolbar.contains(e.target)) return;
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !sel.toString().trim()) {
        hideToolbar();
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      showToolbar(rect);
    }, 10);
  });
  document.addEventListener("mousedown", e => {
    if (toolbar && !toolbar.contains(e.target)) hideToolbar();
  });
  document.addEventListener("scroll", hideToolbar, { passive: true });

  // ---------- side panel ----------
  function buildPanel() {
    panel = document.createElement("div");
    panel.id = "hl-panel";
    panel.innerHTML = `
      <div class="hl-panel-head">
        <button class="hl-panel-toggle" title="Toggle">≡</button>
        <span class="hl-panel-title">Highlights</span>
        <span class="hl-panel-count">0</span>
        <button class="hl-panel-draw" title="Toggle drawing mode">✎ Draw</button>
      </div>
      <div class="hl-panel-body"></div>
    `;
    document.body.appendChild(panel);
    // Start collapsed by default (burger visible in bottom-left).
    panel.classList.add("hl-collapsed");

    const head = panel.querySelector(".hl-panel-head");
    const toggle = panel.querySelector(".hl-panel-toggle");
    toggle.addEventListener("click", e => {
      e.stopPropagation();
      panel.classList.toggle("hl-collapsed");
    });

    const drawBtn = panel.querySelector(".hl-panel-draw");
    drawBtn.addEventListener("click", e => {
      e.stopPropagation();
      if (window.__hlDrawing) window.__hlDrawing.toggle();
    });
    window.addEventListener("hl-draw-state", e => {
      drawBtn.classList.toggle("active", !!e.detail?.active);
    });

    // drag — switch from bottom-anchored to top/left-anchored on first drag
    let dragging = false, dx = 0, dy = 0;
    head.addEventListener("mousedown", e => {
      if (e.target === toggle) return;
      dragging = true;
      const r = panel.getBoundingClientRect();
      dx = e.clientX - r.left;
      dy = e.clientY - r.top;
      e.preventDefault();
    });
    document.addEventListener("mousemove", e => {
      if (!dragging) return;
      panel.style.left = (e.clientX - dx) + "px";
      panel.style.top = (e.clientY - dy) + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    });
    document.addEventListener("mouseup", () => dragging = false);
  }

  function renderPanel() {
    if (!panel) return;
    const body = panel.querySelector(".hl-panel-body");
    body.innerHTML = "";
    const countEl = panel.querySelector(".hl-panel-count");
    if (countEl) countEl.textContent = highlights.length;
    if (highlights.length === 0) {
      body.innerHTML = `<div class="hl-empty">No highlights yet.<br>Select text to begin.</div>`;
      return;
    }
    highlights.forEach(h => {
      const item = document.createElement("div");
      item.className = "hl-item";
      const dot = document.createElement("div");
      dot.className = "hl-item-bar";
      dot.style.background = h.bg;
      const txt = document.createElement("div");
      txt.className = "hl-item-text";
      txt.textContent = h.text;
      const icons = document.createElement("div");
      icons.className = "hl-item-icons";
      if (h.note) icons.textContent = "💬";
      item.appendChild(dot);
      item.appendChild(txt);
      item.appendChild(icons);
      item.addEventListener("click", e => {
        scrollToHighlight(h.id);
        const rect = item.getBoundingClientRect();
        showPopover(h, rect.right + 10, rect.top);
      });
      body.appendChild(item);
    });
  }

  // ---------- popover ----------
  function hidePopover() {
    if (popover) { popover.remove(); popover = null; }
  }
  function showPopover(h, x, y) {
    hidePopover();
    popover = document.createElement("div");
    popover.id = "hl-popover";
    popover.addEventListener("click", e => e.stopPropagation());

    const text = document.createElement("div");
    text.className = "pop-text";
    text.style.background = h.bg;
    text.style.color = h.fg;
    text.textContent = h.text;
    popover.appendChild(text);

    if (h.tags && h.tags.length) {
      const tagsEl = document.createElement("div");
      tagsEl.className = "pop-tags";
      h.tags.forEach(t => {
        const tg = document.createElement("span");
        tg.className = "pop-tag";
        tg.textContent = "#" + t;
        tagsEl.appendChild(tg);
      });
      popover.appendChild(tagsEl);
    }

    if (h.note) {
      const note = document.createElement("div");
      note.className = "pop-note";
      note.textContent = h.note;
      popover.appendChild(note);
    }

    const actions = document.createElement("div");
    actions.className = "pop-actions";
    const goto = document.createElement("button");
    goto.className = "pop-btn primary";
    goto.textContent = "→ Go to text";
    goto.addEventListener("click", () => { scrollToHighlight(h.id); hidePopover(); });
    const edit = document.createElement("button");
    edit.className = "pop-btn";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "openUrl", url: chrome.runtime.getURL("library.html#" + h.id) });
      hidePopover();
    });
    const del = document.createElement("button");
    del.className = "pop-btn danger";
    del.textContent = "Delete";
    del.addEventListener("click", () => { removeHighlight(h.id); hidePopover(); });
    actions.appendChild(goto);
    actions.appendChild(edit);
    actions.appendChild(del);
    popover.appendChild(actions);

    document.body.appendChild(popover);
    const pw = popover.offsetWidth, ph = popover.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    let left = Math.max(6, Math.min(x, vw - pw - 6));
    let top  = Math.max(6, Math.min(y + 10, vh - ph - 6));
    popover.style.left = left + "px";
    popover.style.top = top + "px";
  }
  document.addEventListener("mousedown", e => {
    if (popover && !popover.contains(e.target) && !e.target.classList?.contains("hl-mark")) {
      hidePopover();
    }
  });
  document.addEventListener("scroll", () => hidePopover(), { passive: true });

  // ---------- messaging (from popup) ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "scrollTo" && msg.id) {
      scrollToHighlight(msg.id);
      sendResponse({ ok: true });
    } else if (msg.type === "getHighlights") {
      sendResponse({ highlights });
    } else if (msg.type === "removeHighlight") {
      removeHighlight(msg.id);
      sendResponse({ ok: true });
    } else if (msg.type === "updateHighlight") {
      const idx = highlights.findIndex(h => h.id === msg.id);
      if (idx >= 0) {
        if (msg.patch.tags !== undefined) highlights[idx].tags = msg.patch.tags;
        if (msg.patch.note !== undefined) highlights[idx].note = msg.patch.note;
        saveHighlights();
        renderPanel();
      }
      sendResponse({ ok: true });
    } else if (msg.type === "buildShareLink") {
      copyShareLinkToClipboard().then(sendResponse);
      return true;
    } else if (msg.type === "togglePanel") {
      if (panel) {
        if (panel.classList.contains("hl-hidden")) {
          panel.classList.remove("hl-hidden");
        } else {
          panel.classList.add("hl-hidden");
        }
      }
      sendResponse({ ok: true });
    }
    return true;
  });

  // react to palette changes live
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.palette) {
      palette = changes.palette.newValue || [];
    }
  });

  // also catch deep-link via hash: #hl=<id>
  function checkHash() {
    const m = location.hash.match(/hl=([\w_]+)/);
    if (m) setTimeout(() => scrollToHighlight(m[1]), 400);
  }

  // ---------- sharing ----------
  function utf8ToB64Url(s) {
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(s)));
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }
  function b64UrlToUtf8(s) {
    let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    return new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
  }

  function buildShareLink() {
    const payload = {
      v: 1,
      highlights: highlights.map(h => ({
        id: h.id, bg: h.bg, fg: h.fg,
        text: h.text,
        note: h.note || "",
        tags: h.tags || [],
        r: {
          sx: h.range.startXPath, so: h.range.startOffset,
          ex: h.range.endXPath,   eo: h.range.endOffset
        }
      }))
    };
    const enc = utf8ToB64Url(JSON.stringify(payload));
    const base = location.origin + location.pathname + location.search;
    return base + "#hlshare=" + enc;
  }

  function applySharedFromHash() {
    const m = location.hash.match(/hlshare=([^&]+)/);
    if (!m) return;
    let payload;
    try {
      payload = JSON.parse(b64UrlToUtf8(m[1]));
    } catch (e) { return; }
    if (!payload || payload.v !== 1 || !Array.isArray(payload.highlights)) return;

    pendingShared = [];
    let applied = 0;
    payload.highlights.forEach(p => {
      // Skip ones the user already has
      if (highlights.some(h => h.id === p.id)) return;
      const h = {
        id: p.id, bg: p.bg, fg: p.fg,
        text: p.text,
        note: p.note || "",
        tags: p.tags || [],
        url: location.origin + location.pathname,
        title: document.title,
        createdAt: Date.now(),
        range: { startXPath: p.r.sx, startOffset: p.r.so, endXPath: p.r.ex, endOffset: p.r.eo, text: p.text },
        _shared: true
      };
      if (applyHighlight(h)) { pendingShared.push(h); applied++; }
    });
    if (applied > 0) showShareBanner(applied);
    renderPanel();
  }

  function showShareBanner(count) {
    if (shareBanner) shareBanner.remove();
    shareBanner = document.createElement("div");
    shareBanner.id = "hl-share-banner";
    shareBanner.innerHTML = `
      <span class="hl-sb-text">✨ <b>${count}</b> shared ${count === 1 ? "highlight" : "highlights"} on this page</span>
      <button class="hl-sb-btn hl-sb-keep">Save to my library</button>
      <button class="hl-sb-btn hl-sb-dismiss">Dismiss</button>
    `;
    document.body.appendChild(shareBanner);
    shareBanner.querySelector(".hl-sb-keep").addEventListener("click", async () => {
      pendingShared.forEach(h => { delete h._shared; highlights.push(h); });
      await saveHighlights();
      pendingShared = [];
      shareBanner.remove(); shareBanner = null;
      renderPanel();
      // Strip the hlshare param from URL for cleanliness
      const clean = location.hash.replace(/[?&]?hlshare=[^&]+/, "");
      history.replaceState(null, "", location.pathname + location.search + (clean === "#" ? "" : clean));
    });
    shareBanner.querySelector(".hl-sb-dismiss").addEventListener("click", () => {
      // remove the temporarily applied marks
      pendingShared.forEach(h => {
        document.querySelectorAll(`.hl-mark[data-hl-id="${h.id}"]`).forEach(m => {
          const txt = document.createTextNode(m.textContent);
          m.parentNode.replaceChild(txt, m);
        });
      });
      document.body.normalize();
      pendingShared = [];
      shareBanner.remove(); shareBanner = null;
      renderPanel();
    });
  }

  async function copyShareLinkToClipboard() {
    if (!highlights.length) {
      return { ok: false, error: "No highlights on this page yet." };
    }
    const url = buildShareLink();
    try {
      await navigator.clipboard.writeText(url);
      return { ok: true, url, count: highlights.length };
    } catch (e) {
      // Fallback: dispatch event with the URL so popup can fall back
      return { ok: false, url, count: highlights.length, error: "Clipboard blocked" };
    }
  }

  // ---------- init ----------
  (async function init() {
    await loadPalette();
    await loadHighlights();
    buildPanel();
    // Wait a tick for late-rendering pages
    setTimeout(() => {
      applyAllHighlights();
      renderPanel();
      checkHash();
      applySharedFromHash();
    }, 300);
  })();
})();
