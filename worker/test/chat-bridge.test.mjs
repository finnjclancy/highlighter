import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadChatBridge(composer) {
  const source = await readFile(new URL("../../chat-bridge.js", import.meta.url), "utf8");
  let listener;
  const events = [];
  const context = {
    chrome: { runtime: { onMessage: { addListener(value) { listener = value; } } } },
    location: { hostname: "chatgpt.com" },
    document: {
      querySelector() { return composer; },
      createRange() { return null; }
    },
    window: { getSelection() { return null; } },
    Event: class { constructor(type) { this.type = type; events.push(type); } },
    InputEvent: class { constructor(type) { this.type = type; events.push(type); } },
    Set,
    String,
    Object
  };
  context.globalThis = context;
  vm.runInNewContext(source, context);
  return { listener, events };
}

test("chat bridge appends the staged instruction to an open ChatGPT textarea", async () => {
  const composer = {
    tagName: "TEXTAREA",
    value: "Keep this draft",
    focusCalled: false,
    focus() { this.focusCalled = true; },
    dispatchEvent() {}
  };
  const { listener, events } = await loadChatBridge(composer);
  let response;
  listener({ type: "insertHighlighterChatPrompt", prompt: "Organise my selected highlights." }, {}, value => { response = value; });

  assert.equal(response.ok, true);
  assert.equal(composer.focusCalled, true);
  assert.equal(composer.value, "Keep this draft\n\nOrganise my selected highlights.");
  assert.deepEqual(events, ["input"]);
});

test("chat bridge reports when the ChatGPT composer is not available", async () => {
  const { listener } = await loadChatBridge(null);
  let response;
  listener({ type: "insertHighlighterChatPrompt", prompt: "Use my selection." }, {}, value => { response = value; });
  assert.equal(response.ok, false);
  assert.match(response.error, /Open a ChatGPT conversation/);
});
