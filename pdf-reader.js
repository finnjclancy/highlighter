import * as pdfjsLib from "./vendor/pdf.mjs";

function bundledUrl(path) {
  return globalThis.chrome?.runtime?.getURL
    ? chrome.runtime.getURL(path)
    : new URL(`./${path}`, import.meta.url).href;
}

pdfjsLib.GlobalWorkerOptions.workerSrc = bundledUrl("vendor/pdf.worker.mjs");

const viewer = document.getElementById("pdf-viewer");
const status = document.getElementById("pdf-status");
const statusDetail = document.getElementById("pdf-status-detail");
const titleEl = document.getElementById("pdf-title");
const hostEl = document.getElementById("pdf-host");
const progressText = document.getElementById("pdf-progress-text");
const progressBar = document.getElementById("pdf-progress-bar");
const zoomValue = document.getElementById("zoom-value");
const openOriginal = document.getElementById("open-original");
const aiButton = document.getElementById("ai-highlight");
const aiButtonLabel = document.getElementById("ai-highlight-label");
const aiAuto = document.getElementById("ai-auto");
const aiToast = document.getElementById("ai-toast");
const aiConsent = document.getElementById("ai-consent");
const aiConsentAccept = document.getElementById("ai-consent-accept");
const aiConsentCancel = document.getElementById("ai-consent-cancel");
const aiOptionsToggle = document.getElementById("ai-options-toggle");
const aiOptionsPanel = document.getElementById("ai-options-panel");
const aiOptionsClose = document.getElementById("ai-options-close");
const aiFocus = document.getElementById("ai-focus");
const aiFocusClear = document.getElementById("ai-focus-clear");
const aiFocusRun = document.getElementById("ai-focus-run");
const agentPdfButton = document.getElementById("agent-pdf");
const agentPdfDot = document.getElementById("agent-pdf-dot");
const agentPdfPanel = document.getElementById("agent-pdf-panel");
const agentPdfClose = document.getElementById("agent-pdf-close");
const agentPdfStatus = document.getElementById("agent-pdf-status");
const agentPdfTask = document.getElementById("agent-pdf-task");
const agentPdfCopy = document.getElementById("agent-pdf-copy");
const agentPdfOpen = document.getElementById("agent-pdf-open");

const AI_ENDPOINT = "https://highlighter-share.finnjclancy.workers.dev/api/ai/highlights";
const AI_CONSENT_KEY = "hl_ai_gemini_consent_v1";
const AI_AUTO_KEY = "hl_ai_auto_highlight";
const AI_FOCUS_KEY = "hl_ai_reader_focus";
const MAX_AI_TEXT_CHARS = 260_000;

const MIN_SCALE = 0.75;
const MAX_SCALE = 2;
const SCALE_STEP = 0.25;
let scale = 1.25;
let pdfDocument = null;
let renderGeneration = 0;
let aiBusy = false;
let aiRanForDocument = false;
let consentResolver = null;
let toastTimer = null;
let aiProgressTimers = [];
let agentConnection = { enabled: false, connected: false };

function getSourceUrl() {
  try {
    const raw = new URLSearchParams(location.search).get("url");
    const url = new URL(raw || "");
    return /^https?:$/.test(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

const sourceUrl = getSourceUrl();

function setProgress(label, percent) {
  progressText.textContent = label;
  progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function showError(title, detail) {
  document.body.classList.remove("pdf-rendering");
  status.hidden = false;
  status.classList.add("pdf-error");
  status.querySelector("strong").textContent = title;
  statusDetail.textContent = detail;
  setProgress("Could not load PDF", 100);
}

function titleFromUrl(url) {
  const id = url.searchParams.get("id");
  if (id && url.hostname.endsWith("openreview.net")) return `OpenReview paper ${id}`;
  const filename = decodeURIComponent(url.pathname.split("/").pop() || "");
  return filename && filename.toLowerCase() !== "pdf" ? filename.replace(/\.pdf$/i, "") : "PDF document";
}

function normaliseAiText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function annotateAiSpans() {
  const spans = [];
  for (const page of viewer.querySelectorAll(".pdf-page")) {
    const pageNumber = Number(page.dataset.pageNumber);
    const candidates = [...page.querySelectorAll(".textLayer span")].filter(span => {
      if (span.classList.contains("hl-mark") || span.classList.contains("markedContent")) return false;
      // Keep leaf PDF.js text spans. A restored Highlighter mark is allowed as
      // a child, but structural marked-content wrappers are not.
      return ![...span.children].some(child => child.matches("span:not(.hl-mark)"));
    });
    let textIndex = 0;
    for (const span of candidates) {
      const text = normaliseAiText(span.textContent);
      if (!text) continue;
      const id = `p${pageNumber}t${textIndex++}`;
      span.dataset.aiSpanId = id;
      spans.push({ id, page: pageNumber, text });
    }
  }
  return spans;
}

function collectAiDocument() {
  const all = annotateAiSpans();
  if (!all.length) return { spans: [], truncated: false };

  const pageCount = Math.max(...all.map(item => item.page));
  const perPageBudget = Math.max(1200, Math.floor(MAX_AI_TEXT_CHARS / pageCount));
  const usedByPage = new Map();
  const spans = [];
  let total = 0;
  for (const item of all) {
    const pageUsed = usedByPage.get(item.page) || 0;
    if (pageUsed + item.text.length > perPageBudget || total + item.text.length > MAX_AI_TEXT_CHARS) continue;
    spans.push(item);
    usedByPage.set(item.page, pageUsed + item.text.length);
    total += item.text.length;
  }
  return { spans, truncated: spans.length < all.length };
}

function showAiToast(message, { error = false, persistent = false } = {}) {
  clearTimeout(toastTimer);
  aiToast.textContent = message;
  aiToast.classList.toggle("is-error", error);
  aiToast.hidden = false;
  if (!persistent) toastTimer = setTimeout(() => { aiToast.hidden = true; }, 5200);
}

function setAiBusy(busy, label = "Deep highlight") {
  aiBusy = busy;
  aiButton.disabled = busy || !pdfDocument || document.body.classList.contains("pdf-rendering");
  aiButton.classList.toggle("is-working", busy);
  aiButtonLabel.textContent = label;
}

async function getAiPreferences() {
  try {
    return await chrome.storage.local.get([AI_CONSENT_KEY, AI_AUTO_KEY, AI_FOCUS_KEY]);
  } catch {
    return {};
  }
}

function setAiOptionsOpen(open) {
  if (open) setAgentPdfOpen(false);
  aiOptionsPanel.hidden = !open;
  aiOptionsToggle.setAttribute("aria-expanded", String(open));
  if (open) setTimeout(() => aiFocus.focus(), 0);
}

function setAgentPdfOpen(open) {
  agentPdfPanel.hidden = !open;
  agentPdfButton.setAttribute("aria-expanded", String(open));
  if (open) {
    setAiOptionsOpen(false);
    refreshAgentConnection();
    setTimeout(() => agentPdfTask.focus(), 0);
  }
}

function renderAgentConnection() {
  const connected = agentConnection.connected === true;
  const enabled = agentConnection.enabled === true;
  agentPdfDot.classList.toggle("connected", connected);
  agentPdfDot.classList.toggle("reconnecting", enabled && !connected);
  agentPdfStatus.textContent = connected
    ? "Connected — your PDF tools are ready"
    : enabled
      ? "Agent is reconnecting — keep Chrome open"
      : "Connect an agent from the Highlighter extension menu first";
  agentPdfCopy.disabled = !connected || !pdfDocument;
  agentPdfOpen.disabled = !connected || !pdfDocument;
}

async function refreshAgentConnection() {
  try {
    const status = await chrome.runtime.sendMessage({ type: "getAgentConnectionStatus" });
    agentConnection = {
      enabled: status?.enabled === true,
      connected: status?.connected === true
    };
  } catch {
    agentConnection = { enabled: false, connected: false };
  }
  renderAgentConnection();
}

function buildAgentPdfPrompt() {
  const task = String(agentPdfTask.value || "").replace(/\s+/g, " ").trim() ||
    "Highlight the central claims, strongest evidence, and important caveats. Add a concise note to each highlight.";
  const cleanSource = new URL(sourceUrl.href);
  cleanSource.searchParams.delete("hlshare");
  return [
    `I am viewing “${titleEl.textContent}” in Highlighter's PDF Reader.`,
    `Use get_pdf_document with the source URL ${cleanSource.href} to read the PDF, continuing through later page ranges when needed.`,
    `Task: ${task}`,
    "When you create highlights, use highlight_passages with exact quotations from get_pdf_document and this same source URL. Keep notes concise, use useful tags, and tell me what you changed. Do not create a live link unless I ask for one."
  ].join(" ");
}

async function copyAgentPdfPrompt() {
  const prompt = buildAgentPdfPrompt();
  await navigator.clipboard.writeText(prompt);
  return prompt;
}

async function openAgentPdfInChatGpt() {
  const prompt = buildAgentPdfPrompt();
  const result = await chrome.runtime.sendMessage({
    type: "openChatGptWithHighlighterPrompt",
    prompt
  });
  if (!result?.ok) throw new Error(result?.error || "ChatGPT could not be opened.");
  if (result.mode !== "inserted") await navigator.clipboard.writeText(prompt);
  return result.mode;
}

function updateFocusIndicator(value) {
  const hasFocus = !!String(value || "").trim();
  aiOptionsToggle.classList.toggle("has-focus", hasFocus);
  aiButton.title = hasFocus
    ? "Deep Read using your saved focus"
    : "Deep Read the paper and highlight only materially important passages";
}

async function saveAiFocus(value) {
  const focus = String(value || "").replace(/\s+/g, " ").trim().slice(0, 1000);
  aiFocus.value = focus;
  updateFocusIndicator(focus);
  try { await chrome.storage.local.set({ [AI_FOCUS_KEY]: focus }); } catch {}
  return focus;
}

function stopDeepReadProgress() {
  aiProgressTimers.forEach(clearTimeout);
  aiProgressTimers = [];
}

function startDeepReadProgress() {
  stopDeepReadProgress();
  const stages = [
    { after: 0, label: "Reading instruction…", message: "Interpreting your instruction without turning it into a fixed highlight count…" },
    { after: 3500, label: "Reading deeply…", message: "Reading the paper in sections with high reasoning effort…" },
    { after: 8500, label: "Checking coverage…", message: "Checking each section independently so requested matches are not lost in a long paper…" },
    { after: 15000, label: "Following instruction…", message: "Applying your instruction directly and preserving exhaustive matches…" },
    { after: 24000, label: "Verifying anchors…", message: "Verifying that each selected passage maps precisely back onto the PDF…" }
  ];
  for (const stage of stages) {
    aiProgressTimers.push(setTimeout(() => {
      if (!aiBusy) return;
      setAiBusy(true, stage.label);
      showAiToast(stage.message, { persistent: true });
    }, stage.after));
  }
}

function requestAiConsent() {
  aiConsent.hidden = false;
  aiConsentAccept.focus();
  return new Promise(resolve => { consentResolver = resolve; });
}

function closeAiConsent(accepted) {
  aiConsent.hidden = true;
  if (consentResolver) consentResolver(accepted);
  consentResolver = null;
}

async function ensureAiConsent() {
  const preferences = await getAiPreferences();
  if (preferences[AI_CONSENT_KEY]) return true;
  const accepted = await requestAiConsent();
  if (!accepted) return false;
  try { await chrome.storage.local.set({ [AI_CONSENT_KEY]: true }); } catch {}
  return true;
}

function currentAiHighlightCount() {
  const detail = {};
  window.dispatchEvent(new CustomEvent("hl-get-ai-state", { detail }));
  return Number(detail.result?.count || 0);
}

async function runAiHighlights({ automatic = false } = {}) {
  if (aiBusy || !pdfDocument || document.body.classList.contains("pdf-rendering")) return;
  if (!(await ensureAiConsent())) {
    if (automatic) aiAuto.checked = false;
    return;
  }
  if (automatic && currentAiHighlightCount() > 0) {
    aiRanForDocument = true;
    return;
  }

  const documentInput = collectAiDocument();
  if (!documentInput.spans.length) {
    showAiToast("This PDF does not contain enough selectable text for AI highlighting.", { error: true });
    return;
  }

  const preferences = await getAiPreferences();
  const focus = String(preferences[AI_FOCUS_KEY] || "").trim().slice(0, 1000);
  setAiOptionsOpen(false);
  setAiBusy(true, "Mapping paper…");
  startDeepReadProgress();
  try {
    const cleanSource = new URL(sourceUrl.href);
    cleanSource.searchParams.delete("hlshare");
    const response = await fetch(AI_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: titleEl.textContent,
        url: cleanSource.href,
        focus,
        spans: documentInput.spans
      })
    });
    if (response.redirected || !(response.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
      throw new Error("The AI Worker is not serving the deep-reading endpoint yet. Deploy the latest Worker and try again.");
    }
    let data = null;
    try { data = await response.json(); } catch {}
    if (!response.ok) {
      throw new Error(data?.error || `The AI service returned ${response.status}.`);
    }
    const selections = Array.isArray(data?.highlights) ? data.highlights : [];
    if (!selections.length) throw new Error("Gemini did not return any usable passages.");

    const detail = { highlights: selections, replaceExisting: !automatic };
    window.dispatchEvent(new CustomEvent("hl-add-ai-highlights", { detail }));
    const count = Number(detail.result?.count || 0);
    if (!count) throw new Error("The suggested passages could not be matched to this PDF.");

    aiRanForDocument = true;
    const firstId = detail.result.ids?.[0];
    if (firstId) {
      setTimeout(() => {
        document.querySelector(`.hl-mark[data-hl-id="${firstId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 180);
    }
    const cacheNote = data.cached ? " The matching deep read was reused from cache." : "";
    const sampleNote = documentInput.truncated ? " A representative sample of this long PDF was used." : "";
    const focusNote = data.focusApplied ? " Your custom instruction was applied." : "";
    const completion = data.selectionMode === "exhaustive_literal"
      ? "Deep Read complete. Every literal match found in the extracted PDF text was highlighted."
      : data.focusApplied
        ? "Deep Read complete. The paper was checked section by section against your instruction."
        : "Deep Read complete. Only passages that passed the importance and editorial checks were highlighted.";
    showAiToast(`${completion}${focusNote}${cacheNote} They are saved and included in shared links.${sampleNote}`);
  } catch (error) {
    showAiToast(error?.message || "AI highlighting failed. Please try again.", { error: true });
  } finally {
    stopDeepReadProgress();
    setAiBusy(false);
  }
}

async function maybeRunAiAutomatically() {
  if (aiRanForDocument || aiBusy) return;
  const preferences = await getAiPreferences();
  aiAuto.checked = !!preferences[AI_AUTO_KEY];
  if (preferences[AI_CONSENT_KEY] && preferences[AI_AUTO_KEY]) {
    runAiHighlights({ automatic: true });
  }
}

async function fetchPdf(url) {
  setProgress("Downloading PDF", 4);
  const publicArxivPdf = /(^|\.)arxiv\.org$/i.test(url.hostname);
  // Shared-highlight data belongs to Highlighter, not the PDF host. Keep it in
  // the reader's canonical source URL for restoration, but never send it to
  // arXiv/OpenReview (some hosts also redirect or reject unknown query data).
  const downloadUrl = new URL(url.href);
  downloadUrl.searchParams.delete("hlshare");
  const response = await fetch(downloadUrl.href, {
    credentials: publicArxivPdf ? "omit" : "include",
    cache: "default",
    redirect: "follow"
  });
  if (!response.ok) throw new Error(`The PDF server returned ${response.status}.`);

  const type = (response.headers.get("content-type") || "").toLowerCase();
  const bytes = new Uint8Array(await response.arrayBuffer());
  const signature = String.fromCharCode(...bytes.subarray(0, 5));
  if (!type.includes("pdf") && signature !== "%PDF-") {
    throw new Error("The server returned a verification or sign-in page instead of the PDF. Open the original page, complete verification, then try again.");
  }
  return bytes;
}

async function loadDocument() {
  if (!sourceUrl) {
    showError("No PDF selected", "Open a PDF in your browser, then choose “Open in Highlighter PDF Reader” from the extension.");
    return;
  }

  openOriginal.href = sourceUrl.href;
  hostEl.textContent = sourceUrl.hostname;
  titleEl.textContent = titleFromUrl(sourceUrl);

  try {
    const data = await fetchPdf(sourceUrl);
    setProgress("Opening PDF", 18);
    const loadingTask = pdfjsLib.getDocument({
      data,
      isEvalSupported: false,
      cMapUrl: bundledUrl("vendor/cmaps/"),
      cMapPacked: true,
      standardFontDataUrl: bundledUrl("vendor/standard_fonts/")
    });
    pdfDocument = await loadingTask.promise;

    try {
      const { info } = await pdfDocument.getMetadata();
      if (info?.Title?.trim()) titleEl.textContent = info.Title.trim();
    } catch {}
    document.title = `${titleEl.textContent} - Highlighter`;
    await renderDocument();
  } catch (error) {
    showError("Unable to open this PDF", error?.message || "The document could not be loaded.");
  }
}

async function renderDocument() {
  if (!pdfDocument) return;
  const generation = ++renderGeneration;
  document.body.classList.add("pdf-rendering");
  status.hidden = true;
  viewer.replaceChildren();
  document.documentElement.style.setProperty("--scale-factor", String(scale));
  zoomValue.textContent = `${Math.round(scale * 100)}%`;

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber++) {
    if (generation !== renderGeneration) return;
    const page = await pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const outputScale = Math.min(window.devicePixelRatio || 1, 2);

    const pageEl = document.createElement("section");
    pageEl.className = "pdf-page";
    pageEl.dataset.pageNumber = String(pageNumber);
    pageEl.setAttribute("aria-label", `Page ${pageNumber}`);
    pageEl.style.width = `${viewport.width}px`;
    pageEl.style.height = `${viewport.height}px`;

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.setAttribute("aria-hidden", "true");
    pageEl.appendChild(canvas);

    const textLayerEl = document.createElement("div");
    textLayerEl.className = "textLayer";
    textLayerEl.style.setProperty("--scale-factor", String(scale));
    pageEl.appendChild(textLayerEl);
    viewer.appendChild(pageEl);

    const renderTask = page.render({
      canvasContext: canvas.getContext("2d", { alpha: false }),
      transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
      viewport
    });
    const textContent = await page.getTextContent({ includeMarkedContent: true });
    const textLayer = new pdfjsLib.TextLayer({
      textContentSource: textContent,
      container: textLayerEl,
      viewport
    });
    await Promise.all([renderTask.promise, textLayer.render()]);

    const percent = 18 + Math.round((pageNumber / pdfDocument.numPages) * 82);
    setProgress(`Rendering ${pageNumber} of ${pdfDocument.numPages}`, percent);
    await new Promise(resolve => requestAnimationFrame(resolve));
  }

  if (generation !== renderGeneration) return;
  document.body.classList.remove("pdf-rendering");
  setProgress(`${pdfDocument.numPages} pages`, 100);
  annotateAiSpans();
  setAiBusy(false);
  window.dispatchEvent(new Event("hl-pdf-rendered"));
  renderAgentConnection();
  maybeRunAiAutomatically();
}

async function changeScale(nextScale) {
  const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, nextScale));
  if (clamped === scale || !pdfDocument) return;
  const visiblePage = [...viewer.querySelectorAll(".pdf-page")].find(page => {
    const rect = page.getBoundingClientRect();
    return rect.bottom > 58 && rect.top < innerHeight;
  });
  const pageNumber = visiblePage?.dataset.pageNumber;
  scale = clamped;
  await renderDocument();
  if (pageNumber) {
    viewer.querySelector(`[data-page-number="${pageNumber}"]`)?.scrollIntoView({ block: "start" });
    scrollBy({ top: -70 });
  }
}

document.getElementById("zoom-out").addEventListener("click", () => changeScale(scale - SCALE_STEP));
document.getElementById("zoom-in").addEventListener("click", () => changeScale(scale + SCALE_STEP));
aiButton.addEventListener("click", () => runAiHighlights());
aiOptionsToggle.addEventListener("click", event => {
  event.stopPropagation();
  setAiOptionsOpen(aiOptionsPanel.hidden);
});
agentPdfButton.addEventListener("click", event => {
  event.stopPropagation();
  setAgentPdfOpen(agentPdfPanel.hidden);
});
agentPdfClose.addEventListener("click", () => setAgentPdfOpen(false));
document.querySelectorAll("[data-agent-preset]").forEach(button => {
  button.addEventListener("click", () => {
    agentPdfTask.value = button.dataset.agentPreset || "";
    agentPdfTask.focus();
  });
});
agentPdfCopy.addEventListener("click", async () => {
  const original = agentPdfCopy.textContent;
  agentPdfCopy.disabled = true;
  try {
    await copyAgentPdfPrompt();
    agentPdfCopy.textContent = "Copied";
    showAiToast("Agent prompt copied. Paste it into a chat where the Highlighter MCP connection is enabled.");
  } catch {
    agentPdfCopy.textContent = "Couldn’t copy";
  }
  setTimeout(() => {
    agentPdfCopy.textContent = original;
    renderAgentConnection();
  }, 1800);
});
agentPdfOpen.addEventListener("click", async () => {
  const original = agentPdfOpen.textContent;
  agentPdfOpen.disabled = true;
  try {
    const mode = await openAgentPdfInChatGpt();
    agentPdfOpen.textContent = mode === "inserted" ? "Added — review & send" : "Opened — prompt copied";
  } catch (error) {
    agentPdfOpen.textContent = "Couldn’t open ChatGPT";
    showAiToast(error?.message || "ChatGPT could not be opened.", { error: true });
  }
  setTimeout(() => {
    agentPdfOpen.textContent = original;
    renderAgentConnection();
  }, 2200);
});
aiOptionsClose.addEventListener("click", () => setAiOptionsOpen(false));
aiFocusClear.addEventListener("click", async () => {
  await saveAiFocus("");
  aiFocus.focus();
});
aiFocusRun.addEventListener("click", async () => {
  await saveAiFocus(aiFocus.value);
  setAiOptionsOpen(false);
  runAiHighlights();
});
document.querySelectorAll("[data-ai-preset]").forEach(button => {
  button.addEventListener("click", () => {
    aiFocus.value = button.dataset.aiPreset || "";
    aiFocus.focus();
  });
});
document.addEventListener("mousedown", event => {
  if (!aiOptionsPanel.hidden && !aiOptionsPanel.contains(event.target) && !aiOptionsToggle.contains(event.target)) {
    setAiOptionsOpen(false);
  }
  if (!agentPdfPanel.hidden && !agentPdfPanel.contains(event.target) && !agentPdfButton.contains(event.target)) {
    setAgentPdfOpen(false);
  }
});
aiAuto.addEventListener("change", async () => {
  if (aiAuto.checked && !(await ensureAiConsent())) {
    aiAuto.checked = false;
    return;
  }
  try { await chrome.storage.local.set({ [AI_AUTO_KEY]: aiAuto.checked }); } catch {}
  showAiToast(aiAuto.checked
    ? "Automatic AI highlights are on for future PDFs."
    : "Automatic AI highlights are off.");
  if (aiAuto.checked) runAiHighlights({ automatic: true });
});
aiConsentAccept.addEventListener("click", () => closeAiConsent(true));
aiConsentCancel.addEventListener("click", () => closeAiConsent(false));
aiConsent.addEventListener("click", event => {
  if (event.target === aiConsent) closeAiConsent(false);
});
window.addEventListener("keydown", event => {
  if (event.key === "Escape" && !aiOptionsPanel.hidden) {
    setAiOptionsOpen(false);
    return;
  }
  if (event.key === "Escape" && !agentPdfPanel.hidden) {
    setAgentPdfOpen(false);
    return;
  }
  if (event.key === "Escape" && !aiConsent.hidden) {
    closeAiConsent(false);
    return;
  }
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    changeScale(scale + SCALE_STEP);
  } else if (event.key === "-") {
    event.preventDefault();
    changeScale(scale - SCALE_STEP);
  }
});

getAiPreferences().then(preferences => {
  const focus = String(preferences[AI_FOCUS_KEY] || "");
  aiFocus.value = focus;
  aiAuto.checked = !!preferences[AI_AUTO_KEY];
  updateFocusIndicator(focus);
});

refreshAgentConnection();

loadDocument();
