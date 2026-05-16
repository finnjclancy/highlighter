# Highlighter web (the "gallery" companion site)

This folder is the public-facing site for the Highlighter extension. Deployed via GitHub Pages straight from `main` → `/docs`.

- `index.html` — landing page (what the extension is, link to GitHub)
- `v.html` + `v.js` — the **gallery viewer**: opens shared `?d=<payload>` links and renders highlights as a clean card list with a "Open on original page" button that triggers the live extension overlay for users who have it installed.
- `styles.css` — shared design tokens, mirrors the extension's UI.

## Enabling GitHub Pages

Repo → Settings → Pages:

- Source: **Deploy from a branch**
- Branch: **main** · folder: **/docs**
- Save.

The site goes live at `https://<owner>.github.io/highlighter/` within ~60 seconds. Custom domain optional via the same Pages settings.

## How the share URL works

When the extension's popup → "Share live link" is clicked, it builds a payload:

```json
{ "v": 3, "url": "<source>", "title": "<page title>",
  "highlights": [{ "id", "bg", "fg", "text", "note", "tags",
                   "r": { "sx", "so", "ex", "eo" },  // XPath range
                   "p": "...prefix...", "s": "...suffix..." }] }
```

It's base64url-encoded into `?d=` on the gallery URL. The gallery page decodes and renders. The "Open on original page" button forwards the same encoded payload to the source URL as `?hlshare=` — the extension picks that up and applies highlights to the real page.

So one link covers both audiences:

- **With the extension**: the source URL works directly (or via the gallery's "Open on original page" button).
- **Without the extension**: the gallery is the destination — they still see the quotes, comments, tags, and a link to the source.
