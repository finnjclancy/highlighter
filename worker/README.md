# Highlighter share, AI, and agent Worker

A Cloudflare Worker that serves the share gallery with **per-link Open Graph meta tags**, keeps the Gemini API key used by PDF AI highlighting out of the browser extension, and exposes an authenticated MCP bridge for agent-created highlights.

## Why this exists

Link-preview scrapers fetch the static HTML and never run JavaScript. So updating the page `<title>` client-side (as the GitHub Pages gallery does) only affects the browser tab — preview cards stay generic.

This Worker decodes the gzipped payload from `?d=…`, extracts the share name, title, source, and count, and serves HTML with the right meta tags **before** any JavaScript runs. The body still loads the existing `v.js` from GitHub Pages so the rendered gallery is identical.

## Deploy in 3 steps

### 1. Sign up for Cloudflare Workers (free)

https://dash.cloudflare.com/sign-up — free tier covers 100,000 requests/day.

### 2. Install Wrangler and log in

```bash
npm install -g wrangler
wrangler login          # opens browser to authorize
```

### 3. Add the free Gemini API key

Create a key in Google AI Studio, then store it as an encrypted Worker secret:

```bash
cd worker
npx wrangler secret put GEMINI_API_KEY
```

Paste the key when Wrangler prompts. Do not put the key in `wrangler.toml`, the extension source, or a committed `.dev.vars` file.

The Worker defaults to `gemini-3.5-flash-lite`. To override it, add a `GEMINI_MODEL` Worker variable in Cloudflare.

### 4. Deploy

```bash
cd worker
npm run deploy
```

You'll see something like:

```
Deployed highlighter-share triggers (0.30 sec)
  https://highlighter-share.<your-account>.workers.dev
```

That's your Worker URL. Copy it.

### 5. Point the extension at the Worker

Edit `popup.js` in the repo root:

```diff
-const GALLERY_BASE = "https://finnjclancy.github.io/highlighter/v.html";
+const GALLERY_BASE = "https://highlighter-share.<your-account>.workers.dev/v";
```

Rebuild and reload the extension:

```bash
./scripts/package.sh
```

Any new share link will now go through the Worker. Link previews in iMessage/Slack/etc. will use the custom name you set when sharing.

## Custom domain (optional)

If you'd rather use e.g. `share.yourdomain.com` instead of `*.workers.dev`:

1. Add the domain to your Cloudflare account (free).
2. Cloudflare dashboard → Workers & Pages → your Worker → **Triggers** → **Add Custom Domain**.

Then update `GALLERY_BASE` accordingly.

## Testing locally

```bash
cd worker
wrangler dev
```

Serves on `http://localhost:8787`. Open `http://localhost:8787/v?d=<payload>` to test.

## AI endpoint

`POST /api/ai/highlights` accepts validated PDF text spans and an optional reader instruction. With no instruction, Gemini runs with high thinking in two passes: section-aware candidate discovery followed by a global editorial necessity check. With an instruction, the Worker first identifies whether it requires literal/exhaustive matching or semantic selection. Literal keyword and phrase requests are matched deterministically across the extracted text; semantic instructions are applied independently to roughly 42,000-character chunks with high thinking and merged without a generic editorial pass. The Worker never requests a target highlight count. Results are cached in Workers KV for 30 days by document, instruction, model, thinking level, and prompt version; the extracted source text itself is not stored by Highlighter.

The Gemini free tier may use submitted content to improve Google's products. The extension presents this disclosure before the first request and saves the user's consent locally.

## Agent MCP endpoint

`/mcp?token=<private-token>` exposes 24 stateless Streamable HTTP tools spanning active-page state, page-ranged text extraction from PDFs open in Highlighter's reader, exact and selection-based highlighting, staged Library selections, folder listing and reversible organisation, cross-library search, page listing, reversible update/remove/restore operations, page notes, context snapshots, Markdown/JSON/CSV/BibTeX/RIS export, summary and comparison source bundles, managed live links, gallery collaboration, context retrieval, and opening a saved passage. The same locally generated token authenticates the extension's WebSocket at `/api/agent/socket`. A per-token `AgentBridge` Durable Object relays each tool call to the paired Chrome extension and returns its immediate result; PDF text, page text, library data, and created highlights are not stored by the bridge.

`POST /api/shorten` now returns a one-time management token whose hash is stored as `m:<shareId>` in KV. `POST /api/share/manage` uses that token to refresh, change expiry/visibility/password, collaborate, or revoke. Optional gallery passwords are SHA-256 hashed, and protected gallery/discussion requests require an HttpOnly access cookie. Comments use `/api/c/<id>` and reactions use `/api/r/<id>`.

Deploy the Worker before testing this feature because the extension connects to `https://highlighter-share.finnjclancy.workers.dev`. In the Highlighter popup, choose **Connect agent & copy link**, then add the copied private MCP URL to an MCP client. Disconnecting closes the socket and removes the local token.

## Costs

Cloudflare's free Worker/KV allowances cover modest personal use. Gemini's free API tier has separate project rate and daily limits; when that quota is exhausted the extension shows a retry-later message.
