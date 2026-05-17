# Highlighter share Worker

A Cloudflare Worker that serves the share gallery with **per-link Open Graph meta tags**, so messaging apps like iMessage, Slack, WhatsApp, and email clients show the custom name you set when sharing — instead of the generic "Shared highlights — Highlighter" preview.

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

### 3. Deploy

```bash
cd worker
wrangler deploy
```

You'll see something like:

```
Deployed highlighter-share triggers (0.30 sec)
  https://highlighter-share.<your-account>.workers.dev
```

That's your Worker URL. Copy it.

### 4. Point the extension at the Worker

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

## Costs

Free tier: 100,000 requests/day, 10ms CPU per request. The Worker uses ~1ms per request, so even ~100k shares/day fits comfortably in free.
