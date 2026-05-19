(() => {
  if (window.__hlDrawingLoaded) return;
  window.__hlDrawingLoaded = true;

  const SVG_NS = "http://www.w3.org/2000/svg";
  const STORE_KEY = "hl_draw_" + location.origin + location.pathname;

  const COLORS = ["#ef4444", "#f59e0b", "#eab308", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#0f172a"];
  const WIDTHS = [2, 5, 10];

  let canvas = null;
  let toolbar = null;
  let active = false;

  let tool = "pen";           // pen | line | arrow | rect | text
  let color = COLORS[0];
  let width = WIDTHS[1];

  let strokes = [];           // persisted shapes
  let drawingShape = null;    // in-progress stroke
  let startPt = null;
  let resizeObs = null;

  // Once chrome.* APIs start throwing 'Extension context invalidated' (the
  // user reloaded the unpacked extension while this tab was open), this
  // content script becomes a zombie. Flip a flag so we silently no-op
  // instead of spamming the page console with promise rejections.
  let extensionAlive = true;
  function checkAlive() {
    try { return extensionAlive && !!(chrome && chrome.runtime && chrome.runtime.id); }
    catch { extensionAlive = false; return false; }
  }
  window.addEventListener("unhandledrejection", (e) => {
    const msg = (e.reason && (e.reason.message || String(e.reason))) || "";
    if (msg.includes("Extension context invalidated")) {
      extensionAlive = false;
      e.preventDefault();
    }
  });

  // ---------- storage ----------
  async function loadStrokes() {
    if (!checkAlive()) return;
    try {
      const data = await chrome.storage.local.get(STORE_KEY);
      strokes = data[STORE_KEY] || [];
    } catch { extensionAlive = false; }
  }
  async function saveStrokes() {
    if (!checkAlive()) return;
    try { await chrome.storage.local.set({ [STORE_KEY]: strokes }); }
    catch { extensionAlive = false; }
  }

  // ---------- canvas ----------
  function buildCanvas() {
    canvas = document.createElementNS(SVG_NS, "svg");
    canvas.id = "hl-draw-canvas";
    canvas.setAttribute("xmlns", SVG_NS);
    sizeCanvas();
    document.body.appendChild(canvas);

    resizeObs = new ResizeObserver(sizeCanvas);
    resizeObs.observe(document.documentElement);
    window.addEventListener("resize", sizeCanvas);

    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function sizeCanvas() {
    if (!canvas) return;
    const w = Math.max(document.documentElement.scrollWidth, document.documentElement.clientWidth);
    const h = Math.max(document.documentElement.scrollHeight, document.documentElement.clientHeight);
    canvas.setAttribute("width", w);
    canvas.setAttribute("height", h);
    canvas.setAttribute("viewBox", `0 0 ${w} ${h}`);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
  }

  function renderAll() {
    if (!canvas) return;
    // Remove all existing children
    while (canvas.firstChild) canvas.removeChild(canvas.firstChild);
    strokes.forEach(renderStroke);
  }

  function renderStroke(s) {
    let el;
    if (s.type === "pen") {
      el = document.createElementNS(SVG_NS, "path");
      el.setAttribute("d", pointsToPath(s.points));
      el.setAttribute("fill", "none");
      el.setAttribute("stroke-linecap", "round");
      el.setAttribute("stroke-linejoin", "round");
    } else if (s.type === "line") {
      el = document.createElementNS(SVG_NS, "line");
      el.setAttribute("x1", s.x1);
      el.setAttribute("y1", s.y1);
      el.setAttribute("x2", s.x2);
      el.setAttribute("y2", s.y2);
      el.setAttribute("stroke-linecap", "round");
    } else if (s.type === "rect") {
      el = document.createElementNS(SVG_NS, "rect");
      const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2);
      const w = Math.abs(s.x2 - s.x1), h = Math.abs(s.y2 - s.y1);
      el.setAttribute("x", x);
      el.setAttribute("y", y);
      el.setAttribute("width", w);
      el.setAttribute("height", h);
      el.setAttribute("fill", "none");
    } else if (s.type === "arrow") {
      // Group: a stroked shaft + a filled triangular head at (x2, y2).
      // The shaft stops *inside* the triangle so the join is seamless and
      // the line doesn't visually poke through the arrowhead.
      const g = document.createElementNS(SVG_NS, "g");
      g.dataset.id = s.id;

      const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
      const len = Math.hypot(dx, dy);
      if (len < 1) { canvas.appendChild(g); return g; }

      const w = s.width || 5;
      // Slightly chunkier than before — feels more like a proper arrow head
      // than a needle. Length:width ≈ 1.15 (was 1.33).
      const headLen = Math.max(14, w * 4.5);
      const headW   = Math.max(12, w * 4);
      const ux = dx / len, uy = dy / len;

      // Shaft endpoint: just inside the back of the triangle so the join is
      // hidden beneath the filled head — no visible "line into triangle".
      const overlap = Math.max(1.5, w * 0.4);
      const shaftEndX = s.x2 - ux * (headLen - overlap);
      const shaftEndY = s.y2 - uy * (headLen - overlap);

      // Triangle: tip at (x2, y2), base perpendicular to shaft, centred.
      const baseX = s.x2 - ux * headLen;
      const baseY = s.y2 - uy * headLen;
      const px = -uy, py = ux;
      const ax = baseX + px * (headW / 2);
      const ay = baseY + py * (headW / 2);
      const bx = baseX - px * (headW / 2);
      const by = baseY - py * (headW / 2);

      // Shaft
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", s.x1);
      line.setAttribute("y1", s.y1);
      line.setAttribute("x2", shaftEndX);
      line.setAttribute("y2", shaftEndY);
      line.setAttribute("stroke", s.color);
      line.setAttribute("stroke-width", w);
      line.setAttribute("stroke-linecap", "round");
      g.appendChild(line);

      // Arrowhead — rounded join so the wings don't look razor-sharp
      const head = document.createElementNS(SVG_NS, "polygon");
      head.setAttribute("points", `${s.x2},${s.y2} ${ax},${ay} ${bx},${by}`);
      head.setAttribute("fill", s.color);
      head.setAttribute("stroke", s.color);
      head.setAttribute("stroke-width", Math.max(1, w * 0.6));
      head.setAttribute("stroke-linejoin", "round");
      head.setAttribute("stroke-linecap", "round");
      g.appendChild(head);

      canvas.appendChild(g);
      return g;
    } else if (s.type === "text") {
      el = document.createElementNS(SVG_NS, "text");
      el.setAttribute("x", s.x);
      el.setAttribute("y", s.y);
      el.setAttribute("fill", s.color);
      el.setAttribute("font-size", s.fontSize || 22);
      el.setAttribute("font-family", "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif");
      el.setAttribute("font-weight", "600");
      el.setAttribute("dominant-baseline", "text-before-edge");
      el.textContent = s.text || "";
      el.dataset.id = s.id;
      canvas.appendChild(el);
      return el;
    } else {
      return;
    }
    el.setAttribute("stroke", s.color);
    el.setAttribute("stroke-width", s.width);
    el.dataset.id = s.id;
    canvas.appendChild(el);
    return el;
  }

  function fontSizeForWidth(w) {
    if (w <= 2) return 16;
    if (w <= 5) return 24;
    return 36;
  }

  function pointsToPath(points) {
    if (!points.length) return "";
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i].x} ${points[i].y}`;
    }
    return d;
  }

  // ---------- text tool ----------
  let textInput = null;
  function promptForText(e) {
    if (textInput) textInput.remove();
    const pt = evtPoint(e);
    const fontSize = fontSizeForWidth(width);

    const input = document.createElement("textarea");
    textInput = input;
    input.id = "hl-draw-text-input";
    input.rows = 1;
    input.placeholder = "Type, then Enter…";
    input.style.left = (pt.x) + "px";
    input.style.top  = (pt.y) + "px";
    input.style.color = color;
    input.style.fontSize = fontSize + "px";
    input.style.minWidth = Math.max(120, fontSize * 6) + "px";
    document.body.appendChild(input);
    input.focus();

    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      const text = input.value;
      input.remove();
      textInput = null;
      if (!text.trim()) return;
      const stroke = {
        id: "d_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
        type: "text",
        color, fontSize,
        x: pt.x, y: pt.y,
        text
      };
      strokes.push(stroke);
      renderStroke(stroke);
      saveStrokes();
    };
    const cancel = () => {
      committed = true;
      input.remove();
      textInput = null;
    };

    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        commit();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        cancel();
      }
    });
    input.addEventListener("blur", commit);
    // Prevent click-through from dismissing the canvas
    input.addEventListener("mousedown", ev => ev.stopPropagation());
  }

  // ---------- input ----------
  function evtPoint(e) {
    return { x: e.clientX + window.scrollX, y: e.clientY + window.scrollY };
  }

  // Drag state for moving an existing text element
  let dragText = null; // { element, stroke, startMouseX, startMouseY, origX, origY, moved }
  const DRAG_THRESHOLD = 4;

  function findTextHit(target) {
    if (!target) return null;
    const id = target.dataset?.id;
    if (!id) return null;
    if (target.tagName !== "text" && target.tagName !== "TEXT") return null;
    const stroke = strokes.find(s => s.id === id);
    if (!stroke || stroke.type !== "text") return null;
    return { element: target, stroke };
  }

  function onDown(e) {
    if (!active) return;
    e.preventDefault();

    // 1) Always check if the user is grabbing an existing text element first —
    //    this works regardless of which tool is selected.
    const hit = findTextHit(e.target);
    if (hit) {
      dragText = {
        element: hit.element,
        stroke: hit.stroke,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        origX: hit.stroke.x,
        origY: hit.stroke.y,
        moved: false
      };
      hit.element.classList.add("hl-dragging");
      return;
    }

    // 2) Text tool on empty canvas — spawn a new text input
    if (tool === "text") {
      promptForText(e);
      return;
    }

    // 3) Drawing tools (pen / line / rect)
    startPt = evtPoint(e);
    const id = "d_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
    if (tool === "pen") {
      drawingShape = { id, type: "pen", color, width, points: [startPt] };
    } else if (tool === "line") {
      drawingShape = { id, type: "line", color, width, x1: startPt.x, y1: startPt.y, x2: startPt.x, y2: startPt.y };
    } else if (tool === "arrow") {
      drawingShape = { id, type: "arrow", color, width, x1: startPt.x, y1: startPt.y, x2: startPt.x, y2: startPt.y };
    } else if (tool === "rect") {
      drawingShape = { id, type: "rect", color, width, x1: startPt.x, y1: startPt.y, x2: startPt.x, y2: startPt.y };
    }
    renderStroke(drawingShape);
  }

  function onMove(e) {
    if (!active) return;

    if (dragText) {
      const dx = e.clientX - dragText.startMouseX;
      const dy = e.clientY - dragText.startMouseY;
      if (!dragText.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      dragText.moved = true;
      const nx = dragText.origX + dx;
      const ny = dragText.origY + dy;
      dragText.element.setAttribute("x", nx);
      dragText.element.setAttribute("y", ny);
      return;
    }

    if (!drawingShape) return;
    const p = evtPoint(e);
    if (drawingShape.type === "pen") {
      drawingShape.points.push(p);
      const el = canvas.querySelector(`[data-id="${drawingShape.id}"]`);
      if (el) el.setAttribute("d", pointsToPath(drawingShape.points));
    } else if (drawingShape.type === "line") {
      drawingShape.x2 = p.x; drawingShape.y2 = p.y;
      const el = canvas.querySelector(`[data-id="${drawingShape.id}"]`);
      if (el) { el.setAttribute("x2", p.x); el.setAttribute("y2", p.y); }
    } else if (drawingShape.type === "arrow") {
      drawingShape.x2 = p.x; drawingShape.y2 = p.y;
      // Arrow is a <g> with two children; easiest to rebuild on each frame
      const el = canvas.querySelector(`[data-id="${drawingShape.id}"]`);
      if (el) { el.remove(); renderStroke(drawingShape); }
    } else if (drawingShape.type === "rect") {
      drawingShape.x2 = p.x; drawingShape.y2 = p.y;
      const el = canvas.querySelector(`[data-id="${drawingShape.id}"]`);
      if (el) {
        const x = Math.min(drawingShape.x1, p.x), y = Math.min(drawingShape.y1, p.y);
        const w = Math.abs(p.x - drawingShape.x1), h = Math.abs(p.y - drawingShape.y1);
        el.setAttribute("x", x); el.setAttribute("y", y);
        el.setAttribute("width", w); el.setAttribute("height", h);
      }
    }
  }

  function onUp(e) {
    if (!active) return;

    if (dragText) {
      dragText.element.classList.remove("hl-dragging");
      if (dragText.moved) {
        // Commit the new position
        const dx = e.clientX - dragText.startMouseX;
        const dy = e.clientY - dragText.startMouseY;
        dragText.stroke.x = dragText.origX + dx;
        dragText.stroke.y = dragText.origY + dy;
        saveStrokes();
      } else {
        // No drag — treat as a click, open inline edit
        editExistingText(dragText.stroke, dragText.element);
      }
      dragText = null;
      return;
    }

    if (!drawingShape) return;
    // Discard zero-size shapes
    const negligible =
      (drawingShape.type === "pen" && drawingShape.points.length < 2) ||
      (drawingShape.type === "line" && Math.hypot(drawingShape.x2 - drawingShape.x1, drawingShape.y2 - drawingShape.y1) < 3) ||
      (drawingShape.type === "arrow" && Math.hypot(drawingShape.x2 - drawingShape.x1, drawingShape.y2 - drawingShape.y1) < 6) ||
      (drawingShape.type === "rect" && (Math.abs(drawingShape.x2 - drawingShape.x1) < 3 || Math.abs(drawingShape.y2 - drawingShape.y1) < 3));
    if (negligible) {
      const el = canvas.querySelector(`[data-id="${drawingShape.id}"]`);
      if (el) el.remove();
    } else {
      strokes.push(drawingShape);
      saveStrokes();
    }
    drawingShape = null;
    startPt = null;
  }

  // Holds the wrapper element so it can be cleaned up alongside the textarea
  let textEditor = null;

  function editExistingText(stroke, element) {
    if (textInput) textInput.remove();
    if (textEditor) { textEditor.remove(); textEditor = null; }

    // Pending values; only applied to the stroke on commit so cancel can
    // discard any colour/size tweaks the user made via the controls.
    let pendingColor = stroke.color;
    let pendingFontSize = stroke.fontSize || 22;

    // Outer wrapper — positioned at the text location
    const editor = document.createElement("div");
    editor.id = "hl-draw-text-editor";
    editor.style.left = stroke.x + "px";
    editor.style.top  = stroke.y + "px";
    textEditor = editor;

    // Floating control bar above the textarea
    const controls = document.createElement("div");
    controls.className = "hl-dt-ctrls";

    // Colour swatches
    COLORS.forEach(c => {
      const sw = document.createElement("button");
      sw.className = "hl-dt-csw";
      sw.style.background = c;
      sw.title = c;
      if (c === pendingColor) sw.classList.add("active");
      sw.addEventListener("mousedown", ev => ev.preventDefault());  // keep textarea focused
      sw.addEventListener("click", () => {
        pendingColor = c;
        input.style.color = c;
        controls.querySelectorAll(".hl-dt-csw").forEach(x => x.classList.toggle("active", x === sw));
      });
      controls.appendChild(sw);
    });

    // Divider
    const div = document.createElement("span");
    div.className = "hl-dt-cdiv";
    controls.appendChild(div);

    // Size pills (S / M / L)
    const sizeLabels = { 2: "S", 5: "M", 10: "L" };
    WIDTHS.forEach(w => {
      const fs = fontSizeForWidth(w);
      const pill = document.createElement("button");
      pill.className = "hl-dt-cpill " + (w === 2 ? "wsz-s" : w === 5 ? "wsz-m" : "wsz-l");
      pill.textContent = sizeLabels[w] || "";
      if (fs === pendingFontSize) pill.classList.add("active");
      pill.addEventListener("mousedown", ev => ev.preventDefault());
      pill.addEventListener("click", () => {
        pendingFontSize = fs;
        input.style.fontSize = fs + "px";
        input.style.minWidth = Math.max(120, fs * 6) + "px";
        controls.querySelectorAll(".hl-dt-cpill").forEach(x => x.classList.toggle("active", x === pill));
      });
      controls.appendChild(pill);
    });

    editor.appendChild(controls);

    // The text input itself — uses the existing #hl-draw-text-input styles
    const input = document.createElement("textarea");
    textInput = input;
    input.id = "hl-draw-text-input";
    input.rows = 1;
    input.value = stroke.text || "";
    input.placeholder = "Type, then Enter — empty to delete";
    input.style.color = pendingColor;
    input.style.fontSize = pendingFontSize + "px";
    input.style.minWidth = Math.max(120, pendingFontSize * 6) + "px";

    // Hide the SVG text while editing so we don't see both
    element.style.visibility = "hidden";
    editor.appendChild(input);
    document.body.appendChild(editor);
    input.focus();
    input.select();

    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      const newText = input.value;
      editor.remove();
      textInput = null;
      textEditor = null;
      if (!newText.trim()) {
        strokes = strokes.filter(s => s.id !== stroke.id);
        element.remove();
        saveStrokes();
        return;
      }
      // Apply pending colour/size changes
      stroke.text = newText;
      stroke.color = pendingColor;
      stroke.fontSize = pendingFontSize;
      element.setAttribute("fill", stroke.color);
      element.setAttribute("font-size", stroke.fontSize);
      element.textContent = newText;
      element.style.visibility = "";
      saveStrokes();
    };
    const cancel = () => {
      committed = true;
      editor.remove();
      textInput = null;
      textEditor = null;
      element.style.visibility = "";
    };

    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); commit(); }
      else if (ev.key === "Escape") { ev.preventDefault(); cancel(); }
    });
    input.addEventListener("blur", commit);
    input.addEventListener("mousedown", ev => ev.stopPropagation());
  }

  // ---------- toolbar ----------
  function svgIcon(name) {
    const icons = {
      pen: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>`,
      line: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="19" x2="19" y2="5"/></svg>`,
      arrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="19" x2="17" y2="7"/><polyline points="9 6 17 6 17 14"/></svg>`,
      rect: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="5" width="16" height="14" rx="1"/></svg>`,
      text: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`,
      eraser: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M15.5 3.5l5 5L9 20H4v-5z"/></svg>`,
      undo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 00-15-6.7L3 13"/></svg>`,
      clear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg>`,
      close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
      collapse: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 6 9 12 15 18"/></svg>`
    };
    return icons[name] || "";
  }

  function buildToolbar() {
    toolbar = document.createElement("div");
    toolbar.id = "hl-draw-toolbar";

    const tools = [
      { id: "pen", title: "Pen (free draw)" },
      { id: "line", title: "Line" },
      { id: "arrow", title: "Arrow" },
      { id: "rect", title: "Rectangle" },
      { id: "text", title: "Text" }
    ];
    tools.forEach(t => {
      const b = document.createElement("button");
      b.className = "hl-dt-btn" + (tool === t.id ? " active" : "");
      b.dataset.tool = t.id;
      b.title = t.title;
      b.innerHTML = svgIcon(t.id);
      b.addEventListener("click", () => setTool(t.id));
      toolbar.appendChild(b);
    });

    addDivider();

    COLORS.forEach(c => {
      const b = document.createElement("button");
      b.className = "hl-dt-color" + (color === c ? " active" : "");
      b.dataset.color = c;
      b.style.background = c;
      b.title = c;
      b.addEventListener("click", () => setColor(c));
      toolbar.appendChild(b);
    });

    addDivider();

    const widthLabels = { 2: "S", 5: "M", 10: "L" };
    const widthClass  = { 2: "wsz-s", 5: "wsz-m", 10: "wsz-l" };
    WIDTHS.forEach(w => {
      const b = document.createElement("button");
      b.className = "hl-dt-width " + (widthClass[w] || "") + (width === w ? " active" : "");
      b.dataset.width = w;
      b.title = (widthLabels[w] || "") + " — width " + w + "px / font " + fontSizeForWidth(w) + "px";
      b.textContent = widthLabels[w] || "";
      b.addEventListener("click", () => setWidth(w));
      toolbar.appendChild(b);
    });

    addDivider();

    const undoBtn = document.createElement("button");
    undoBtn.className = "hl-dt-btn";
    undoBtn.title = "Undo last";
    undoBtn.innerHTML = svgIcon("undo");
    undoBtn.addEventListener("click", undo);
    toolbar.appendChild(undoBtn);

    const clearBtn = document.createElement("button");
    clearBtn.className = "hl-dt-btn";
    clearBtn.title = "Clear all drawings on this page";
    clearBtn.innerHTML = svgIcon("clear");
    clearBtn.addEventListener("click", clearAll);
    toolbar.appendChild(clearBtn);

    // Always-visible toggle chip in the top-right corner. Click toggles
    // drawing mode; click-and-drag moves the toolbar (position persists).
    const toggleBtn = document.createElement("button");
    toggleBtn.className = "hl-dt-toggle";
    toggleBtn.title = "Click to open · drag to move";
    toggleBtn.innerHTML = svgIcon("pen");
    toggleBtn.addEventListener("click", () => {
      if (toolbarJustDragged) { toolbarJustDragged = false; return; }
      setActive(!active);
    });
    toggleBtn.addEventListener("mousedown", startToolbarDrag);
    toolbar.appendChild(toggleBtn);

    document.body.appendChild(toolbar);
    // Apply any saved position from a previous drag
    applySavedToolbarPos();
  }

  // ---------- toolbar drag (move the chip / toolbar around) ----------
  const TOOLBAR_POS_KEY = "hl_draw_toolbar_pos";
  const DRAG_PX_THRESHOLD = 5;
  let toolbarDrag = null;
  let toolbarJustDragged = false;

  function startToolbarDrag(e) {
    if (e.button !== 0) return;
    const r = toolbar.getBoundingClientRect();
    toolbarDrag = {
      startX: e.clientX,
      startY: e.clientY,
      origTop: r.top,
      origRight: window.innerWidth - r.right,
      moved: false
    };
  }

  function clampToolbarPos(top, right) {
    const rect = toolbar.getBoundingClientRect();
    const tw = rect.width  || 42;
    const th = rect.height || 42;
    return {
      top:   Math.max(0, Math.min(window.innerHeight - th, top)),
      right: Math.max(0, Math.min(window.innerWidth  - tw, right))
    };
  }

  function onToolbarMove(e) {
    if (!toolbarDrag) return;
    const dx = e.clientX - toolbarDrag.startX;
    const dy = e.clientY - toolbarDrag.startY;
    if (!toolbarDrag.moved && Math.hypot(dx, dy) < DRAG_PX_THRESHOLD) return;
    toolbarDrag.moved = true;
    const p = clampToolbarPos(toolbarDrag.origTop + dy, toolbarDrag.origRight - dx);
    toolbar.style.top   = p.top + "px";
    toolbar.style.right = p.right + "px";
    toolbar.style.left  = "auto";
    toolbar.style.bottom = "auto";
    toolbar.classList.add("dragging");
  }

  async function onToolbarUp() {
    if (!toolbarDrag) return;
    const wasMoved = toolbarDrag.moved;
    toolbarDrag = null;
    toolbar.classList.remove("dragging");
    if (wasMoved) {
      toolbarJustDragged = true;
      try {
        const r = toolbar.getBoundingClientRect();
        await chrome.storage.local.set({
          [TOOLBAR_POS_KEY]: { top: r.top, right: window.innerWidth - r.right }
        });
      } catch {}
    }
  }

  async function applySavedToolbarPos() {
    if (!toolbar) return;
    try {
      const data = await chrome.storage.local.get(TOOLBAR_POS_KEY);
      const pos = data[TOOLBAR_POS_KEY];
      if (!pos) return;
      const p = clampToolbarPos(pos.top, pos.right);
      toolbar.style.top = p.top + "px";
      toolbar.style.right = p.right + "px";
      toolbar.style.left = "auto";
      toolbar.style.bottom = "auto";
    } catch {}
  }

  // Document-level drag listeners (added once)
  document.addEventListener("mousemove", onToolbarMove);
  document.addEventListener("mouseup",   onToolbarUp);
  // Keep the toolbar on-screen when the viewport resizes
  window.addEventListener("resize", () => {
    if (!toolbar) return;
    const r = toolbar.getBoundingClientRect();
    const p = clampToolbarPos(r.top, window.innerWidth - r.right);
    toolbar.style.top = p.top + "px";
    toolbar.style.right = p.right + "px";
  });

  function addDivider() {
    const d = document.createElement("div");
    d.className = "hl-dt-divider";
    toolbar.appendChild(d);
  }

  function setTool(t) {
    tool = t;
    canvas?.classList.remove("tool-text");
    if (t === "text") canvas?.classList.add("tool-text");
    toolbar?.querySelectorAll("[data-tool]").forEach(b => b.classList.toggle("active", b.dataset.tool === t));
  }
  function setColor(c) {
    color = c;
    toolbar?.querySelectorAll(".hl-dt-color").forEach(b => b.classList.toggle("active", b.dataset.color === c));
  }
  function setWidth(w) {
    width = w;
    toolbar?.querySelectorAll(".hl-dt-width").forEach(b => b.classList.toggle("active", Number(b.dataset.width) === w));
  }

  function undo() {
    if (!strokes.length) return;
    strokes.pop();
    renderAll();
    saveStrokes();
  }
  function clearAll() {
    if (!strokes.length) return;
    showClearConfirm(strokes.length, () => {
      strokes = [];
      renderAll();
      saveStrokes();
    });
  }

  function showClearConfirm(count, onConfirm) {
    // Remove any existing prompt
    document.querySelectorAll("#hl-draw-confirm").forEach(n => n.remove());

    const bg = document.createElement("div");
    bg.id = "hl-draw-confirm";
    bg.innerHTML = `
      <div class="hl-dc-panel">
        <div class="hl-dc-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/>
          </svg>
        </div>
        <div class="hl-dc-title">Clear all drawings?</div>
        <div class="hl-dc-body">This removes ${count} ${count === 1 ? "drawing" : "drawings"} on this page. This cannot be undone.</div>
        <div class="hl-dc-actions">
          <button class="hl-dc-btn hl-dc-cancel">Cancel</button>
          <button class="hl-dc-btn hl-dc-ok">Clear all</button>
        </div>
      </div>
    `;
    document.body.appendChild(bg);

    const close = () => bg.remove();
    bg.querySelector(".hl-dc-cancel").addEventListener("click", close);
    bg.querySelector(".hl-dc-ok").addEventListener("click", () => {
      close();
      onConfirm();
    });
    bg.addEventListener("click", (e) => { if (e.target === bg) close(); });
    const escHandler = (e) => {
      if (e.key === "Escape") { close(); document.removeEventListener("keydown", escHandler); }
      else if (e.key === "Enter") { close(); document.removeEventListener("keydown", escHandler); onConfirm(); }
    };
    document.addEventListener("keydown", escHandler);
    // Focus the destructive button so Enter confirms, Esc cancels
    setTimeout(() => bg.querySelector(".hl-dc-ok").focus(), 30);
  }

  // ---------- toggle ----------
  async function setActive(on) {
    active = !!on;
    if (!toolbar) buildToolbar();
    if (active) {
      if (!canvas) {
        buildCanvas();
        await loadStrokes();
        renderAll();
      }
      canvas.classList.add("hl-draw-active");
      toolbar.classList.remove("collapsed");
      canvas.classList.toggle("tool-text", tool === "text");
    } else {
      if (canvas) canvas.classList.remove("hl-draw-active", "tool-text");
      toolbar.classList.add("collapsed");
      if (textInput) { textInput.remove(); textInput = null; }
    }
    // Sync the toggle chip's icon + tooltip to current state
    const chip = toolbar.querySelector(".hl-dt-toggle");
    if (chip) {
      chip.innerHTML = svgIcon(active ? "collapse" : "pen");
      chip.title = (active ? "Hide drawing toolbar" : "Open drawing toolbar") + " · drag to move";
      chip.classList.toggle("on", active);
    }
    // Notify the overlay panel button if it exists
    const btn = document.querySelector("#hl-panel .hl-panel-draw");
    if (btn) btn.classList.toggle("active", active);
    window.dispatchEvent(new CustomEvent("hl-draw-state", { detail: { active } }));
  }

  function toggle() { setActive(!active); }

  // Always render existing strokes on load (read-only mode) and ALWAYS show
  // the collapsed toolbar chip so the user can engage drawing at any time —
  // mirroring how the highlights overlay burger is always visible bottom-left.
  async function initPassive() {
    await loadStrokes();
    if (strokes.length) {
      buildCanvas();
      renderAll();
    }
    // Build the toolbar (in collapsed state) so the chip is always present
    if (!toolbar) buildToolbar();
    toolbar.classList.add("collapsed");
  }

  window.__hlDrawing = {
    toggle,
    isActive: () => active,
    setActive
  };

  // Listen to highlighter messages for cross-script invocation
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "toggleDrawing") toggle();
  });

  initPassive();
})();
