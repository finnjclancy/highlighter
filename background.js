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

const AGENT_WORKER_BASE = "https://highlighter-share.finnjclancy.workers.dev";
const AGENT_CONNECTION_KEY = "hl_agent_connection";
const AGENT_RECONNECT_ALARM = "hl_agent_reconnect";
const AGENT_SHARE_HISTORY_KEY = "hl_shares";
const AGENT_OPERATION_HISTORY_KEY = "hl_agent_operations";
const AGENT_PAGE_NOTES_KEY = "hl_page_notes";
const AGENT_LIBRARY_SELECTION_KEY = "hl_agent_library_selection";
const AGENT_SHARE_MAX_HIGHLIGHTS = 250;
const AGENT_TEXT_MAX_CHARS = 200_000;
const AGENT_OPERATION_LIMIT = 100;
const AGENT_RESULT_LIMIT = 250;
let agentSocket = null;
let agentSocketToken = "";
let agentPingTimer = null;
let agentReconnectTimer = null;

function randomAgentToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function agentMcpUrl(token) {
  return `${AGENT_WORKER_BASE}/mcp?token=${encodeURIComponent(token)}`;
}

async function getAgentConnection() {
  const stored = await chrome.storage.local.get(AGENT_CONNECTION_KEY);
  const value = stored[AGENT_CONNECTION_KEY];
  return value && typeof value === "object"
    ? { enabled: value.enabled === true, token: typeof value.token === "string" ? value.token : "" }
    : { enabled: false, token: "" };
}

function closeAgentSocket() {
  if (agentPingTimer) clearInterval(agentPingTimer);
  if (agentReconnectTimer) clearTimeout(agentReconnectTimer);
  agentPingTimer = null;
  agentReconnectTimer = null;
  const socket = agentSocket;
  agentSocket = null;
  agentSocketToken = "";
  try { socket?.close(1000, "connection disabled"); } catch {}
}

function scheduleAgentReconnect() {
  if (agentReconnectTimer) return;
  agentReconnectTimer = setTimeout(() => {
    agentReconnectTimer = null;
    void connectAgentBridge();
  }, 3000);
}

async function connectAgentBridge() {
  const config = await getAgentConnection();
  if (!config.enabled || !/^[A-Za-z0-9_-]{43}$/.test(config.token)) {
    closeAgentSocket();
    return;
  }
  if (agentSocket && agentSocketToken === config.token &&
      (agentSocket.readyState === WebSocket.OPEN || agentSocket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  closeAgentSocket();
  agentSocketToken = config.token;
  const socketUrl = AGENT_WORKER_BASE.replace(/^http/, "ws") +
    `/api/agent/socket?token=${encodeURIComponent(config.token)}`;
  const socket = new WebSocket(socketUrl);
  agentSocket = socket;

  socket.addEventListener("open", () => {
    if (socket !== agentSocket) return;
    agentPingTimer = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        try { socket.send(JSON.stringify({ type: "ping" })); } catch {}
      }
    }, 20_000);
  });

  socket.addEventListener("message", event => {
    if (socket !== agentSocket) return;
    let command;
    try { command = JSON.parse(event.data); } catch { return; }
    if (!command?.id || ![
      "get_active_page",
      "get_pdf_document",
      "highlight_passages",
      "get_highlighted_text",
      "create_live_link",
      "remove_highlights",
      "update_highlight",
      "search_highlights",
      "list_highlighted_pages",
      "restore_highlights",
      "highlight_selection",
      "export_highlights",
      "summarize_highlights",
      "bulk_tag_highlights",
      "get_library_selection",
      "list_folders",
      "organize_folders",
      "add_page_note",
      "capture_snapshot",
      "compare_pages",
      "manage_live_links",
      "collaborate_on_live_link",
      "get_highlight_context",
      "open_highlight"
    ].includes(command.type)) return;
    void handleAgentCommand(command).then(result => {
      if (socket.readyState !== WebSocket.OPEN) return;
      try { socket.send(JSON.stringify({ type: "result", id: command.id, result })); } catch {}
    });
  });

  socket.addEventListener("close", () => {
    if (socket !== agentSocket) return;
    if (agentPingTimer) clearInterval(agentPingTimer);
    agentPingTimer = null;
    agentSocket = null;
    agentSocketToken = "";
    scheduleAgentReconnect();
  });

  socket.addEventListener("error", () => {
    try { socket.close(); } catch {}
  });
}

function canonicalAgentUrl(rawUrl) {
  try {
    let url = new URL(rawUrl);
    const extensionOrigin = new URL(chrome.runtime.getURL("/")).origin;
    if (url.origin === extensionOrigin && url.pathname.endsWith("/pdf-reader.html")) {
      const source = url.searchParams.get("url");
      if (source) url = new URL(source);
    }
    if (!/^https?:$/.test(url.protocol)) return "";
    url.hash = "";
    url.searchParams.delete("hlshare");
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.href;
  } catch {
    return "";
  }
}

async function activeAgentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function resolveAgentTab(tab) {
  if (!tab?.id) return { tab: null, url: "", state: {} };
  let state = {};
  try { state = await chrome.tabs.sendMessage(tab.id, { type: "getAgentPageState" }); } catch {}
  const url = canonicalAgentUrl(tab.url) || canonicalAgentUrl(state?.url);
  return {
    tab: url ? { ...tab, url } : tab,
    url,
    state: state && typeof state === "object" ? state : {}
  };
}

async function findAgentTargetTab(targetUrl) {
  const wanted = canonicalAgentUrl(targetUrl);
  if (!wanted) return null;
  const active = await resolveAgentTab(await activeAgentTab());
  if (active.url === wanted) return active.tab;
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id === active.tab?.id) continue;
    const resolved = await resolveAgentTab(tab);
    if (resolved.url === wanted) return resolved.tab;
  }
  return null;
}

function agentPageKeyDisambiguator(url) {
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  if (host === "news.ycombinator.com") {
    const id = url.searchParams.get("id");
    if (id) return "?id=" + id;
  }
  if (host === "openreview.net" && (url.pathname === "/pdf" || url.pathname === "/attachment")) {
    const id = url.searchParams.get("id");
    if (id) return "?id=" + id;
  }
  return "";
}

function agentPageStorageKey(rawUrl) {
  const url = new URL(rawUrl);
  let path = url.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return "hl_page_" + url.origin + path + agentPageKeyDisambiguator(url);
}

async function getStoredAgentHighlights(pageUrl) {
  const url = new URL(pageUrl);
  const all = await chrome.storage.local.get(null);
  const primaryKey = agentPageStorageKey(pageUrl);
  let highlights = Array.isArray(all[primaryKey]) ? all[primaryKey] : [];
  if (highlights.length || agentPageKeyDisambiguator(url)) return highlights;

  const legacyKey = "hl_page_" + url.origin + url.pathname;
  if (Array.isArray(all[legacyKey]) && all[legacyKey].length) return all[legacyKey];

  let wantedPath = url.pathname;
  if (wantedPath.length > 1 && wantedPath.endsWith("/")) wantedPath = wantedPath.slice(0, -1);
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith("hl_page_" + url.origin) || !Array.isArray(value) || !value.length) continue;
    let storedPath = key.slice(("hl_page_" + url.origin).length);
    if (storedPath.length > 1 && storedPath.endsWith("/")) storedPath = storedPath.slice(0, -1);
    if (storedPath === wantedPath) {
      highlights = value;
      break;
    }
  }
  return highlights;
}

async function getAgentHighlights(tab, pageUrl) {
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "getContextForShare" });
    if (response?.ok && Array.isArray(response.highlights)) return response.highlights;
  } catch {}
  return getStoredAgentHighlights(pageUrl);
}

function agentPlainText(title, pageUrl, highlights) {
  const parts = [(title || pageUrl).trim(), pageUrl, ""];
  let usedChars = parts.join("\n").length;
  let truncated = false;
  for (const highlight of highlights.slice(0, AGENT_SHARE_MAX_HIGHLIGHTS)) {
    const quote = String(highlight?.text || "").trim();
    const tags = Array.isArray(highlight?.tags)
      ? highlight.tags.map(tag => String(tag).trim()).filter(Boolean).slice(0, 12)
      : [];
    const note = String(highlight?.note || "").trim();
    const block = [quote, tags.length ? "Tags: " + tags.join(", ") : "", note ? "Note: " + note : "", ""]
      .filter((line, index, lines) => line || index === lines.length - 1)
      .join("\n");
    if (usedChars + block.length > AGENT_TEXT_MAX_CHARS) {
      truncated = true;
      break;
    }
    parts.push(block);
    usedChars += block.length;
  }
  if (highlights.length > AGENT_SHARE_MAX_HIGHLIGHTS) truncated = true;
  return {
    text: parts.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n",
    truncated
  };
}

function agentSharePayload(pageUrl, title, highlights, name) {
  return {
    v: 3,
    url: pageUrl,
    title: title || "",
    name: name || "",
    highlights: highlights.map(highlight => {
      const output = {
        id: highlight.id,
        bg: highlight.bg,
        fg: highlight.fg,
        text: highlight.text,
        note: highlight.note || "",
        tags: Array.isArray(highlight.tags) ? highlight.tags : []
      };
      if (highlight.range) {
        output.r = {
          sx: highlight.range.startXPath,
          so: highlight.range.startOffset,
          ex: highlight.range.endXPath,
          eo: highlight.range.endOffset
        };
      }
      if (highlight.prefix) output.p = highlight.prefix;
      if (highlight.suffix) output.s = highlight.suffix;
      return output;
    })
  };
}

function agentBytesToBase64Url(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function encodeAgentShare(payload) {
  const json = JSON.stringify(payload);
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return "z" + agentBytesToBase64Url(bytes);
}

async function createAgentShareUrl(payload, options = {}) {
  const encoded = await encodeAgentShare(payload);
  try {
    const response = await fetch(AGENT_WORKER_BASE + "/api/shorten", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        payload: encoded,
        expiresInDays: Number(options.expiresInDays || 365),
        password: String(options.password || "").slice(0, 128),
        visibility: options.visibility === "private" ? "private" : "unlisted"
      })
    });
    if (response.ok) {
      const result = await response.json();
      if (typeof result?.url === "string") {
        return {
          url: result.url,
          id: typeof result.id === "string" ? result.id : agentShareId(result.url),
          manageToken: typeof result.manageToken === "string" ? result.manageToken : "",
          expiresAt: Number(result.expiresAt || 0),
          passwordProtected: result.passwordProtected === true,
          visibility: result.visibility === "private" ? "private" : "unlisted",
          shortened: true
        };
      }
    }
  } catch {}
  return { url: AGENT_WORKER_BASE + "/v?d=" + encoded, shortened: false };
}

function agentShareId(shareUrl) {
  try {
    return new URL(shareUrl).pathname.match(/\/v\/([a-z0-9]+)$/i)?.[1] || null;
  } catch {
    return null;
  }
}

async function recordAgentShare(entry) {
  const stored = await chrome.storage.local.get(AGENT_SHARE_HISTORY_KEY);
  const history = Array.isArray(stored[AGENT_SHARE_HISTORY_KEY]) ? stored[AGENT_SHARE_HISTORY_KEY] : [];
  history.unshift(entry);
  await chrome.storage.local.set({ [AGENT_SHARE_HISTORY_KEY]: history.slice(0, AGENT_SHARE_MAX_HIGHLIGHTS) });
}

async function getAgentShareHistory() {
  const stored = await chrome.storage.local.get(AGENT_SHARE_HISTORY_KEY);
  return Array.isArray(stored[AGENT_SHARE_HISTORY_KEY]) ? stored[AGENT_SHARE_HISTORY_KEY] : [];
}

async function saveAgentShareHistory(history) {
  await chrome.storage.local.set({
    [AGENT_SHARE_HISTORY_KEY]: Array.isArray(history) ? history.slice(0, AGENT_SHARE_MAX_HIGHLIGHTS) : []
  });
}

async function agentLibrary() {
  const all = await chrome.storage.local.get(null);
  const pages = [];
  const highlights = [];
  for (const [pageKey, value] of Object.entries(all)) {
    if (!pageKey.startsWith("hl_page_") || !Array.isArray(value)) continue;
    const pageHighlights = value.filter(item => item && typeof item === "object");
    if (!pageHighlights.length) continue;
    const first = pageHighlights[0] || {};
    const url = canonicalAgentUrl(first.url) || pageKey.slice("hl_page_".length);
    const title = String(first.title || url || "Untitled page");
    const page = { pageKey, url, title, highlights: pageHighlights };
    pages.push(page);
    pageHighlights.forEach(highlight => highlights.push({ ...highlight, pageKey, url, title }));
  }
  return { all, pages, highlights };
}

function sanitizeAgentTags(tags) {
  return [...new Set((Array.isArray(tags) ? tags : [])
    .map(tag => String(tag || "").trim().replace(/^#/, "").slice(0, 50))
    .filter(Boolean))].slice(0, 20);
}

function agentColorPatch(color) {
  const named = {
    yellow: ["#fff59d", "#1a1a1a"], green: ["#b9f6ca", "#0b3d1a"],
    pink: ["#f8bbd0", "#4a0028"], blue: ["#b3e5fc", "#0b2a3d"],
    orange: ["#ffcc80", "#3d1f00"], purple: ["#d1c4e9", "#1c0b3d"],
    red: ["#ffab91", "#3d0b00"], dark: ["#263238", "#ffffff"]
  };
  const pair = named[String(color || "").toLowerCase()];
  return pair ? { bg: pair[0], fg: pair[1] } : {};
}

async function recordAgentOperation(type, changes, description) {
  if (!Array.isArray(changes) || !changes.length) return null;
  const data = await chrome.storage.local.get(AGENT_OPERATION_HISTORY_KEY);
  const history = Array.isArray(data[AGENT_OPERATION_HISTORY_KEY]) ? data[AGENT_OPERATION_HISTORY_KEY] : [];
  const operation = {
    id: crypto.randomUUID(), type, description: String(description || type).slice(0, 200),
    createdAt: Date.now(), restoredAt: null,
    changes: changes.slice(0, 100)
  };
  history.unshift(operation);
  await chrome.storage.local.set({ [AGENT_OPERATION_HISTORY_KEY]: history.slice(0, AGENT_OPERATION_LIMIT) });
  return operation;
}

async function notifyAgentPage(pageKey, message) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(async tab => {
    if (!tab?.id || !tab.url) return;
    let key = "";
    try { key = agentPageStorageKey(canonicalAgentUrl(tab.url)); } catch {}
    if (key !== pageKey) return;
    try { await chrome.tabs.sendMessage(tab.id, message); } catch {}
  }));
}

async function updateAgentHighlights(command) {
  const ids = [...new Set((Array.isArray(command.ids) ? command.ids : [command.id])
    .map(id => String(id || "").trim()).filter(Boolean))].slice(0, 100);
  if (!ids.length) return { ok: false, error: "Supply at least one exact highlight ID." };
  const library = await agentLibrary();
  const targetUrl = command.url ? canonicalAgentUrl(command.url) : "";
  const patch = command.patch && typeof command.patch === "object" ? command.patch : command;
  const color = agentColorPatch(patch.color);
  const writes = {};
  const changes = [];
  const updated = [];
  for (const page of library.pages) {
    if (targetUrl && canonicalAgentUrl(page.url) !== targetUrl) continue;
    let changed = false;
    const next = page.highlights.map(highlight => {
      if (!ids.includes(String(highlight.id || ""))) return highlight;
      const before = { ...highlight };
      const after = { ...highlight, ...color };
      if (patch.note !== undefined) after.note = String(patch.note || "").slice(0, 4000);
      if (patch.tags !== undefined) after.tags = sanitizeAgentTags(patch.tags);
      if (patch.snapshot !== undefined && patch.snapshot && typeof patch.snapshot === "object") after.snapshot = patch.snapshot;
      if (patch.addTags !== undefined) after.tags = sanitizeAgentTags([...(after.tags || []), ...sanitizeAgentTags(patch.addTags)]);
      if (patch.removeTags !== undefined) {
        const remove = new Set(sanitizeAgentTags(patch.removeTags).map(tag => tag.toLowerCase()));
        after.tags = (after.tags || []).filter(tag => !remove.has(String(tag).toLowerCase()));
      }
      changed = true;
      changes.push({ pageKey: page.pageKey, before, after });
      updated.push({ id: after.id, url: page.url, text: after.text, note: after.note || "", tags: after.tags || [], color: patch.color || "" });
      return after;
    });
    if (changed) writes[page.pageKey] = next;
  }
  if (!changes.length) return { ok: false, error: "None of those highlight IDs were found in the saved library." };
  await chrome.storage.local.set(writes);
  const operation = await recordAgentOperation("update", changes, `Updated ${changes.length} highlight${changes.length === 1 ? "" : "s"}`);
  await Promise.all(Object.entries(writes).map(([pageKey, list]) => notifyAgentPage(pageKey, {
    type: "replacePageHighlights", highlights: list
  })));
  return { ok: true, updated: updated.length, highlights: updated, operationId: operation?.id || "" };
}

async function searchAgentHighlights(command) {
  const { highlights } = await agentLibrary();
  const query = String(command.query || "").trim().toLowerCase();
  const domain = String(command.domain || "").trim().toLowerCase();
  const tags = sanitizeAgentTags(command.tags).map(tag => tag.toLowerCase());
  const after = command.after ? Date.parse(command.after) : 0;
  const before = command.before ? Date.parse(command.before) : 0;
  const matches = highlights.filter(highlight => {
    const haystack = [highlight.text, highlight.note, highlight.title, highlight.url, ...(highlight.tags || [])]
      .join("\n").toLowerCase();
    if (query && !haystack.includes(query)) return false;
    if (domain) { try { if (!new URL(highlight.url).hostname.toLowerCase().includes(domain)) return false; } catch { return false; } }
    if (tags.length && !tags.every(tag => (highlight.tags || []).some(value => String(value).toLowerCase() === tag))) return false;
    const createdAt = Number(highlight.createdAt || 0);
    if (after && createdAt < after) return false;
    if (before && createdAt > before) return false;
    return true;
  }).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)).slice(0, AGENT_RESULT_LIMIT);
  return {
    ok: true, count: matches.length, truncated: matches.length >= AGENT_RESULT_LIMIT,
    highlights: matches.map(item => ({
      id: item.id, text: item.text || "", note: item.note || "", tags: item.tags || [],
      color: item.bg || "", url: item.url || "", title: item.title || "", createdAt: item.createdAt || 0,
      snapshot: item.snapshot || null
    }))
  };
}

async function listAgentPages(command = {}) {
  const { pages } = await agentLibrary();
  const noteData = await chrome.storage.local.get(AGENT_PAGE_NOTES_KEY);
  const notes = noteData[AGENT_PAGE_NOTES_KEY] && typeof noteData[AGENT_PAGE_NOTES_KEY] === "object"
    ? noteData[AGENT_PAGE_NOTES_KEY] : {};
  const domain = String(command.domain || "").toLowerCase();
  const result = pages.filter(page => {
    if (!domain) return true;
    try { return new URL(page.url).hostname.toLowerCase().includes(domain); } catch { return false; }
  }).map(page => ({
    url: page.url, title: page.title, count: page.highlights.length,
    tags: [...new Set(page.highlights.flatMap(highlight => highlight.tags || []))].slice(0, 50),
    note: String(notes[page.pageKey]?.note || ""),
    updatedAt: Math.max(...page.highlights.map(highlight => Number(highlight.createdAt || 0)), 0)
  })).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, AGENT_RESULT_LIMIT);
  return { ok: true, count: result.length, pages: result };
}

function agentHighlightSummary(item) {
  return {
    id: String(item.id || ""),
    text: String(item.text || ""),
    note: String(item.note || ""),
    tags: Array.isArray(item.tags) ? item.tags.map(String).slice(0, 20) : [],
    color: String(item.bg || ""),
    url: String(item.url || ""),
    title: String(item.title || ""),
    createdAt: Number(item.createdAt || 0)
  };
}

async function getAgentLibrarySelection() {
  const data = await chrome.storage.local.get(AGENT_LIBRARY_SELECTION_KEY);
  const selection = data[AGENT_LIBRARY_SELECTION_KEY];
  const ids = [...new Set((Array.isArray(selection?.highlightIds) ? selection.highlightIds : [])
    .map(id => String(id || "").trim()).filter(Boolean))].slice(0, 100);
  if (!ids.length) {
    return { ok: false, error: "No library selection is staged. Select highlights in the Library and choose Open in ChatGPT web or Copy for browser agent." };
  }
  const { highlights } = await agentLibrary();
  const byId = new Map(highlights.map(item => [String(item.id || ""), item]));
  const selected = ids.map(id => byId.get(id)).filter(Boolean);
  if (!selected.length) {
    return { ok: false, error: "The staged highlights are no longer in the library. Make a new selection and stage it again from the Library." };
  }
  return {
    ok: true,
    selectionId: String(selection.selectionId || ""),
    createdAt: Number(selection.createdAt || 0),
    count: selected.length,
    unavailable: ids.length - selected.length,
    highlights: selected.map(agentHighlightSummary)
  };
}

async function listAgentFolders(command = {}) {
  const { highlights } = await agentLibrary();
  const folders = new Map();
  for (const highlight of highlights) {
    for (const rawTag of Array.isArray(highlight.tags) ? highlight.tags : []) {
      const name = String(rawTag || "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!folders.has(key)) folders.set(key, { name, highlights: [], sources: new Set(), updatedAt: 0 });
      const folder = folders.get(key);
      folder.highlights.push(highlight);
      folder.sources.add(highlight.url);
      folder.updatedAt = Math.max(folder.updatedAt, Number(highlight.createdAt || 0));
    }
  }
  const includeSamples = command.includeSamples === true;
  const result = [...folders.values()].map(folder => ({
    name: folder.name,
    count: folder.highlights.length,
    sourceCount: folder.sources.size,
    updatedAt: folder.updatedAt,
    ...(includeSamples ? { samples: folder.highlights.slice(0, 3).map(agentHighlightSummary) } : {})
  })).sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, count: result.length, folders: result };
}

function agentFolderName(value) {
  return sanitizeAgentTags([value])[0] || "";
}

async function organizeAgentFolders(command) {
  const action = String(command.action || "");
  const folder = agentFolderName(command.folder);
  const fromFolder = agentFolderName(command.fromFolder);
  const explicitIds = [...new Set((Array.isArray(command.ids) ? command.ids : [])
    .map(id => String(id || "").trim()).filter(Boolean))].slice(0, 100);
  let ids = explicitIds;
  let addTags = [];
  let removeTags = [];

  if (action === "add_to_folder") {
    if (!folder || !ids.length) return { ok: false, error: "add_to_folder needs a folder name and at least one highlight ID." };
    addTags = [folder];
  } else if (action === "move_between_folders") {
    if (!fromFolder || !folder || !ids.length) return { ok: false, error: "move_between_folders needs highlight IDs, fromFolder, and folder." };
    if (fromFolder.toLowerCase() === folder.toLowerCase()) return { ok: false, error: "The source and destination folder are the same." };
    addTags = [folder];
    removeTags = [fromFolder];
  } else if (action === "remove_from_folder") {
    if (!fromFolder || !ids.length) return { ok: false, error: "remove_from_folder needs a folder name and at least one highlight ID." };
    removeTags = [fromFolder];
  } else if (["rename_folder", "merge_folders", "delete_folder"].includes(action)) {
    const sources = action === "merge_folders"
      ? sanitizeAgentTags(command.sourceFolders)
      : (fromFolder ? [fromFolder] : []);
    if (!sources.length) return { ok: false, error: `${action} needs a source folder.` };
    if ((action === "rename_folder" || action === "merge_folders") && !folder) {
      return { ok: false, error: `${action} needs a destination folder.` };
    }
    const sourceNames = new Set(sources.map(name => name.toLowerCase()));
    const destination = folder.toLowerCase();
    const removableSources = sources.filter(name => name.toLowerCase() !== destination);
    if (action !== "delete_folder" && !removableSources.length) {
      return { ok: false, error: "The source and destination folder are the same." };
    }
    const { highlights } = await agentLibrary();
    ids = highlights.filter(highlight => (highlight.tags || []).some(tag => sourceNames.has(String(tag).toLowerCase())))
      .map(highlight => String(highlight.id || "")).filter(Boolean);
    if (!ids.length) return { ok: false, error: "No highlights were found in the source folder." };
    if (ids.length > 100) {
      return { ok: false, error: "That folder operation matches more than 100 highlights. Narrow the set and move them in batches so each change remains safely reversible." };
    }
    removeTags = action === "delete_folder" ? sources : removableSources;
    if (action !== "delete_folder") addTags = [folder];
  } else {
    return { ok: false, error: "Use add_to_folder, move_between_folders, remove_from_folder, rename_folder, merge_folders, or delete_folder." };
  }

  const result = await updateAgentHighlights({ ids, patch: { addTags, removeTags } });
  if (!result.ok) return result;
  return {
    ...result,
    action,
    folder: folder || "",
    fromFolder: fromFolder || "",
    sourceFolders: action === "merge_folders" ? sanitizeAgentTags(command.sourceFolders) : undefined
  };
}

async function restoreAgentOperation(command) {
  const data = await chrome.storage.local.get(AGENT_OPERATION_HISTORY_KEY);
  const history = Array.isArray(data[AGENT_OPERATION_HISTORY_KEY]) ? data[AGENT_OPERATION_HISTORY_KEY] : [];
  const operation = command.operationId
    ? history.find(item => item.id === command.operationId)
    : history.find(item => !item.restoredAt);
  if (!operation) return { ok: false, error: "No matching reversible Highlighter operation was found." };
  if (operation.restoredAt) return { ok: false, error: "That operation has already been restored." };
  const byPage = new Map();
  for (const change of operation.changes || []) {
    if (change.pageNote) continue;
    if (!byPage.has(change.pageKey)) byPage.set(change.pageKey, []);
    byPage.get(change.pageKey).push(change);
  }
  const writes = {};
  const removals = [];
  for (const [pageKey, changes] of byPage) {
    const stored = await chrome.storage.local.get(pageKey);
    let list = Array.isArray(stored[pageKey]) ? stored[pageKey].slice() : [];
    for (const change of changes) {
      const id = String(change.before?.id || change.after?.id || "");
      const index = list.findIndex(item => String(item.id || "") === id);
      if (change.before) {
        if (index >= 0) list[index] = change.before;
        else list.push(change.before);
      } else if (index >= 0) list.splice(index, 1);
    }
    if (list.length) writes[pageKey] = list;
    else removals.push(pageKey);
  }
  if (Object.keys(writes).length) await chrome.storage.local.set(writes);
  if (removals.length) await chrome.storage.local.remove(removals);
  const pageNoteChanges = (operation.changes || []).filter(change => change.pageNote);
  if (pageNoteChanges.length) {
    const noteData = await chrome.storage.local.get(AGENT_PAGE_NOTES_KEY);
    const notes = noteData[AGENT_PAGE_NOTES_KEY] && typeof noteData[AGENT_PAGE_NOTES_KEY] === "object"
      ? noteData[AGENT_PAGE_NOTES_KEY] : {};
    pageNoteChanges.forEach(change => {
      if (change.before) notes[change.pageKey] = change.before;
      else delete notes[change.pageKey];
    });
    await chrome.storage.local.set({ [AGENT_PAGE_NOTES_KEY]: notes });
  }
  operation.restoredAt = Date.now();
  await chrome.storage.local.set({ [AGENT_OPERATION_HISTORY_KEY]: history });
  await Promise.all([...byPage.keys()].map(pageKey => notifyAgentPage(pageKey, {
    type: "replacePageHighlights", highlights: writes[pageKey] || []
  })));
  return { ok: true, operationId: operation.id, restored: (operation.changes || []).length, description: operation.description };
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function exportAgentText(items, format) {
  const kind = String(format || "markdown").toLowerCase();
  if (kind === "json") return JSON.stringify(items, null, 2);
  if (kind === "csv") {
    return ["id,quote,note,tags,title,url,created_at", ...items.map(item => [
      item.id, item.text, item.note, (item.tags || []).join("; "), item.title, item.url,
      item.createdAt ? new Date(item.createdAt).toISOString() : ""
    ].map(csvCell).join(","))].join("\n");
  }
  if (kind === "bibtex") return items.map((item, index) => `@misc{highlighter${index + 1},\n  title={${String(item.title || "Web highlight").replace(/[{}]/g, "")}},\n  howpublished={\\url{${item.url}}},\n  note={${String(item.text || "").replace(/[{}]/g, "").slice(0, 1000)}}\n}`).join("\n\n");
  if (kind === "ris") return items.map(item => `TY  - ELEC\nTI  - ${item.title || "Web highlight"}\nUR  - ${item.url}\nN1  - ${String(item.text || "").replace(/\n/g, " ")}\nER  -`).join("\n\n");
  const groups = new Map();
  items.forEach(item => {
    if (!groups.has(item.url)) groups.set(item.url, { title: item.title, items: [] });
    groups.get(item.url).items.push(item);
  });
  let output = `# Highlighter export\n\n`;
  for (const [url, group] of groups) {
    output += `## [${String(group.title || url).replace(/\]/g, "\\]")}](${url})\n\n`;
    for (const item of group.items) {
      output += String(item.text || "").split("\n").map(line => `> ${line}`).join("\n") + "\n";
      if (item.note) output += `>\n> Note: ${String(item.note).replace(/\n/g, " ")}\n`;
      if (item.tags?.length) output += `> Tags: ${item.tags.map(tag => `#${tag}`).join(" ")}\n`;
      output += "\n";
    }
  }
  return output.trim() + "\n";
}

async function agentExport(command) {
  const result = await searchAgentHighlights(command);
  if (!result.highlights.length) return { ok: false, error: "No saved highlights match that export." };
  const text = exportAgentText(result.highlights, command.format).slice(0, AGENT_TEXT_MAX_CHARS);
  return { ok: true, format: command.format || "markdown", count: result.highlights.length, text, truncated: text.length >= AGENT_TEXT_MAX_CHARS };
}

async function agentPageNote(command) {
  const url = canonicalAgentUrl(command.url || (await activeAgentTab())?.url);
  if (!url) return { ok: false, error: "Supply an HTTP(S) page URL or open the page in Chrome." };
  const pageKey = agentPageStorageKey(url);
  const data = await chrome.storage.local.get(AGENT_PAGE_NOTES_KEY);
  const notes = data[AGENT_PAGE_NOTES_KEY] && typeof data[AGENT_PAGE_NOTES_KEY] === "object" ? data[AGENT_PAGE_NOTES_KEY] : {};
  const before = notes[pageKey] || null;
  const note = String(command.note || "").slice(0, 12_000);
  notes[pageKey] = { url, note, updatedAt: Date.now() };
  await chrome.storage.local.set({ [AGENT_PAGE_NOTES_KEY]: notes });
  const operation = await recordAgentOperation("page_note", [{ pageKey, before, after: notes[pageKey], pageNote: true }], "Updated a page note");
  return { ok: true, url, note, operationId: operation?.id || "" };
}

async function agentManageShareRequest(body) {
  const response = await fetch(AGENT_WORKER_BASE + "/api/share/manage", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "The live link could not be managed.");
  return result;
}

async function manageAgentLiveLinks(command) {
  const history = await getAgentShareHistory();
  const action = String(command.action || "list");
  if (action === "list") return {
    ok: true, count: history.length,
    links: history.map(({ manageToken, ...share }) => ({ ...share, manageable: Boolean(manageToken) }))
  };
  const share = history.find(item => item.id === command.id || item.url === command.url);
  if (!share?.id || !share.manageToken) return { ok: false, error: "That link is not in this extension's manageable share history." };
  if (action === "revoke") {
    await agentManageShareRequest({ action, id: share.id, manageToken: share.manageToken });
    share.revokedAt = Date.now();
    await saveAgentShareHistory(history);
    return { ok: true, action, id: share.id, url: share.url, revoked: true };
  }
  if (action !== "update") return { ok: false, error: "Use list, update, or revoke." };
  let payload;
  let count = share.count || 0;
  let name = String(command.name || share.name || "Shared highlights").slice(0, 120);
  if (command.refreshContent === true || (command.name && command.name !== share.name)) {
    const pageUrl = canonicalAgentUrl(command.sourceUrl || share.sourceUrl);
    const highlights = await getStoredAgentHighlights(pageUrl);
    if (!highlights.length) return { ok: false, error: "No saved highlights remain for that source page." };
    payload = await encodeAgentShare(agentSharePayload(pageUrl, share.sourceTitle || "", highlights, name));
    count = highlights.length;
  }
  const result = await agentManageShareRequest({
    action, id: share.id, manageToken: share.manageToken, name,
    ...(payload ? { payload } : {}),
    ...(command.expiresInDays !== undefined ? { expiresInDays: Number(command.expiresInDays) } : {}),
    ...(command.password !== undefined ? { password: String(command.password || "").slice(0, 128) } : {}),
    ...(command.visibility ? { visibility: command.visibility } : {})
  });
  Object.assign(share, {
    name, count, updatedAt: Date.now(), expiresAt: result.expiresAt || share.expiresAt,
    passwordProtected: result.passwordProtected === true, visibility: result.visibility || share.visibility
  });
  await saveAgentShareHistory(history);
  return { ok: true, action, id: share.id, url: share.url, name, count, expiresAt: share.expiresAt, passwordProtected: share.passwordProtected, visibility: share.visibility };
}

async function resolveAgentPage(command) {
  const candidate = command.url ? await findAgentTargetTab(command.url) : await activeAgentTab();
  const resolved = await resolveAgentTab(candidate);
  const tab = resolved.tab;
  const pageUrl = resolved.url;
  if (!tab?.id || !pageUrl) {
    return { error: command.url
      ? "That exact page is not open in the paired Chrome browser."
      : "The active tab is not an HTTP(S) page." };
  }
  return { tab, pageUrl };
}

async function handleAgentCommand(command) {
  try {
    if (command.type === "get_active_page") {
      const resolved = await resolveAgentTab(await activeAgentTab());
      const tab = resolved.tab;
      const url = resolved.url;
      if (!tab?.id || !url) return { ok: false, error: "The active tab is not an HTTP(S) page." };
      const state = resolved.state;
      return {
        ok: true,
        url,
        title: tab.title || state.title || "",
        selection: state.selection || "",
        highlightCount: Number(state.highlightCount || 0)
      };
    }

    if (command.type === "get_pdf_document") {
      const page = await resolveAgentPage(command);
      if (page.error) return { ok: false, error: page.error };
      let result;
      try {
        result = await chrome.tabs.sendMessage(page.tab.id, {
          type: "getAgentPdfDocument",
          startPage: command.startPage,
          pageCount: command.pageCount,
          maxChars: command.maxChars
        });
      } catch {}
      if (!result?.ok) {
        return {
          ok: false,
          error: result?.error || "That page is not open in Highlighter's PDF Reader. Open the PDF in the reader, then try again."
        };
      }
      return {
        ...result,
        url: page.pageUrl,
        title: page.tab.title || result.title || ""
      };
    }

    if (command.type === "highlight_passages") {
      const tab = await findAgentTargetTab(command.url);
      if (!tab?.id) {
        return { ok: false, error: "That exact page is not open in the paired Chrome browser." };
      }
      const result = await chrome.tabs.sendMessage(tab.id, {
        type: "agentHighlightPassages",
        passages: Array.isArray(command.passages) ? command.passages : []
      });
      if (result?.ok && Array.isArray(result.ids) && result.ids.length) {
        const pageUrl = canonicalAgentUrl(tab.url);
        const pageKey = agentPageStorageKey(pageUrl);
        const saved = await getStoredAgentHighlights(pageUrl);
        const changes = saved.filter(highlight => result.ids.includes(highlight.id))
          .map(highlight => ({ pageKey, before: null, after: highlight }));
        const operation = await recordAgentOperation("create", changes, `Added ${changes.length} highlight${changes.length === 1 ? "" : "s"}`);
        result.operationId = operation?.id || "";
      }
      return result && typeof result === "object"
        ? result
        : { ok: false, error: "The page did not accept the highlight request." };
    }

    if (command.type === "get_highlighted_text") {
      const page = await resolveAgentPage(command);
      if (page.error) return { ok: false, error: page.error };
      const highlights = await getAgentHighlights(page.tab, page.pageUrl);
      if (!highlights.length) return { ok: false, error: "That page does not have any saved highlights yet." };
      const plain = agentPlainText(page.tab.title || "", page.pageUrl, highlights);
      return {
        ok: true,
        url: page.pageUrl,
        title: page.tab.title || "",
        count: highlights.length,
        text: plain.text,
        truncated: plain.truncated,
        highlights: highlights.slice(0, AGENT_SHARE_MAX_HIGHLIGHTS).map(highlight => ({
          id: String(highlight?.id || ""),
          text: String(highlight?.text || ""),
          note: String(highlight?.note || ""),
          tags: Array.isArray(highlight?.tags) ? highlight.tags.map(String).slice(0, 12) : []
        }))
      };
    }

    if (command.type === "create_live_link") {
      const page = await resolveAgentPage(command);
      if (page.error) return { ok: false, error: page.error };
      const highlights = await getAgentHighlights(page.tab, page.pageUrl);
      if (!highlights.length) return { ok: false, error: "That page does not have any saved highlights to share." };
      const name = String(command.name || page.tab.title || "Shared highlights").trim().slice(0, 120);
      const share = await createAgentShareUrl(agentSharePayload(
        page.pageUrl,
        page.tab.title || "",
        highlights,
        name
      ), {
        expiresInDays: command.expiresInDays,
        password: command.password,
        visibility: command.visibility
      });
      await recordAgentShare({
        id: share.id || agentShareId(share.url),
        manageToken: share.manageToken || "",
        name,
        url: share.url,
        shortened: share.shortened,
        sourceUrl: page.pageUrl,
        sourceTitle: page.tab.title || "",
        count: highlights.length,
        createdAt: Date.now(),
        expiresAt: share.expiresAt || 0,
        passwordProtected: share.passwordProtected === true,
        visibility: share.visibility || "unlisted"
      });
      return {
        ok: true,
        url: share.url,
        name,
        sourceUrl: page.pageUrl,
        sourceTitle: page.tab.title || "",
        count: highlights.length,
        shortened: share.shortened,
        expiresAt: share.expiresAt || 0,
        passwordProtected: share.passwordProtected === true,
        visibility: share.visibility || "unlisted"
      };
    }

    if (command.type === "remove_highlights") {
      const page = await resolveAgentPage(command);
      if (page.error) return { ok: false, error: page.error };
      const ids = [...new Set(
        (Array.isArray(command.ids) ? command.ids : [])
          .map(id => String(id || "").trim())
          .filter(Boolean)
          .slice(0, 50)
      )];
      if (!ids.length) return { ok: false, error: "No highlight IDs were supplied." };
      const result = await chrome.tabs.sendMessage(page.tab.id, {
        type: "agentRemoveHighlights",
        ids
      });
      if (result?.ok && Array.isArray(result.removedHighlights) && result.removedHighlights.length) {
        const pageKey = agentPageStorageKey(page.pageUrl);
        const operation = await recordAgentOperation("remove", result.removedHighlights.map(highlight => ({
          pageKey, before: highlight, after: null
        })), `Removed ${result.removedHighlights.length} highlight${result.removedHighlights.length === 1 ? "" : "s"}`);
        result.operationId = operation?.id || "";
      }
      return result && typeof result === "object"
        ? { ...result, url: page.pageUrl, title: page.tab.title || "" }
        : { ok: false, error: "The page did not accept the highlight removal request." };
    }

    if (command.type === "update_highlight") return updateAgentHighlights(command);
    if (command.type === "search_highlights") return searchAgentHighlights(command);
    if (command.type === "list_highlighted_pages") return listAgentPages(command);
    if (command.type === "restore_highlights") return restoreAgentOperation(command);

    if (command.type === "highlight_selection") {
      const page = await resolveAgentPage(command);
      if (page.error) return { ok: false, error: page.error };
      const result = await chrome.tabs.sendMessage(page.tab.id, {
        type: "agentHighlightSelection",
        color: command.color,
        note: command.note,
        tags: sanitizeAgentTags(command.tags)
      });
      if (result?.ok && result.highlight) {
        const operation = await recordAgentOperation("create", [{
          pageKey: agentPageStorageKey(page.pageUrl), before: null, after: result.highlight
        }], "Highlighted the current browser selection");
        result.operationId = operation?.id || "";
      }
      return result && typeof result === "object" ? { ...result, url: page.pageUrl } : { ok: false, error: "The selection could not be highlighted." };
    }

    if (command.type === "export_highlights") return agentExport(command);

    if (command.type === "summarize_highlights") {
      const result = await searchAgentHighlights(command);
      if (!result.highlights.length) return { ok: false, error: "No highlights match that summary request." };
      const text = exportAgentText(result.highlights, "markdown").slice(0, AGENT_TEXT_MAX_CHARS);
      return { ok: true, count: result.highlights.length, text, instruction: "Summarize only these marked passages. Preserve source links and distinguish quotations from notes." };
    }

    if (command.type === "bulk_tag_highlights") {
      return updateAgentHighlights({
        ids: command.ids,
        url: command.url,
        patch: { addTags: command.addTags, removeTags: command.removeTags }
      });
    }

    if (command.type === "get_library_selection") return getAgentLibrarySelection();
    if (command.type === "list_folders") return listAgentFolders(command);
    if (command.type === "organize_folders") return organizeAgentFolders(command);

    if (command.type === "add_page_note") return agentPageNote(command);

    if (command.type === "capture_snapshot" || command.type === "get_highlight_context") {
      const page = await resolveAgentPage(command);
      if (page.error) return { ok: false, error: page.error };
      const result = await chrome.tabs.sendMessage(page.tab.id, {
        type: "agentCaptureSnapshot", id: String(command.id || ""), persist: false
      });
      if (result?.ok && command.type === "capture_snapshot" && result.highlight) {
        const update = await updateAgentHighlights({
          id: result.highlight.id, url: page.pageUrl,
          patch: { snapshot: result.highlight.snapshot }
        });
        return { ...result, operationId: update.operationId || "", url: page.pageUrl };
      }
      return result && typeof result === "object" ? { ...result, url: page.pageUrl } : { ok: false, error: "The highlight context could not be captured." };
    }

    if (command.type === "compare_pages") {
      const urls = [...new Set((Array.isArray(command.urls) ? command.urls : []).map(canonicalAgentUrl).filter(Boolean))].slice(0, 12);
      const result = await searchAgentHighlights({ query: command.query || "" });
      const selected = urls.length ? result.highlights.filter(item => urls.includes(canonicalAgentUrl(item.url))) : result.highlights;
      if (!selected.length) return { ok: false, error: "No saved highlights match those pages." };
      return {
        ok: true, count: selected.length, pageCount: new Set(selected.map(item => item.url)).size,
        text: exportAgentText(selected, "markdown").slice(0, AGENT_TEXT_MAX_CHARS),
        instruction: "Compare only these highlighted passages. Identify themes, agreements, contradictions, and source-specific evidence with links."
      };
    }

    if (command.type === "manage_live_links") return manageAgentLiveLinks(command);

    if (command.type === "collaborate_on_live_link") {
      const history = await getAgentShareHistory();
      const share = history.find(item => item.id === command.id || item.url === command.url);
      if (!share?.id || !share.manageToken) return { ok: false, error: "That link is not in this extension's manageable share history." };
      const result = await agentManageShareRequest({
        action: "collaborate", id: share.id, manageToken: share.manageToken,
        collaborationAction: command.action || "list",
        author: String(command.author || "Agent").slice(0, 40),
        text: String(command.text || "").slice(0, 2000),
        highlightId: String(command.highlightId || "").slice(0, 100),
        reaction: String(command.reaction || "").slice(0, 20)
      });
      return { ok: true, id: share.id, url: share.url, ...result };
    }

    if (command.type === "open_highlight") {
      const result = await searchAgentHighlights({});
      const highlight = result.highlights.find(item => item.id === command.id && (!command.url || canonicalAgentUrl(item.url) === canonicalAgentUrl(command.url)));
      if (!highlight) return { ok: false, error: "That highlight ID was not found." };
      let tab = await findAgentTargetTab(highlight.url);
      if (tab?.id) await chrome.tabs.update(tab.id, { active: true });
      else tab = await chrome.tabs.create({ url: highlight.url });
      if (tab?.id) setTimeout(() => chrome.tabs.sendMessage(tab.id, { type: "scrollTo", id: highlight.id }).catch(() => {}), 900);
      return { ok: true, id: highlight.id, url: highlight.url, title: highlight.title };
    }
  } catch (error) {
    return { ok: false, error: String(error?.message || "Highlighter could not reach the page").slice(0, 240) };
  }
  return { ok: false, error: "Unknown Highlighter command." };
}

async function setAgentConnectionEnabled(enabled) {
  const current = await getAgentConnection();
  const next = {
    enabled: enabled === true,
    token: enabled === true ? (current.token || randomAgentToken()) : ""
  };
  await chrome.storage.local.set({ [AGENT_CONNECTION_KEY]: next });
  if (next.enabled) await connectAgentBridge();
  else closeAgentSocket();
  return {
    ok: true,
    enabled: next.enabled,
    connected: agentSocket?.readyState === WebSocket.OPEN,
    mcpUrl: next.token ? agentMcpUrl(next.token) : ""
  };
}

async function createAgentPairingCode() {
  let config = await getAgentConnection();
  if (!config.enabled || !/^[A-Za-z0-9_-]{43}$/.test(config.token)) {
    await setAgentConnectionEnabled(true);
    config = await getAgentConnection();
  }
  if (!config.token) return { ok: false, error: "The agent connection could not be enabled." };
  try {
    const response = await fetch(`${AGENT_WORKER_BASE}/api/agent/pairing-code`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.token}` }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.code) {
      return { ok: false, error: result?.error_description || result?.error || "A pairing code could not be created." };
    }
    return {
      ok: true,
      code: result.code,
      expiresInSeconds: Number(result.expiresInSeconds) || 600,
      mcpUrl: result.mcpUrl || `${AGENT_WORKER_BASE}/mcp`
    };
  } catch {
    return { ok: false, error: "Highlighter could not reach the pairing service." };
  }
}

function isPdfSourceUrl(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    if (/\.pdf$/i.test(u.pathname)) return true;
    const host = u.hostname.replace(/^www\./, "");
    if ((host === "arxiv.org" || host === "export.arxiv.org") && /^\/pdf\/[^/]+/i.test(u.pathname)) {
      return true;
    }
    return host === "openreview.net" &&
      (u.pathname === "/pdf" || (u.pathname === "/attachment" && u.searchParams.get("name") === "pdf"));
  } catch {
    return false;
  }
}

function hasSharedHighlightPayload(url) {
  try {
    const u = new URL(url);
    return u.searchParams.has("hlshare") || /(?:^|[?&])hlshare=/.test(u.hash.slice(1));
  } catch {
    return false;
  }
}

// A shared PDF first points at the public source URL so the link remains useful
// for people without Highlighter. When the extension is installed, hand that
// navigation directly to our reader before Chrome's protected PDF viewer takes
// over. Ordinary PDFs are left alone until the user clicks the extension icon.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab.url;
  if (!url || !hasSharedHighlightPayload(url) || !isPdfSourceUrl(url)) return;
  const readerUrl = chrome.runtime.getURL(`pdf-reader.html?url=${encodeURIComponent(url)}`);
  chrome.tabs.update(tabId, { url: readerUrl }).catch(() => {});
});

chrome.runtime.onInstalled.addListener(async (details) => {
  const { palette } = await chrome.storage.sync.get("palette");
  if (!palette) await chrome.storage.sync.set({ palette: DEFAULT_PALETTE });

  if (chrome.contextMenus) {
    await chrome.contextMenus.removeAll().catch(() => {});
    chrome.contextMenus.create({ id: "hl-highlight-selection", title: "Highlight selection", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "hl-highlight-colors", title: "Highlight with color", contexts: ["selection"] });
    DEFAULT_PALETTE.forEach(color => chrome.contextMenus.create({
      id: `hl-highlight-${color.name.toLowerCase()}`,
      parentId: "hl-highlight-colors",
      title: color.name,
      contexts: ["selection"]
    }));
    chrome.contextMenus.create({ id: "hl-highlight-edit", title: "Highlight, then add tags or note…", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "hl-open-library", title: "Open Highlighter library", contexts: ["page", "selection"] });
  }

  // Open the welcome page only on first install (not on updates or browser restart)
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
  }
});

async function highlightCurrentSelection(tab, color = "yellow") {
  if (!tab?.id) return null;
  try { return await chrome.tabs.sendMessage(tab.id, { type: "agentHighlightSelection", color, tags: [] }); } catch { return null; }
}

async function openChatGptWithHighlighterPrompt(rawPrompt) {
  const prompt = String(rawPrompt || "").trim().slice(0, 8000);
  if (!prompt) return { ok: false, error: "The chat prompt is empty." };
  const tabs = await chrome.tabs.query({ url: ["https://chatgpt.com/*", "https://chat.openai.com/*"] });
  let target = tabs.sort((a, b) => Number(b.active) - Number(a.active) || Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0))[0];
  if (!target?.id) target = await chrome.tabs.create({ url: "https://chatgpt.com/" });
  if (!target?.id) return { ok: false, error: "ChatGPT could not be opened." };

  await chrome.tabs.update(target.id, { active: true });
  if (target.windowId !== undefined && chrome.windows?.update) {
    await chrome.windows.update(target.windowId, { focused: true }).catch(() => {});
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const result = await chrome.tabs.sendMessage(target.id, {
        type: "insertHighlighterChatPrompt",
        prompt
      });
      if (result?.ok) return { ok: true, mode: "inserted" };
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  return { ok: true, mode: "opened" };
}

chrome.contextMenus?.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "hl-open-library") {
    chrome.tabs.create({ url: chrome.runtime.getURL("library.html") });
    return;
  }
  if (info.menuItemId === "hl-highlight-edit") {
    void highlightCurrentSelection(tab, "yellow").then(result => {
      if (result?.id) chrome.tabs.create({ url: chrome.runtime.getURL(`library.html#${encodeURIComponent(result.id)}`) });
    });
    return;
  }
  const match = String(info.menuItemId || "").match(/^hl-highlight-(.+)$/);
  void highlightCurrentSelection(tab, match?.[1] === "selection" ? "yellow" : (match?.[1] || "yellow"));
});

chrome.commands?.onCommand.addListener(command => {
  if (command !== "highlight-selection") return;
  void activeAgentTab().then(tab => highlightCurrentSelection(tab, "yellow"));
});

chrome.runtime.onStartup.addListener(() => { void connectAgentBridge(); });
chrome.alarms.create(AGENT_RECONNECT_ALARM, { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === AGENT_RECONNECT_ALARM) void connectAgentBridge();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "openUrl") {
    chrome.tabs.create({ url: msg.url });
    sendResponse({ ok: true });
  } else if (msg.type === "captureTab") {
    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
      sendResponse({ dataUrl });
    });
    return true; // asynchronous response
  } else if (msg.type === "getAgentConnectionStatus") {
    getAgentConnection().then(config => sendResponse({
      ok: true,
      enabled: config.enabled,
      connected: agentSocket?.readyState === WebSocket.OPEN,
      mcpUrl: config.token ? agentMcpUrl(config.token) : ""
    }));
    return true;
  } else if (msg.type === "setAgentConnectionEnabled") {
    setAgentConnectionEnabled(msg.enabled === true).then(sendResponse);
    return true;
  } else if (msg.type === "createAgentPairingCode") {
    createAgentPairingCode().then(sendResponse);
    return true;
  } else if (msg.type === "openChatGptWithHighlighterPrompt") {
    openChatGptWithHighlighterPrompt(msg.prompt).then(sendResponse);
    return true;
  } else if (msg.type === "recordHighlightRemoval") {
    const pageUrl = canonicalAgentUrl(msg.pageUrl);
    const removed = Array.isArray(msg.highlights) ? msg.highlights.filter(item => item?.id).slice(0, 100) : [];
    if (!pageUrl || !removed.length) {
      sendResponse({ ok: false });
      return true;
    }
    const pageKey = agentPageStorageKey(pageUrl);
    recordAgentOperation("remove", removed.map(highlight => ({ pageKey, before: highlight, after: null })),
      `Removed ${removed.length} highlight${removed.length === 1 ? "" : "s"}`)
      .then(operation => sendResponse({ ok: true, operationId: operation?.id || "" }));
    return true;
  }
  return true;
});

void connectAgentBridge();
