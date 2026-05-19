(() => {
  if (window.__highlighterLoaded) return;
  window.__highlighterLoaded = true;

  // True until the extension is reloaded out from under this content script.
  // After reload, this script is "orphaned" — chrome.* APIs throw
  // "Extension context invalidated" on every call. We detect that, set the
  // flag, and silently no-op so the console doesn't fill with errors.
  let extensionAlive = true;
  function checkAlive() {
    try { return extensionAlive && !!(chrome && chrome.runtime && chrome.runtime.id); }
    catch { extensionAlive = false; return false; }
  }
  // Swallow the specific "Extension context invalidated" rejection so it
  // doesn't surface as an uncaught error in pages we don't control.
  window.addEventListener("unhandledrejection", (e) => {
    const msg = (e.reason && (e.reason.message || String(e.reason))) || "";
    if (msg.includes("Extension context invalidated")) {
      extensionAlive = false;
      e.preventDefault();
    }
  });

  // Normalise pathname so a trailing slash variant (common on Substack and
  // other SPAs that canonicalise the URL post-load) doesn't split a single
  // page into two storage entries.
  function normalisedPath() {
    let p = location.pathname;
    if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
    return p;
  }
  function currentPageKey() {
    return "hl_page_" + location.origin + normalisedPath();
  }
  let PAGE_KEY = currentPageKey();
  let palette = [];
  let highlights = [];
  let toolbar = null;
  let panel = null;
  let popover = null;
  let hoverToolbar = null;
  let hoverHideTimer = null;
  let shareBanner = null;
  let pendingShared = [];

  const SKIP_SELECTOR = "script,style,#hl-toolbar,#hl-panel,#hl-popover,#hl-draw-toolbar,#hl-draw-canvas,#hl-share-banner,#hl-hover-toolbar";
  const CONTEXT_LEN = 40;

  // ---------- storage ----------
  async function loadPalette() {
    if (!checkAlive()) return;
    try {
      const { palette: p } = await chrome.storage.sync.get("palette");
      palette = p || [];
    } catch { extensionAlive = false; }
  }
  async function loadHighlights() {
    if (!checkAlive()) return;
    try {
      const data = await chrome.storage.local.get(PAGE_KEY);
      highlights = data[PAGE_KEY] || [];
      // Backward-compat: pre-normalisation we used pathname-as-is, which on
      // SPAs that canonicalise trailing slashes orphaned the saved data.
      if (!highlights.length) {
        const legacyKey = "hl_page_" + location.origin + location.pathname;
        if (legacyKey !== PAGE_KEY) {
          const legacy = await chrome.storage.local.get(legacyKey);
          const legacyList = legacy[legacyKey];
          if (legacyList && legacyList.length) {
            highlights = legacyList;
            await chrome.storage.local.set({ [PAGE_KEY]: highlights });
            await chrome.storage.local.remove(legacyKey);
          }
        }
      }
    } catch { extensionAlive = false; }
  }
  async function saveHighlights() {
    if (!checkAlive()) return;
    try { await chrome.storage.local.set({ [PAGE_KEY]: highlights }); }
    catch { extensionAlive = false; }
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
    const SKIP = "script,style,#hl-toolbar,#hl-panel,#hl-popover,#hl-draw-toolbar,#hl-draw-canvas,#hl-share-banner";
    const nodes = [];
    const root = range.commonAncestorContainer;

    if (root.nodeType === Node.TEXT_NODE) {
      // Single-text-node selection — TreeWalker.nextNode() never returns the root,
      // so we must handle this case explicitly.
      if (root.nodeValue && (!root.parentElement || !root.parentElement.closest(SKIP))) {
        nodes.push(root);
      }
    } else {
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(n) {
            if (!n.nodeValue.length) return NodeFilter.FILTER_REJECT;
            if (!range.intersectsNode(n)) return NodeFilter.FILTER_REJECT;
            if (n.parentElement && n.parentElement.closest(SKIP)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );
      let n;
      while ((n = walker.nextNode())) nodes.push(n);
    }

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
        if (h) {
          hideHoverToolbar();
          showPopover(h, e.clientX, e.clientY);
        }
      });
      mark.addEventListener("mouseenter", () => {
        clearTimeout(hoverHideTimer);
        if (popover) return;
        const h = highlights.find(x => x.id === id);
        if (!h) return;
        const rect = mark.getBoundingClientRect();
        showHoverToolbar(h, rect);
      });
      mark.addEventListener("mouseleave", () => scheduleHoverHide());

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

  // Like applyHighlight, but on failure falls back to text-quote search.
  // Used by the MutationObserver re-apply path so SPA re-renders that
  // invalidate the original XPath (e.g. CNBC swapping article DOM mid-load)
  // can still recover the highlight by matching the saved text + context.
  function applyHighlightSmart(h) {
    // Try the cheap XPath path first
    let range = h.range ? deserializeRange(h.range) : null;
    if (!range || (h.text && range.toString().trim() !== h.text.trim())) {
      // Fall back to text-quote search if we have prefix/suffix anchors
      if (typeof findRangeByText === "function" && h.text) {
        range = findRangeByText(h.text, h.prefix || "", h.suffix || "");
      } else if (!range) {
        return false;
      }
    }
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
    highlights.forEach(applyHighlightSmart);
    // Also re-apply any shared (pending) highlights from a ?hlshare= link.
    if (pendingShared && pendingShared.length) {
      pendingShared.forEach(applyHighlightSmart);
    }
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

  function handleMouseUp(e) {
    if (toolbar && toolbar.contains(e.target)) return;
    if (popover && popover.contains(e.target)) return;
    // Run twice — once immediately, and again after a microtask, to handle
    // pages (X/Twitter, etc.) that briefly mess with the selection.
    const tryShow = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !sel.toString().trim()) {
        return false;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      showToolbar(rect);
      return true;
    };
    if (!tryShow()) {
      setTimeout(() => { if (!tryShow()) hideToolbar(); }, 30);
    }
  }
  document.addEventListener("mouseup", handleMouseUp, true);
  document.addEventListener("pointerup", handleMouseUp, true);
  document.addEventListener("mousedown", e => {
    if (toolbar && !toolbar.contains(e.target)) hideToolbar();
  }, true);
  document.addEventListener("scroll", hideToolbar, { passive: true, capture: true });

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
    toggle.title = "Click to toggle · drag to move";

    const drawBtn = panel.querySelector(".hl-panel-draw");
    drawBtn.addEventListener("click", e => {
      e.stopPropagation();
      if (window.__hlDrawing) window.__hlDrawing.toggle();
    });
    window.addEventListener("hl-draw-state", e => {
      drawBtn.classList.toggle("active", !!e.detail?.active);
    });

    // ---------- click-or-drag, mirroring the drawing chip ----------
    // The burger (and any non-button area of the head when expanded) acts
    // as both a click target (toggle collapse/expand) and a drag handle.
    // A 5px threshold distinguishes a click from a drag.
    const DRAG_THRESHOLD = 5;
    let panelDrag = null;

    function clampPanelPos(bottom, left) {
      const r = panel.getBoundingClientRect();
      const w = r.width  || 32;
      const h = r.height || 32;
      return {
        bottom: Math.max(0, Math.min(window.innerHeight - h, bottom)),
        left:   Math.max(0, Math.min(window.innerWidth  - w, left))
      };
    }

    function startPanelDrag(e, source) {
      if (e.button !== 0) return;
      const r = panel.getBoundingClientRect();
      panelDrag = {
        source,                          // "toggle" | "head"
        startX: e.clientX,
        startY: e.clientY,
        origBottom: window.innerHeight - r.bottom,
        origLeft:   r.left,
        moved: false
      };
      e.preventDefault();
    }

    toggle.addEventListener("mousedown", e => {
      e.stopPropagation();
      startPanelDrag(e, "toggle");
    });
    head.addEventListener("mousedown", e => {
      // Ignore clicks that originated from a button inside the head — those
      // have their own handlers (toggle / draw).
      if (e.target.closest(".hl-panel-toggle, .hl-panel-draw")) return;
      startPanelDrag(e, "head");
    });

    document.addEventListener("mousemove", e => {
      if (!panelDrag) return;
      const dx = e.clientX - panelDrag.startX;
      const dy = e.clientY - panelDrag.startY;
      if (!panelDrag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      panelDrag.moved = true;
      const p = clampPanelPos(panelDrag.origBottom - dy, panelDrag.origLeft + dx);
      // Anchor by bottom + left so the burger stays put when the panel
      // expands upward.
      panel.style.bottom = p.bottom + "px";
      panel.style.left   = p.left + "px";
      panel.style.top    = "auto";
      panel.style.right  = "auto";
      panel.classList.add("hl-dragging");
    });

    document.addEventListener("mouseup", async () => {
      if (!panelDrag) return;
      const wasMoved = panelDrag.moved;
      const src = panelDrag.source;
      panelDrag = null;
      panel.classList.remove("hl-dragging");
      if (wasMoved) {
        try {
          const r = panel.getBoundingClientRect();
          await chrome.storage.local.set({
            hl_panel_pos: { bottom: window.innerHeight - r.bottom, left: r.left }
          });
        } catch {}
      } else if (src === "toggle") {
        // Click without drag → toggle collapse/expand
        panel.classList.toggle("hl-collapsed");
      }
    });

    // Restore any saved position from a previous drag
    applySavedPanelPos();
    // Keep the panel on-screen if the viewport size changes
    window.addEventListener("resize", () => {
      if (!panel) return;
      const r = panel.getBoundingClientRect();
      const p = clampPanelPos(window.innerHeight - r.bottom, r.left);
      panel.style.bottom = p.bottom + "px";
      panel.style.left   = p.left + "px";
    });

    async function applySavedPanelPos() {
      try {
        const data = await chrome.storage.local.get("hl_panel_pos");
        const pos = data.hl_panel_pos;
        if (!pos) return;
        const p = clampPanelPos(pos.bottom, pos.left);
        panel.style.bottom = p.bottom + "px";
        panel.style.left   = p.left + "px";
        panel.style.top    = "auto";
        panel.style.right  = "auto";
      } catch {}
    }
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

  // ---------- recolor / remove ----------
  function recolorHighlight(h, bg, fg) {
    h.bg = bg; h.fg = fg;
    document.querySelectorAll(`.hl-mark[data-hl-id="${h.id}"]`).forEach(m => {
      m.style.backgroundColor = bg;
      m.style.color = fg;
    });
    saveHighlights();
    renderPanel();
  }

  // ---------- hover quick-toolbar ----------
  function showHoverToolbar(h, rect) {
    hideHoverToolbar();
    hoverToolbar = document.createElement("div");
    hoverToolbar.id = "hl-hover-toolbar";

    palette.forEach(c => {
      const sw = document.createElement("button");
      sw.className = "hl-swatch";
      sw.style.backgroundColor = c.bg;
      sw.style.color = c.fg;
      sw.textContent = "A";
      sw.title = c.name;
      if (c.bg === h.bg) sw.classList.add("active");
      sw.addEventListener("mousedown", e => {
        e.preventDefault();
        e.stopPropagation();
        recolorHighlight(h, c.bg, c.fg);
        hideHoverToolbar();
      });
      hoverToolbar.appendChild(sw);
    });

    const div = document.createElement("div");
    div.className = "hl-divider";
    hoverToolbar.appendChild(div);

    const del = document.createElement("button");
    del.className = "hl-btn hl-btn-del";
    del.title = "Remove highlight";
    del.textContent = "×";
    del.addEventListener("mousedown", e => {
      e.preventDefault();
      e.stopPropagation();
      removeHighlight(h.id);
      hideHoverToolbar();
    });
    hoverToolbar.appendChild(del);

    document.body.appendChild(hoverToolbar);

    const tw = hoverToolbar.offsetWidth;
    const th = hoverToolbar.offsetHeight;
    let top = window.scrollY + rect.top - th - 6;
    if (top < window.scrollY + 4) top = window.scrollY + rect.bottom + 6;
    let left = window.scrollX + rect.left + rect.width / 2 - tw / 2;
    left = Math.max(window.scrollX + 4, Math.min(left, window.scrollX + document.documentElement.clientWidth - tw - 4));
    hoverToolbar.style.top = top + "px";
    hoverToolbar.style.left = left + "px";

    hoverToolbar.addEventListener("mouseenter", () => clearTimeout(hoverHideTimer));
    hoverToolbar.addEventListener("mouseleave", () => scheduleHoverHide());
  }
  function scheduleHoverHide() {
    clearTimeout(hoverHideTimer);
    hoverHideTimer = setTimeout(hideHoverToolbar, 220);
  }
  function hideHoverToolbar() {
    clearTimeout(hoverHideTimer);
    if (hoverToolbar) { hoverToolbar.remove(); hoverToolbar = null; }
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

    // Inline comment editor — always shown so the user can add one
    const noteWrap = document.createElement("div");
    noteWrap.className = "pop-note-wrap";
    const noteLabel = document.createElement("div");
    noteLabel.className = "pop-note-label";
    noteLabel.textContent = "Comment";
    const noteArea = document.createElement("textarea");
    noteArea.className = "pop-note-input";
    noteArea.rows = 2;
    noteArea.placeholder = "Add a comment…";
    noteArea.value = h.note || "";
    noteArea.maxLength = 4000;
    let noteSaveTimer;
    const saveNoteSoon = () => {
      clearTimeout(noteSaveTimer);
      const indicator = noteWrap.querySelector(".pop-note-status");
      if (indicator) indicator.textContent = "";
      noteSaveTimer = setTimeout(async () => {
        h.note = noteArea.value;
        const idx = highlights.findIndex(x => x.id === h.id);
        if (idx >= 0) highlights[idx].note = h.note;
        await saveHighlights();
        renderPanel();
        if (indicator) {
          indicator.textContent = "Saved";
          setTimeout(() => { if (indicator) indicator.textContent = ""; }, 1100);
        }
      }, 350);
    };
    noteArea.addEventListener("input", saveNoteSoon);
    noteArea.addEventListener("click", e => e.stopPropagation());
    // Save immediately on blur to be safe
    noteArea.addEventListener("blur", () => {
      clearTimeout(noteSaveTimer);
      h.note = noteArea.value;
      const idx = highlights.findIndex(x => x.id === h.id);
      if (idx >= 0) highlights[idx].note = h.note;
      saveHighlights().then(() => renderPanel());
    });
    const statusEl = document.createElement("span");
    statusEl.className = "pop-note-status";
    noteLabel.appendChild(statusEl);
    noteWrap.appendChild(noteLabel);
    noteWrap.appendChild(noteArea);
    popover.appendChild(noteWrap);

    // Recolor row
    if (palette && palette.length) {
      const colors = document.createElement("div");
      colors.className = "pop-colors";
      palette.forEach(c => {
        const sw = document.createElement("button");
        sw.className = "pop-swatch";
        sw.style.backgroundColor = c.bg;
        sw.style.color = c.fg;
        sw.textContent = "A";
        sw.title = c.name;
        if (c.bg === h.bg) sw.classList.add("active");
        sw.addEventListener("click", e => {
          e.stopPropagation();
          recolorHighlight(h, c.bg, c.fg);
          // Repaint the text strip inside the popover so it reflects the change
          const txt = popover.querySelector(".pop-text");
          if (txt) { txt.style.background = c.bg; txt.style.color = c.fg; }
          popover.querySelectorAll(".pop-swatch").forEach(s => s.classList.toggle("active", s === sw));
        });
        colors.appendChild(sw);
      });
      popover.appendChild(colors);
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
  document.addEventListener("scroll", () => { hidePopover(); hideHoverToolbar(); }, { passive: true });

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
    } else if (msg.type === "getContextForShare") {
      // Enrich each saved highlight with prefix/suffix from the current document
      const enriched = highlights.map(h => {
        const ctx = getContextAround(h.range);
        return { ...h, prefix: ctx.prefix, suffix: ctx.suffix };
      });
      sendResponse({ ok: true, highlights: enriched });
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

  // ---------- text-quote selectors (for resilient share/restore) ----------
  function buildTextSegments() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue.length) return NodeFilter.FILTER_REJECT;
        if (n.parentElement && n.parentElement.closest(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const segs = [];
    let cursor = 0;
    let node;
    while ((node = walker.nextNode())) {
      segs.push({ node, start: cursor, end: cursor + node.nodeValue.length });
      cursor += node.nodeValue.length;
    }
    return { segs, fullText: segs.map(s => s.node.nodeValue).join("") };
  }

  function positionToNode(segs, pos) {
    // Binary-ish linear walk; segments count is moderate
    for (const s of segs) {
      if (pos >= s.start && pos <= s.end) {
        return { node: s.node, offset: pos - s.start };
      }
    }
    return null;
  }

  function findRangeByText(text, prefix, suffix) {
    if (!text) return null;
    const { segs, fullText } = buildTextSegments();
    let pos = -1;
    if (prefix || suffix) {
      const target = (prefix || "") + text + (suffix || "");
      pos = fullText.indexOf(target);
      if (pos >= 0) pos += (prefix ? prefix.length : 0);
    }
    if (pos < 0) {
      // Fall back: just find the text. If the prefix/suffix are present anywhere
      // in the doc, prefer the occurrence closest to that anchor.
      const occurrences = [];
      let i = -1;
      while ((i = fullText.indexOf(text, i + 1)) >= 0) occurrences.push(i);
      if (!occurrences.length) return null;
      if (prefix) {
        const anchor = fullText.indexOf(prefix);
        if (anchor >= 0) {
          occurrences.sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor));
        }
      }
      pos = occurrences[0];
    }
    const start = positionToNode(segs, pos);
    const end = positionToNode(segs, pos + text.length);
    if (!start || !end) return null;
    try {
      const r = document.createRange();
      r.setStart(start.node, start.offset);
      r.setEnd(end.node, end.offset);
      return r;
    } catch { return null; }
  }

  function getContextAround(serialized) {
    // For an existing highlight (with XPath range), return prefix/suffix from the live document.
    try {
      const r = deserializeRange(serialized);
      if (!r) return { prefix: "", suffix: "" };
      const { segs, fullText } = buildTextSegments();
      // Find this text occurrence using the range's text
      const text = r.toString();
      const idx = fullText.indexOf(text);
      if (idx < 0) return { prefix: "", suffix: "" };
      const prefix = fullText.slice(Math.max(0, idx - CONTEXT_LEN), idx);
      const suffix = fullText.slice(idx + text.length, idx + text.length + CONTEXT_LEN);
      return { prefix, suffix };
    } catch { return { prefix: "", suffix: "" }; }
  }

  // ---------- share: build & receive ----------
  function applyHighlightFromPayload(p) {
    // Build a working highlight object with both XPath and text-quote info.
    // We keep prefix/suffix on the object so the MutationObserver re-apply
    // path can fall back to text search if the XPath becomes stale.
    const h = {
      id: p.id, bg: p.bg, fg: p.fg,
      text: p.text,
      note: p.note || "",
      tags: p.tags || [],
      url: location.origin + location.pathname,
      title: document.title,
      createdAt: Date.now(),
      range: p.r ? {
        startXPath: p.r.sx, startOffset: p.r.so,
        endXPath: p.r.ex,   endOffset: p.r.eo,
        text: p.text
      } : null,
      prefix: p.p || "",
      suffix: p.s || "",
      _shared: true
    };

    // Try XPath restore first
    let range = h.range ? deserializeRange(h.range) : null;
    if (!range || range.toString().trim() !== p.text.trim()) {
      // Fallback: text-quote search
      range = findRangeByText(p.text, p.p || "", p.s || "");
      if (range) {
        // Update serialized form to reflect the actual found location
        h.range = {
          startXPath: getXPath(range.startContainer),
          startOffset: range.startOffset,
          endXPath: getXPath(range.endContainer),
          endOffset: range.endOffset,
          text: p.text
        };
      }
    }
    if (!range) return false;
    wrapRange(range, h.id, h.bg, h.fg);
    pendingShared.push(h);
    return true;
  }

  function b64UrlToBytesShared(s) {
    let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  }
  async function decodeShareEncShared(enc) {
    if (enc.charAt(0) === "z" && typeof DecompressionStream !== "undefined") {
      try {
        const bytes = b64UrlToBytesShared(enc.slice(1));
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
        return await new Response(stream).text();
      } catch {}
    }
    try {
      return new TextDecoder().decode(b64UrlToBytesShared(enc));
    } catch { return null; }
  }

  async function applySharedFromUrl() {
    let enc = null;
    try {
      const params = new URLSearchParams(location.search);
      if (params.has("hlshare")) enc = params.get("hlshare");
    } catch {}
    if (!enc) {
      const m = location.hash.match(/hlshare=([^&]+)/);
      if (m) enc = m[1];
    }
    if (!enc) return;

    const json = await decodeShareEncShared(enc);
    if (!json) return;
    let payload;
    try { payload = JSON.parse(json); } catch { return; }
    if (!payload || !Array.isArray(payload.highlights)) return;

    pendingShared = [];
    let applied = 0;
    payload.highlights.forEach(p => {
      if (highlights.some(h => h.id === p.id)) return;
      if (applyHighlightFromPayload(p)) applied++;
    });
    if (applied > 0) showShareBanner(applied, payload.highlights.length);
    renderPanel();
  }

  function showShareBanner(applied, total) {
    if (shareBanner) shareBanner.remove();
    shareBanner = document.createElement("div");
    shareBanner.id = "hl-share-banner";
    const note = applied < total
      ? ` <span class="hl-sb-note">(${total - applied} couldn't be matched)</span>`
      : "";
    shareBanner.innerHTML = `
      <span class="hl-sb-text">✨ <b>${applied}</b> shared ${applied === 1 ? "highlight" : "highlights"} on this page${note}</span>
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
      try {
        const u = new URL(location.href);
        u.searchParams.delete("hlshare");
        let newHash = u.hash.replace(/[?&]?hlshare=[^&]*/, "").replace(/^#&/, "#");
        if (newHash === "#") newHash = "";
        history.replaceState(null, "", u.pathname + u.search + newHash);
      } catch {}
    });
    shareBanner.querySelector(".hl-sb-dismiss").addEventListener("click", () => {
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


  // ---------- SPA handling: watch URL changes (Twitter/X, etc.) ----------
  let currentPath = normalisedPath();
  async function onUrlChange() {
    const np = normalisedPath();
    if (np === currentPath) return;
    currentPath = np;
    PAGE_KEY = currentPageKey();
    document.querySelectorAll(".hl-mark").forEach(m => {
      const txt = document.createTextNode(m.textContent);
      m.parentNode.replaceChild(txt, m);
    });
    document.body.normalize();
    await loadHighlights();
    setTimeout(() => { applyAllHighlights(); renderPanel(); }, 400);
  }
  (function hookHistory() {
    const wrap = (name) => {
      const orig = history[name];
      history[name] = function () {
        const r = orig.apply(this, arguments);
        setTimeout(onUrlChange, 0);
        return r;
      };
    };
    wrap("pushState");
    wrap("replaceState");
    window.addEventListener("popstate", () => setTimeout(onUrlChange, 0));
  })();

  // Belt-and-braces: poll the URL too. Some SPAs (Substack reader, certain
  // React-router setups) cache a reference to history.pushState before we
  // get to wrap it, so our hook never fires for their soft navigations.
  // Polling location.href catches the URL change no matter how it happened.
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      onUrlChange();
    }
  }, 400);

  // Also try the modern Navigation API where supported — fires synchronously
  // before the URL is committed, so we use rAF to wait for location.href to
  // catch up before reading it.
  if (typeof navigation !== "undefined" && navigation.addEventListener) {
    try {
      navigation.addEventListener("navigate", () => {
        requestAnimationFrame(() => {
          if (location.href !== lastHref) {
            lastHref = location.href;
            onUrlChange();
          }
        });
      });
    } catch {}
  }

  // ---------- re-apply highlights when the page mutates (SPA re-renders) ----------
  let reapplyTimer = null;
  let reapplyInFlight = false;
  function scheduleReapply() {
    if (reapplyInFlight) return;
    const have = highlights.length + (pendingShared ? pendingShared.length : 0);
    if (!have) return;
    clearTimeout(reapplyTimer);
    reapplyTimer = setTimeout(() => {
      // Detect if any highlight (saved OR pending from a share link) is missing
      const isMissing = (h) =>
        !document.querySelector(`.hl-mark[data-hl-id="${h.id}"]`);
      const missing =
        highlights.some(isMissing) ||
        (pendingShared && pendingShared.some(isMissing));
      if (!missing) return;
      reapplyInFlight = true;
      try { applyAllHighlights(); } catch {}
      reapplyInFlight = false;
    }, 250);
  }
  const domObserver = new MutationObserver((muts) => {
    // Skip if mutations are only from our own overlay/popover/toolbar
    let interesting = false;
    for (const m of muts) {
      const t = m.target;
      if (!t) continue;
      if (t.id === "hl-panel" || t.closest?.("#hl-panel,#hl-toolbar,#hl-popover,#hl-draw-toolbar,#hl-draw-canvas")) continue;
      interesting = true; break;
    }
    if (interesting) scheduleReapply();
  });

  // ---------- init ----------
  // ---------- announce extension presence to Highlighter-owned pages ----------
  // The shared-gallery and landing pages check for this marker to hide the
  // "Install Highlighter" banner when the viewer already has the extension.
  function announcePresenceIfHighlighterPage() {
    const host = location.hostname;
    const isOurPage =
      host === "highlighter-share.finnjclancy.workers.dev" ||
      host === "finnjclancy.github.io";
    if (!isOurPage) return;
    const mark = () => {
      if (document.getElementById("__hl-ext-installed")) return;
      const m = document.createElement("meta");
      m.id = "__hl-ext-installed";
      m.name = "highlighter-extension-installed";
      m.content = "1";
      (document.head || document.documentElement).appendChild(m);
      document.documentElement.dataset.hlExtension = "installed";
    };
    mark();
    // Also re-announce after a tick in case the page swaps its <head>
    setTimeout(mark, 500);
  }

  (async function init() {
    announcePresenceIfHighlighterPage();
    await loadPalette();
    await loadHighlights();
    buildPanel();
    // Wait a tick for late-rendering pages
    setTimeout(() => {
      applyAllHighlights();
      renderPanel();
      checkHash();
      applySharedFromUrl();
    }, 300);
    // Watch body for SPA re-renders
    if (document.body) {
      domObserver.observe(document.body, { childList: true, subtree: true });
    }
  })();
})();
