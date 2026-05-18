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

  let tool = "pen";           // pen | line | rect | text
  let color = COLORS[0];
  let width = WIDTHS[1];

  let strokes = [];           // persisted shapes
  let drawingShape = null;    // in-progress stroke
  let startPt = null;
  let resizeObs = null;

  // ---------- storage ----------
  async function loadStrokes() {
    const data = await chrome.storage.local.get(STORE_KEY);
    strokes = data[STORE_KEY] || [];
  }
  async function saveStrokes() {
    await chrome.storage.local.set({ [STORE_KEY]: strokes });
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

  function editExistingText(stroke, element) {
    if (textInput) textInput.remove();
    const input = document.createElement("textarea");
    textInput = input;
    input.id = "hl-draw-text-input";
    input.rows = 1;
    input.value = stroke.text || "";
    input.placeholder = "Type, then Enter — empty to delete";
    input.style.left = stroke.x + "px";
    input.style.top  = stroke.y + "px";
    input.style.color = stroke.color;
    input.style.fontSize = (stroke.fontSize || 22) + "px";
    input.style.minWidth = Math.max(120, (stroke.fontSize || 22) * 6) + "px";
    // Hide the SVG text while editing so we don't see both
    element.style.visibility = "hidden";
    document.body.appendChild(input);
    input.focus();
    input.select();

    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      const newText = input.value;
      input.remove();
      textInput = null;
      if (!newText.trim()) {
        // Empty value → delete the text element
        strokes = strokes.filter(s => s.id !== stroke.id);
        element.remove();
        saveStrokes();
        return;
      }
      stroke.text = newText;
      element.textContent = newText;
      element.style.visibility = "";
      saveStrokes();
    };
    const cancel = () => {
      committed = true;
      input.remove();
      textInput = null;
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
      rect: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="5" width="16" height="14" rx="1"/></svg>`,
      text: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`,
      eraser: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M15.5 3.5l5 5L9 20H4v-5z"/></svg>`,
      undo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 00-15-6.7L3 13"/></svg>`,
      clear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg>`,
      close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`
    };
    return icons[name] || "";
  }

  function buildToolbar() {
    toolbar = document.createElement("div");
    toolbar.id = "hl-draw-toolbar";

    const tools = [
      { id: "pen", title: "Pen (free draw)" },
      { id: "line", title: "Line" },
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

    addDivider();

    const closeBtn = document.createElement("button");
    closeBtn.className = "hl-dt-btn hl-dt-close";
    closeBtn.title = "Exit drawing mode";
    closeBtn.innerHTML = svgIcon("close");
    closeBtn.addEventListener("click", () => setActive(false));
    toolbar.appendChild(closeBtn);

    document.body.appendChild(toolbar);
  }

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
    if (!confirm("Clear all drawings on this page?")) return;
    strokes = [];
    renderAll();
    saveStrokes();
  }

  // ---------- toggle ----------
  async function setActive(on) {
    active = !!on;
    if (active) {
      if (!canvas) {
        buildCanvas();
        await loadStrokes();
        renderAll();
      }
      canvas.classList.add("hl-draw-active");
      if (!toolbar) buildToolbar();
      else toolbar.style.display = "flex";
      // Reflect tool class
      canvas.classList.toggle("tool-text", tool === "text");
    } else {
      if (canvas) canvas.classList.remove("hl-draw-active", "tool-text");
      if (toolbar) toolbar.style.display = "none";
      if (textInput) { textInput.remove(); textInput = null; }
    }
    // Notify the overlay panel button if it exists
    const btn = document.querySelector("#hl-panel .hl-panel-draw");
    if (btn) btn.classList.toggle("active", active);
    window.dispatchEvent(new CustomEvent("hl-draw-state", { detail: { active } }));
  }

  function toggle() { setActive(!active); }

  // Always render existing strokes on load (read-only mode), even before activating.
  // This makes drawings visible immediately when revisiting.
  async function initPassive() {
    await loadStrokes();
    if (!strokes.length) return;
    buildCanvas();
    renderAll();
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
