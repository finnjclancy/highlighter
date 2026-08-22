import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

async function loadBackground() {
  const source = await readFile(new URL("../../background.js", import.meta.url), "utf8");
  const highlights = [{
    id: "h1",
    bg: "#fff59d",
    fg: "#1a1a1a",
    text: "A saved quote.",
    note: "Useful",
    tags: ["Research"],
    prefix: "Before ",
    suffix: " after."
  }];
  const storage = {
    hl_agent_connection: { enabled: false, token: "" },
    hl_agent_library_selection: { selectionId: "selection-1", createdAt: 123, highlightIds: ["h1", "missing"] },
    "hl_page_https://example.com/article": highlights
  };
  const tab = { id: 7, url: "https://example.com/article", title: "Example article" };
  const pdfTab = {
    id: 8,
    title: "Example paper - Highlight"
  };
  const listeners = { socket: null };
  const tabMessages = [];
  const chrome = {
    runtime: {
      getURL: path => `chrome-extension://test/${String(path || "").replace(/^\//, "")}`,
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener() {} }
    },
    storage: {
      local: {
        async get(key) {
          if (key === null) return { ...storage };
          if (typeof key === "string") return { [key]: storage[key] };
          return { ...storage };
        },
        async set(values) { Object.assign(storage, values); },
        async remove(keys) { (Array.isArray(keys) ? keys : [keys]).forEach(key => delete storage[key]); }
      },
      sync: { async get() { return {}; }, async set() {} }
    },
    tabs: {
      async query() { return [tab, pdfTab]; },
      async sendMessage(tabId, message) {
        tabMessages.push(message);
        if (tabId === pdfTab.id && message.type === "getAgentPageState") {
          return {
            ok: true,
            url: "https://example.com/paper.pdf",
            title: "Example paper",
            selection: "",
            highlightCount: 0,
            isPdfReader: true
          };
        }
        if (tabId === pdfTab.id && message.type === "getAgentPdfDocument") {
          return {
            ok: true,
            title: "Example paper",
            pageCount: 12,
            startPage: Number(message.startPage) || 1,
            endPage: 4,
            nextPage: 5,
            truncated: true,
            text: "[Page 1]\nExact PDF text."
          };
        }
        if (message.type === "getContextForShare") return { ok: true, highlights };
        if (message.type === "agentRemoveHighlights") {
          const requested = new Set(message.ids);
          const removedIds = highlights.filter(highlight => requested.has(highlight.id)).map(highlight => highlight.id);
          const removedHighlights = highlights.filter(highlight => requested.has(highlight.id)).map(highlight => ({ ...highlight }));
          const notFound = message.ids.filter(id => !removedIds.includes(id));
          for (let index = highlights.length - 1; index >= 0; index--) {
            if (requested.has(highlights[index].id)) highlights.splice(index, 1);
          }
          return {
            ok: removedIds.length > 0,
            removed: removedIds.length,
            removedIds,
            removedHighlights,
            notFound,
            remaining: highlights.length
          };
        }
        return {};
      },
      async update() {},
      create() {},
      onUpdated: { addListener() {} }
    },
    alarms: { create() {}, onAlarm: { addListener() {} } }
  };
  const context = {
    chrome,
    crypto: webcrypto,
    URL,
    Blob,
    CompressionStream,
    Response,
    TextEncoder,
    Uint8Array,
    btoa,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
    WebSocket: class {
      static OPEN = 1;
      static CONNECTING = 0;
      constructor() { listeners.socket = this; }
      addEventListener() {}
      close() {}
    },
    fetch: async (requestUrl) => new Response(JSON.stringify(String(requestUrl).endsWith("/api/agent/pairing-code")
      ? { code: "ABCD-EFGH-JKLM", expiresInSeconds: 600, mcpUrl: "https://highlighter-share.example/mcp" }
      : { id: "abcd2345", url: "https://highlighter-share.example/v/abcd2345" }
    ), { status: 200, headers: { "content-type": "application/json" } })
  };
  context.globalThis = context;
  vm.runInNewContext(`${source}\n;globalThis.__backgroundTest = { handleAgentCommand, createAgentPairingCode };`, context);
  return {
    handleAgentCommand: context.__backgroundTest.handleAgentCommand,
    createAgentPairingCode: context.__backgroundTest.createAgentPairingCode,
    storage,
    tabMessages
  };
}

test("background returns highlighted text in a chat-ready format", async () => {
  const { handleAgentCommand } = await loadBackground();
  const result = await handleAgentCommand({ type: "get_highlighted_text" });

  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.match(result.text, /A saved quote\./);
  assert.match(result.text, /Tags: Research/);
  assert.match(result.text, /Note: Useful/);
});

test("background reads an exact PDF source from the open Highlight reader", async () => {
  const { handleAgentCommand, tabMessages } = await loadBackground();
  const result = await handleAgentCommand({
    type: "get_pdf_document",
    url: "https://example.com/paper.pdf",
    startPage: 1,
    pageCount: 4
  });

  assert.equal(result.ok, true);
  assert.equal(result.url, "https://example.com/paper.pdf");
  assert.equal(result.pageCount, 12);
  assert.match(result.text, /Exact PDF text/);
  assert.equal(tabMessages.at(-1).type, "getAgentPdfDocument");
});

test("background creates and records a live share", async () => {
  const { handleAgentCommand, storage } = await loadBackground();
  const result = await handleAgentCommand({ type: "create_live_link", name: "Agent share" });

  assert.equal(result.ok, true);
  assert.equal(result.url, "https://highlighter-share.example/v/abcd2345");
  assert.equal(result.count, 1);
  assert.equal(storage.hl_shares.length, 1);
  assert.equal(storage.hl_shares[0].name, "Agent share");
});

test("background enables the bridge and creates a one-time ChatGPT pairing code", async () => {
  const { createAgentPairingCode, storage } = await loadBackground();
  const result = await createAgentPairingCode();

  assert.equal(result.ok, true);
  assert.equal(result.code, "ABCD-EFGH-JKLM");
  assert.equal(result.expiresInSeconds, 600);
  assert.equal(storage.hl_agent_connection.enabled, true);
  assert.match(storage.hl_agent_connection.token, /^[A-Za-z0-9_-]{43}$/);
});

test("background removes only explicit highlight IDs from the target page", async () => {
  const { handleAgentCommand, tabMessages } = await loadBackground();
  const result = await handleAgentCommand({
    type: "remove_highlights",
    ids: ["h1", "missing"]
  });

  assert.equal(result.ok, true);
  assert.equal(result.removed, 1);
  assert.deepEqual(Array.from(result.removedIds), ["h1"]);
  assert.deepEqual(Array.from(result.notFound), ["missing"]);
  assert.equal(result.remaining, 0);
  assert.equal(tabMessages.at(-1).type, "agentRemoveHighlights");
  assert.deepEqual(Array.from(tabMessages.at(-1).ids), ["h1", "missing"]);
});

test("background searches, updates, and exports the cross-page library", async () => {
  const { handleAgentCommand } = await loadBackground();
  const search = await handleAgentCommand({ type: "search_highlights", query: "saved quote" });
  assert.equal(search.ok, true);
  assert.equal(search.count, 1);
  assert.equal(search.highlights[0].id, "h1");

  const update = await handleAgentCommand({
    type: "update_highlight",
    ids: ["h1"],
    patch: { note: "Updated", addTags: ["Review"], color: "blue" }
  });
  assert.equal(update.ok, true);
  assert.equal(update.updated, 1);
  assert.ok(update.operationId);

  const exported = await handleAgentCommand({ type: "export_highlights", format: "csv" });
  assert.equal(exported.ok, true);
  assert.match(exported.text, /Updated/);
  assert.match(exported.text, /Review/);
});

test("background can reverse an update operation", async () => {
  const { handleAgentCommand } = await loadBackground();
  const update = await handleAgentCommand({
    type: "update_highlight", ids: ["h1"], patch: { note: "Temporary" }
  });
  const restored = await handleAgentCommand({ type: "restore_highlights", operationId: update.operationId });
  assert.equal(restored.ok, true);
  const search = await handleAgentCommand({ type: "search_highlights", query: "Useful" });
  assert.equal(search.count, 1);
  assert.equal(search.highlights[0].note, "Useful");
});

test("background returns the exact staged library selection with current data", async () => {
  const { handleAgentCommand } = await loadBackground();
  const result = await handleAgentCommand({ type: "get_library_selection" });

  assert.equal(result.ok, true);
  assert.equal(result.selectionId, "selection-1");
  assert.equal(result.count, 1);
  assert.equal(result.unavailable, 1);
  assert.equal(result.highlights[0].id, "h1");
  assert.equal(result.highlights[0].note, "Useful");
});

test("background lists folders and reversibly adds selected highlights to a folder", async () => {
  const { handleAgentCommand } = await loadBackground();
  const before = await handleAgentCommand({ type: "list_folders", includeSamples: true });
  assert.equal(before.ok, true);
  assert.equal(before.count, 1);
  assert.equal(before.folders[0].name, "Research");
  assert.equal(before.folders[0].samples[0].id, "h1");

  const organized = await handleAgentCommand({
    type: "organize_folders", action: "add_to_folder", ids: ["h1"], folder: "Literature review"
  });
  assert.equal(organized.ok, true);
  assert.equal(organized.updated, 1);
  assert.ok(organized.operationId);

  const after = await handleAgentCommand({ type: "list_folders" });
  assert.equal(after.folders.some(folder => folder.name === "Literature review"), true);

  const restored = await handleAgentCommand({ type: "restore_highlights", operationId: organized.operationId });
  assert.equal(restored.ok, true);
  const finalFolders = await handleAgentCommand({ type: "list_folders" });
  assert.equal(finalFolders.folders.some(folder => folder.name === "Literature review"), false);
});

test("background can rename and merge folder labels without deleting highlights", async () => {
  const { handleAgentCommand } = await loadBackground();
  const renamed = await handleAgentCommand({
    type: "organize_folders", action: "rename_folder", fromFolder: "Research", folder: "Sources"
  });
  assert.equal(renamed.ok, true);

  await handleAgentCommand({
    type: "organize_folders", action: "add_to_folder", ids: ["h1"], folder: "Review"
  });
  const merged = await handleAgentCommand({
    type: "organize_folders", action: "merge_folders", sourceFolders: ["Sources", "Review"], folder: "Evidence"
  });
  assert.equal(merged.ok, true);

  const search = await handleAgentCommand({ type: "search_highlights", query: "saved quote" });
  assert.equal(search.count, 1);
  assert.deepEqual(Array.from(search.highlights[0].tags), ["Evidence"]);
});
