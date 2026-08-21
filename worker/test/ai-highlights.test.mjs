import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.js";

function geminiResponse(parsed) {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(parsed) }] } }]
  }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

async function runWorker({ spans, focus, geminiFetch }) {
  const waits = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = geminiFetch;
  try {
    const response = await worker.fetch(new Request("https://worker.test/api/ai/highlights", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Test paper",
        url: "https://example.org/paper.pdf",
        focus,
        spans
      })
    }), {
      GEMINI_API_KEY: "test-key",
      HIGHLIGHTS: {
        get: async () => null,
        put: async () => {}
      }
    }, {
      waitUntil(promise) { waits.push(promise); }
    });
    await Promise.all(waits);
    return { status: response.status, data: await response.json() };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("literal instructions preserve every match beyond six", async () => {
  const expected = [1, 4, 7, 11, 14, 19, 23, 28, 31, 36, 41, 45, 50, 54, 58];
  const spans = Array.from({ length: 60 }, (_, index) => ({
    id: `p1t${index}`,
    page: 1,
    text: expected.includes(index)
      ? `This complete sentence contains ORCHID at position ${index}.`
      : `This is unrelated sentence ${index}.`
  }));
  const result = await runWorker({
    spans,
    focus: "Highlight every sentence containing the keyword ORCHID.",
    geminiFetch: async () => { throw new Error("literal matching should not call Gemini"); }
  });

  assert.equal(result.status, 200);
  assert.equal(result.data.selectionMode, "exhaustive_literal");
  assert.equal(result.data.highlights.length, expected.length);
  assert.deepEqual(
    result.data.highlights.map(highlight => Number(highlight.startId.split("t")[1])),
    expected
  );
});

test("literal phrases can cross PDF text-span boundaries", async () => {
  const spans = Array.from({ length: 12 }, (_, index) => ({
    id: `p2t${index}`,
    page: 2,
    text: `Ordinary sentence ${index}.`
  }));
  spans[5].text = "The proposed world";
  spans[6].text = "model improves planning.";
  const result = await runWorker({
    spans,
    focus: "Highlight sentences containing the phrase ‘world model’.",
    geminiFetch: async () => { throw new Error("literal matching should not call Gemini"); }
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.data.literalTerms, ["world model"]);
  assert.equal(result.data.highlights.length, 1);
  assert.equal(result.data.highlights[0].startId, "p2t5");
  assert.equal(result.data.highlights[0].endId, "p2t6");
});

test("exhaustive semantic instructions analyze and merge every chunk", async () => {
  let geminiCalls = 0;
  const spans = Array.from({ length: 240 }, (_, index) => ({
    id: `p${Math.floor(index / 30) + 1}t${index % 30}`,
    page: Math.floor(index / 30) + 1,
    text: `${index % 57 === 0 ? "CONTRADICTION" : "Background"} ${index} ${"analysis ".repeat(45)}.`
  }));
  const result = await runWorker({
    spans,
    focus: "Find every claim that contradicts the baseline assumptions.",
    geminiFetch: async (_url, init) => {
      geminiCalls++;
      const body = JSON.parse(init.body);
      const prompt = body.contents[0].parts[0].text;
      if (geminiCalls === 1) {
        return geminiResponse({
          selectionMode: "exhaustive_semantic",
          literalTerms: [],
          caseSensitive: false,
          executionSummary: "Select every conceptual contradiction."
        });
      }
      const selections = [...prompt.matchAll(/\[(p\d+t\d+)\] CONTRADICTION/g)].map(match => ({
        startId: match[1],
        endId: match[1],
        category: "evidence",
        section: "Test",
        reason: "Contradicts the baseline."
      }));
      return geminiResponse({ selections });
    }
  });

  assert.equal(result.status, 200);
  assert.equal(result.data.selectionMode, "exhaustive_semantic");
  assert.ok(result.data.chunksAnalyzed >= 2);
  assert.equal(geminiCalls, result.data.chunksAnalyzed + 1);
  assert.ok(result.data.highlights.length >= 4);
});
