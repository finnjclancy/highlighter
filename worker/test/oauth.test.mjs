import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import worker, { createHighlighterMcpServer, verifyOAuthAccessToken } from "../src/index.js";

const ORIGIN = "https://highlighter-share.example";
const REDIRECT_URI = "https://chatgpt.com/connector_platform_oauth_redirect";
const SIGNING_SECRET = "test-signing-secret-that-is-long-enough-for-hmac-verification";

class MemoryKv {
  constructor() { this.values = new Map(); }
  async get(key, type) {
    const value = this.values.get(key);
    if (value === undefined) return null;
    return type === "json" ? JSON.parse(value) : value;
  }
  async put(key, value) { this.values.set(key, String(value)); }
  async delete(key) { this.values.delete(key); }
}

class MemoryOAuthNamespace {
  constructor() { this.values = new Map(); }
  getByName(key) {
    return {
      store: async (record, ttlSeconds) => {
        this.values.set(key, { ...record, expiresAt: Date.now() + ttlSeconds * 1000 });
      },
      consume: async () => {
        const value = this.values.get(key);
        this.values.delete(key);
        if (!value || value.expiresAt <= Date.now()) return null;
        const { expiresAt, ...record } = value;
        return record;
      }
    };
  }
}

function testEnv() {
  return {
    HIGHLIGHTS: new MemoryKv(),
    OAUTH_SESSION: new MemoryOAuthNamespace(),
    OAUTH_SIGNING_SECRET: SIGNING_SECRET,
    AGENT_BRIDGE: { getByName: () => ({ async issueCommand() { return { ok: true }; } }) }
  };
}

async function fetchWorker(env, path, init = {}) {
  return worker.fetch(new Request(`${ORIGIN}${path}`, init), env, { waitUntil() {} });
}

async function registerClient(env) {
  const response = await fetchWorker(env, "/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "ChatGPT",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none"
    })
  });
  assert.equal(response.status, 201);
  return response.json();
}

function pkceChallenge(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

test("publishes protected-resource and OAuth discovery metadata", async () => {
  const env = testEnv();
  const resourceResponse = await fetchWorker(env, "/.well-known/oauth-protected-resource");
  const resource = await resourceResponse.json();
  assert.equal(resourceResponse.status, 200);
  assert.equal(resource.resource, `${ORIGIN}/mcp`);
  assert.deepEqual(resource.authorization_servers, [ORIGIN]);

  const metadataResponse = await fetchWorker(env, "/.well-known/oauth-authorization-server");
  const metadata = await metadataResponse.json();
  assert.equal(metadata.authorization_endpoint, `${ORIGIN}/oauth/authorize`);
  assert.equal(metadata.token_endpoint, `${ORIGIN}/oauth/token`);
  assert.equal(metadata.registration_endpoint, `${ORIGIN}/oauth/register`);
  assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
});

test("serves the exact OpenAI domain challenge only when configured", async () => {
  const env = testEnv();
  const missing = await fetchWorker(env, "/.well-known/openai-apps-challenge");
  assert.equal(missing.status, 404);
  env.OPENAI_APPS_CHALLENGE = "openai-domain-verification-token";
  const configured = await fetchWorker(env, "/.well-known/openai-apps-challenge");
  assert.equal(configured.status, 200);
  assert.equal(await configured.text(), "openai-domain-verification-token");
});

test("pairs a browser through OAuth authorization code and PKCE", async () => {
  const env = testEnv();
  const client = await registerClient(env);
  const privateToken = "a".repeat(43);
  const pairResponse = await fetchWorker(env, "/api/agent/pairing-code", {
    method: "POST",
    headers: { authorization: `Bearer ${privateToken}` }
  });
  const pairing = await pairResponse.json();
  assert.equal(pairResponse.status, 200);
  assert.match(pairing.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  const verifier = "v".repeat(43);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: REDIRECT_URI,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: "S256",
    state: "state-123",
    resource: `${ORIGIN}/mcp`,
    scope: "highlighter:control"
  });
  const page = await fetchWorker(env, `/oauth/authorize?${params}`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Connect your browser/);

  params.set("pairing_code", pairing.code);
  const authorization = await fetchWorker(env, "/oauth/authorize", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params,
    redirect: "manual"
  });
  assert.equal(authorization.status, 302);
  const callback = new URL(authorization.headers.get("location"));
  assert.equal(callback.origin + callback.pathname, REDIRECT_URI);
  assert.equal(callback.searchParams.get("state"), "state-123");
  assert.equal(callback.searchParams.get("iss"), ORIGIN);
  const code = callback.searchParams.get("code");
  assert.ok(code);

  const tokenResponse = await fetchWorker(env, "/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: client.client_id,
      redirect_uri: REDIRECT_URI,
      code,
      code_verifier: verifier,
      resource: `${ORIGIN}/mcp`
    })
  });
  const tokens = await tokenResponse.json();
  assert.equal(tokenResponse.status, 200);
  assert.equal(tokens.token_type, "Bearer");
  assert.ok(tokens.access_token);
  assert.ok(tokens.refresh_token);

  const claims = await verifyOAuthAccessToken(env, ORIGIN, tokens.access_token);
  assert.equal(claims.aud, `${ORIGIN}/mcp`);
  assert.equal(claims.scope, "highlighter:control");
  assert.equal(claims.sub, createHash("sha256").update(privateToken).digest("hex"));

  const secondUse = await fetchWorker(env, "/oauth/authorize", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params,
    redirect: "manual"
  });
  assert.equal(secondUse.status, 400);
  assert.match(await secondUse.text(), /invalid or expired/);
});

test("every public MCP tool advertises OAuth security metadata", () => {
  const env = testEnv();
  const server = createHighlighterMcpServer(env, "b".repeat(64));
  for (const tool of Object.values(server._registeredTools)) {
    assert.deepEqual(tool._meta.securitySchemes, [{ type: "oauth2", scopes: ["highlighter:control"] }]);
  }
});

test("unauthenticated MCP requests return an OAuth discovery challenge", async () => {
  const response = await fetchWorker(testEnv(), "/mcp", { method: "POST" });
  assert.equal(response.status, 401);
  assert.match(response.headers.get("www-authenticate"), /oauth-protected-resource/);
  assert.match(response.headers.get("www-authenticate"), /highlighter:control/);
});

test("authenticated SSE tool listings mirror OAuth metadata at the top level", async () => {
  const env = testEnv();
  const accessToken = await (async () => {
    const { createOAuthAccessToken } = await import("../src/index.js");
    return createOAuthAccessToken(env, ORIGIN, {
      bridgeKey: "c".repeat(64),
      scope: "highlighter:control"
    });
  })();
  const response = await fetchWorker(env, "/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
  });
  assert.equal(response.status, 200);
  const dataLine = (await response.text()).split(/\r?\n/).find(line => line.startsWith("data: "));
  const body = JSON.parse(dataLine.slice(6));
  assert.equal(body.result.tools.length, 24);
  assert.ok(body.result.tools.every(tool => tool.securitySchemes?.[0]?.type === "oauth2"));
});
