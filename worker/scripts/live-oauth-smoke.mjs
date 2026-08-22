import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";

const origin = process.env.HIGHLIGHTER_MCP_ORIGIN || "https://highlighter-share.finnjclancy.workers.dev";
const redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";
const resource = `${origin}/mcp`;

const json = async (path, init) => {
  const response = await fetch(`${origin}${path}`, init);
  const body = await response.json();
  return { response, body };
};

const metadata = await json("/.well-known/oauth-protected-resource");
assert.equal(metadata.response.status, 200);
assert.equal(metadata.body.resource, resource);

const registration = await json("/oauth/register", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    client_name: "Highlighter live deployment smoke test",
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none"
  })
});
assert.equal(registration.response.status, 201);

const browserToken = randomBytes(32).toString("base64url");
const pairing = await json("/api/agent/pairing-code", {
  method: "POST",
  headers: { authorization: `Bearer ${browserToken}` }
});
assert.equal(pairing.response.status, 200);

const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const authorizeBody = new URLSearchParams({
  response_type: "code",
  client_id: registration.body.client_id,
  redirect_uri: redirectUri,
  code_challenge: challenge,
  code_challenge_method: "S256",
  state: "deployment-smoke-test",
  resource,
  scope: "highlighter:control",
  pairing_code: pairing.body.code
});
const authorization = await fetch(`${origin}/oauth/authorize`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: authorizeBody,
  redirect: "manual"
});
assert.equal(authorization.status, 302);
const callback = new URL(authorization.headers.get("location"));
assert.equal(callback.searchParams.get("state"), "deployment-smoke-test");
assert.equal(callback.searchParams.get("iss"), origin);

const token = await json("/oauth/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    client_id: registration.body.client_id,
    redirect_uri: redirectUri,
    code: callback.searchParams.get("code"),
    code_verifier: verifier,
    resource
  })
});
assert.equal(token.response.status, 200);
assert.equal(token.body.token_type, "Bearer");

const toolsResponse = await fetch(`${origin}/mcp`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${token.body.access_token}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream"
  },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
});
assert.equal(toolsResponse.status, 200);
const toolsText = await toolsResponse.text();
const toolsData = toolsText.split(/\r?\n/).find(line => line.startsWith("data: "))?.slice(6);
assert.ok(toolsData, "MCP response did not contain an SSE data event");
const toolsBody = JSON.parse(toolsData);
assert.equal(toolsBody.result.tools.length, 24);
assert.ok(toolsBody.result.tools.every(tool => tool.securitySchemes?.[0]?.type === "oauth2"));

const refreshed = await json("/oauth/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "refresh_token",
    client_id: registration.body.client_id,
    refresh_token: token.body.refresh_token,
    resource
  })
});
assert.equal(refreshed.response.status, 200);
assert.notEqual(refreshed.body.refresh_token, token.body.refresh_token);

await fetch(`${origin}/oauth/revoke`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ token: refreshed.body.refresh_token })
});

console.log(`Live OAuth/MCP smoke test passed: discovery, DCR, PKCE, 24 tools, refresh rotation, revocation (${origin})`);
