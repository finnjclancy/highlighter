const DEFAULT_PALETTE = [
  { name: "Yellow",  bg: "#fff59d", fg: "#1a1a1a" },
  { name: "Green",   bg: "#b9f6ca", fg: "#0b3d1a" },
  { name: "Pink",    bg: "#f8bbd0", fg: "#4a0028" },
  { name: "Blue",    bg: "#b3e5fc", fg: "#0b2a3d" },
  { name: "Orange",  bg: "#ffcc80", fg: "#3d1f00" },
  { name: "Purple",  bg: "#d1c4e9", fg: "#1c0b3d" },
  { name: "Red",     bg: "#ffab91", fg: "#3d0b00" },
  { name: "Dark",    bg: "#263238", fg: "#ffffff" }
];

const PRESETS = [
  {
    name: "Classic",
    palette: DEFAULT_PALETTE
  },
  {
    name: "Pastel",
    palette: [
      { name: "Cream",   bg: "#fef3c7", fg: "#451a03" },
      { name: "Mint",    bg: "#d1fae5", fg: "#064e3b" },
      { name: "Sky",     bg: "#dbeafe", fg: "#1e3a8a" },
      { name: "Rose",    bg: "#fce7f3", fg: "#831843" },
      { name: "Lilac",   bg: "#ede9fe", fg: "#4c1d95" }
    ]
  },
  {
    name: "Neon",
    palette: [
      { name: "Lime",    bg: "#ccff00", fg: "#000000" },
      { name: "Magenta", bg: "#ff00ff", fg: "#ffffff" },
      { name: "Cyan",    bg: "#00ffff", fg: "#000000" },
      { name: "Yellow",  bg: "#ffff00", fg: "#000000" }
    ]
  },
  {
    name: "Dark mode",
    palette: [
      { name: "Slate",   bg: "#334155", fg: "#f1f5f9" },
      { name: "Plum",    bg: "#581c87", fg: "#fae8ff" },
      { name: "Ocean",   bg: "#0c4a6e", fg: "#e0f2fe" },
      { name: "Forest",  bg: "#14532d", fg: "#dcfce7" }
    ]
  },
  {
    name: "Monochrome",
    palette: [
      { name: "Light",   bg: "#e5e5e5", fg: "#171717" },
      { name: "Mid",     bg: "#a3a3a3", fg: "#0a0a0a" },
      { name: "Dark",    bg: "#404040", fg: "#fafafa" }
    ]
  }
];

const SAMPLE_TEXT = "The quick brown fox jumps over the lazy dog. " +
  "Highlights make important text stand out so you can revisit your thinking later.";

let palette = [];
const gridEl = document.getElementById("grid");
const sampleEl = document.getElementById("sample");
const presetsEl = document.getElementById("presets");

function renderSample() {
  sampleEl.innerHTML = "";
  if (palette.length === 0) {
    sampleEl.textContent = SAMPLE_TEXT;
    return;
  }
  // Split text by words and apply colors round-robin to first N segments
  const words = SAMPLE_TEXT.split(" ");
  const chunkSize = Math.max(2, Math.ceil(words.length / (palette.length * 2)));
  let ci = 0;
  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize).join(" ") + " ";
    if (ci < palette.length && i % (chunkSize * 2) === 0) {
      const span = document.createElement("span");
      span.className = "mark";
      span.style.background = palette[ci].bg;
      span.style.color = palette[ci].fg;
      span.textContent = chunk;
      sampleEl.appendChild(span);
      ci++;
    } else {
      sampleEl.appendChild(document.createTextNode(chunk));
    }
  }
}

function renderPresets() {
  presetsEl.innerHTML = "";
  PRESETS.forEach(p => {
    const el = document.createElement("button");
    el.className = "preset";
    const dots = document.createElement("span");
    dots.className = "dots";
    p.palette.slice(0, 5).forEach(c => {
      const d = document.createElement("span");
      d.className = "dot";
      d.style.background = c.bg;
      dots.appendChild(d);
    });
    el.appendChild(dots);
    const lbl = document.createElement("span");
    lbl.textContent = p.name;
    el.appendChild(lbl);
    el.addEventListener("click", () => {
      palette = JSON.parse(JSON.stringify(p.palette));
      renderAll();
    });
    presetsEl.appendChild(el);
  });
}

function renderGrid() {
  gridEl.innerHTML = "";
  palette.forEach((c, i) => gridEl.appendChild(renderCard(c, i)));
  const add = document.createElement("button");
  add.className = "add-card";
  add.textContent = "＋ Add color";
  add.addEventListener("click", () => {
    palette.push({ name: "New", bg: "#ffeb3b", fg: "#000000" });
    renderAll();
  });
  gridEl.appendChild(add);
}

function renderCard(c, i) {
  const card = document.createElement("div");
  card.className = "card";
  card.draggable = true;
  card.dataset.idx = i;

  card.innerHTML = `
    <div class="swatch-preview" style="background:${c.bg};color:${c.fg};">${escape(c.name) || "Aa"}</div>
    <input class="name-input" value="${escapeAttr(c.name)}" placeholder="Name">
    <div class="color-row">
      <span class="label">Background</span>
      <span class="ctrl">
        <input type="text" class="bg-hex" value="${c.bg}">
        <input type="color" class="bg-col" value="${c.bg}">
      </span>
    </div>
    <div class="color-row">
      <span class="label">Text color</span>
      <span class="ctrl">
        <input type="text" class="fg-hex" value="${c.fg}">
        <input type="color" class="fg-col" value="${c.fg}">
      </span>
    </div>
    <div class="card-actions">
      <div class="left">
        <button class="icon-btn" data-act="dup">Duplicate</button>
        <button class="icon-btn" data-act="swap">↔ Swap</button>
      </div>
      <button class="icon-btn danger" data-act="del">Delete</button>
    </div>
  `;

  const preview = card.querySelector(".swatch-preview");
  const nameInp = card.querySelector(".name-input");
  const bgHex = card.querySelector(".bg-hex");
  const bgCol = card.querySelector(".bg-col");
  const fgHex = card.querySelector(".fg-hex");
  const fgCol = card.querySelector(".fg-col");

  function syncPreview() {
    preview.style.background = palette[i].bg;
    preview.style.color = palette[i].fg;
    preview.textContent = palette[i].name || "Aa";
    renderSample();
  }

  nameInp.addEventListener("input", () => { palette[i].name = nameInp.value; syncPreview(); });
  bgHex.addEventListener("input", () => {
    if (/^#[0-9a-fA-F]{6}$/.test(bgHex.value)) { palette[i].bg = bgHex.value; bgCol.value = bgHex.value; syncPreview(); }
  });
  bgCol.addEventListener("input", () => { palette[i].bg = bgCol.value; bgHex.value = bgCol.value; syncPreview(); });
  fgHex.addEventListener("input", () => {
    if (/^#[0-9a-fA-F]{6}$/.test(fgHex.value)) { palette[i].fg = fgHex.value; fgCol.value = fgHex.value; syncPreview(); }
  });
  fgCol.addEventListener("input", () => { palette[i].fg = fgCol.value; fgHex.value = fgCol.value; syncPreview(); });

  card.querySelector('[data-act="del"]').addEventListener("click", () => {
    palette.splice(i, 1); renderAll();
  });
  card.querySelector('[data-act="dup"]').addEventListener("click", () => {
    palette.splice(i + 1, 0, { ...palette[i] }); renderAll();
  });
  card.querySelector('[data-act="swap"]').addEventListener("click", () => {
    const t = palette[i].bg; palette[i].bg = palette[i].fg; palette[i].fg = t;
    renderAll();
  });

  // Drag and drop reorder
  card.addEventListener("dragstart", e => {
    card.classList.add("dragging");
    e.dataTransfer.setData("text/plain", String(i));
    e.dataTransfer.effectAllowed = "move";
  });
  card.addEventListener("dragend", () => card.classList.remove("dragging"));
  card.addEventListener("dragover", e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; });
  card.addEventListener("drop", e => {
    e.preventDefault();
    const from = parseInt(e.dataTransfer.getData("text/plain"), 10);
    const to = i;
    if (from === to || isNaN(from)) return;
    const [m] = palette.splice(from, 1);
    palette.splice(to, 0, m);
    renderAll();
  });

  return card;
}

function renderAll() { renderGrid(); renderSample(); }

function escape(s) { return String(s ?? "").replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }
function escapeAttr(s) { return String(s ?? "").replace(/"/g, "&quot;"); }

document.getElementById("save").addEventListener("click", async () => {
  await chrome.storage.sync.set({ palette });
  const s = document.getElementById("status");
  s.classList.add("show");
  setTimeout(() => s.classList.remove("show"), 1500);
});
document.getElementById("reset").addEventListener("click", () => {
  palette = JSON.parse(JSON.stringify(DEFAULT_PALETTE));
  renderAll();
});

(async function init() {
  renderPresets();
  const { palette: p } = await chrome.storage.sync.get("palette");
  palette = p && p.length ? p : JSON.parse(JSON.stringify(DEFAULT_PALETTE));
  renderAll();
})();
