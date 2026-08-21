import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.js";

function memoryKv() {
  const values = new Map();
  return {
    async get(key, type) {
      const value = values.get(key) ?? null;
      return type === "json" && value ? JSON.parse(value) : value;
    },
    async put(key, value) { values.set(key, String(value)); }
  };
}

async function createShare(env, extra = {}) {
  const response = await worker.fetch(new Request("https://worker.test/api/shorten", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ payload: "dGVzdA", ...extra })
  }), env, { waitUntil() {} });
  return { response, data: await response.json() };
}

test("creates manageable password-protected shares and unlocks them with a cookie", async () => {
  const env = { HIGHLIGHTS: memoryKv() };
  const { response, data } = await createShare(env, { password: "secret", visibility: "private", expiresInDays: 7 });
  assert.equal(response.status, 200);
  assert.equal(data.passwordProtected, true);
  assert.match(data.manageToken, /^[A-Za-z0-9_-]{43}$/);

  const locked = await worker.fetch(new Request(data.url), env, { waitUntil() {} });
  assert.equal(locked.status, 200);
  assert.match(await locked.text(), /Protected highlights/);

  const unlocked = await worker.fetch(new Request(data.url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password: "secret" })
  }), env, { waitUntil() {} });
  assert.ok(unlocked.headers.get("set-cookie")?.includes(`hl_access_${data.id}=`));
});

test("management credentials can revoke a share", async () => {
  const env = { HIGHLIGHTS: memoryKv() };
  const { data } = await createShare(env);
  const managed = await worker.fetch(new Request("https://worker.test/api/share/manage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "revoke", id: data.id, manageToken: data.manageToken })
  }), env, { waitUntil() {} });
  assert.equal(managed.status, 200);
  assert.equal((await managed.json()).revoked, true);

  const gone = await worker.fetch(new Request(data.url), env, { waitUntil() {} });
  assert.equal(gone.status, 404);
});
