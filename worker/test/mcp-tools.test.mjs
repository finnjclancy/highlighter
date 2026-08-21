import assert from "node:assert/strict";
import test from "node:test";

import { createHighlighterMcpServer } from "../src/index.js";

function serverWithBridge(resultForCommand) {
  const commands = [];
  const bridge = {
    async issueCommand(command) {
      commands.push(command);
      return resultForCommand(command);
    }
  };
  const env = { AGENT_BRIDGE: { getByName: () => bridge } };
  return { server: createHighlighterMcpServer(env, "a".repeat(43)), commands };
}

test("registers text, removal, and live-link tools with the intended annotations", () => {
  const { server } = serverWithBridge(() => ({ ok: true }));
  const textTool = server._registeredTools.get_highlighted_text;
  const removeTool = server._registeredTools.remove_highlights;
  const linkTool = server._registeredTools.create_live_link;

  assert.ok(textTool);
  assert.ok(removeTool);
  assert.ok(linkTool);
  assert.equal(textTool.annotations.readOnlyHint, true);
  assert.equal(removeTool.annotations.readOnlyHint, false);
  assert.equal(removeTool.annotations.destructiveHint, true);
  assert.equal(removeTool.annotations.idempotentHint, true);
  assert.equal(linkTool.annotations.readOnlyHint, false);
  assert.equal(linkTool.annotations.openWorldHint, true);
});

test("registers the complete library, history, export, sharing, and collaboration toolset", () => {
  const { server } = serverWithBridge(() => ({ ok: true }));
  const expected = [
    "get_active_page", "highlight_passages", "get_highlighted_text", "remove_highlights", "create_live_link",
    "update_highlight", "search_highlights", "list_highlighted_pages", "restore_highlights", "highlight_selection",
    "export_highlights", "summarize_highlights", "bulk_tag_highlights", "add_page_note", "capture_snapshot",
    "compare_pages", "manage_live_links", "collaborate_on_live_link", "get_highlight_context", "open_highlight"
  ];
  assert.deepEqual(Object.keys(server._registeredTools).sort(), expected.sort());
  assert.equal(server._registeredTools.search_highlights.annotations.readOnlyHint, true);
  assert.equal(server._registeredTools.capture_snapshot.annotations.readOnlyHint, false);
  assert.equal(server._registeredTools.manage_live_links.annotations.destructiveHint, true);
});

test("get_highlighted_text returns copy-ready text to the MCP client", async () => {
  const { server, commands } = serverWithBridge(() => ({
    ok: true,
    url: "https://example.com/article",
    title: "Example article",
    count: 1,
    text: "Example article\nhttps://example.com/article\n\nA saved quote.\n",
    highlights: [{ id: "h1", text: "A saved quote.", note: "", tags: [] }]
  }));

  const result = await server._registeredTools.get_highlighted_text.handler({});
  assert.deepEqual(commands, [{ type: "get_highlighted_text" }]);
  assert.match(result.content[0].text, /A saved quote\./);
  assert.equal(result.structuredContent.count, 1);
  assert.equal(result.structuredContent.highlights[0].id, "h1");
});

test("remove_highlights forwards only explicit IDs and reports the remaining count", async () => {
  const { server, commands } = serverWithBridge(() => ({
    ok: true,
    removed: 1,
    removedIds: ["h1"],
    notFound: [],
    remaining: 2
  }));

  const result = await server._registeredTools.remove_highlights.handler({
    ids: ["h1"],
    url: "https://example.com/article"
  });
  assert.deepEqual(commands, [{
    type: "remove_highlights",
    ids: ["h1"],
    url: "https://example.com/article"
  }]);
  assert.match(result.content[0].text, /Removed 1 highlight\. 2 highlights remain\./);
  assert.equal(result.structuredContent.removed, 1);
});

test("create_live_link returns the finished URL and forwards its name", async () => {
  const { server, commands } = serverWithBridge(() => ({
    ok: true,
    url: "https://highlighter-share.example/v/abcd2345",
    name: "Research notes",
    count: 2,
    shortened: true
  }));

  const result = await server._registeredTools.create_live_link.handler({ name: "Research notes" });
  assert.deepEqual(commands, [{ type: "create_live_link", name: "Research notes" }]);
  assert.match(result.content[0].text, /https:\/\/highlighter-share\.example\/v\/abcd2345/);
  assert.equal(result.structuredContent.count, 2);
});
