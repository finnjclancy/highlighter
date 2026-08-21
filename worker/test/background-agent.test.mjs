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
    "hl_page_https://example.com/article": highlights
  };
  const tab = { id: 7, url: "https://example.com/article", title: "Example article" };
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
      async query() { return [tab]; },
      async sendMessage(_tabId, message) {
        tabMessages.push(message);
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
    fetch: async () => new Response(JSON.stringify({
      id: "abcd2345",
      url: "https://highlighter-share.example/v/abcd2345"
    }), { status: 200, headers: { "content-type": "application/json" } })
  };
  context.globalThis = context;
  vm.runInNewContext(`${source}\n;globalThis.__backgroundTest = { handleAgentCommand };`, context);
  return { handleAgentCommand: context.__backgroundTest.handleAgentCommand, storage, tabMessages };
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

test("background creates and records a live share", async () => {
  const { handleAgentCommand, storage } = await loadBackground();
  const result = await handleAgentCommand({ type: "create_live_link", name: "Agent share" });

  assert.equal(result.ok, true);
  assert.equal(result.url, "https://highlighter-share.example/v/abcd2345");
  assert.equal(result.count, 1);
  assert.equal(storage.hl_shares.length, 1);
  assert.equal(storage.hl_shares[0].name, "Agent share");
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
