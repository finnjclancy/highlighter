# Highlighter

A clean browser extension for highlighting text on any web page with custom colours, organising quotes into folders, and sharing live links.

> Highlight any page. Share what you read.

**Live site:** [finnjclancy.github.io/highlighter](https://finnjclancy.github.io/highlighter/)

---

## Features

- **Custom palette** — each swatch has its own text and background colour. Hover a highlight to re-colour or remove it instantly.
- **Folders, tags, comments** — organise quotes the way you think. Free-form notes per highlight, batch-select and export selections as plain text or Markdown.
- **Floating overlay** — a tiny burger in the bottom-left lists every highlight on the current page; click any to flash + scroll to it.
- **Draw on the page** — pen, line, and rectangle tools for marking up diagrams, screenshots, or PDFs in-place.
- **Library** — single dashboard for every highlight across every site. Filter by folder, site, or search.
- **Design Studio** — drag-and-drop palette editor with presets, live preview, and per-swatch text/background pickers.
- **Sharing** — generate a single link that works two ways: viewers without the extension see a clean reader-style gallery; viewers with the extension can jump straight to the source page with your highlights painted on it.
- **Privacy-first** — no accounts and no tracking. Highlights live in your own browser storage unless you explicitly copy them or create a share link.

---

## Install

### From source (for development)

1. `git clone https://github.com/finnjclancy/highlighter && cd highlighter`
2. Open `chrome://extensions` in Chrome / Edge / Brave / Arc.
3. Toggle **Developer mode** (top right).
4. Click **Load unpacked** → select the cloned folder.
5. Pin the extension from the puzzle-piece menu so it's always one click away.

### From the Chrome Web Store

_(Pending submission — link will go here when published.)_

---

## How it works

### Highlight
Select text on any page → a mini toolbar appears with your colour palette → click a swatch.

### Re-colour or remove
Hover any highlight → palette + × buttons appear above it. Or click the highlight for the full popover.

### Library
Toolbar icon → **Open library / design**. Folders (tags), sites, search, sort, multi-select, export, bulk delete.

### Share
Toolbar icon → **🔗 Share live link**. Copies a URL like:

```
https://finnjclancy.github.io/highlighter/v.html?d=zH4sI…
```

The payload is your highlights, gzipped + base64url-encoded. Highlighter tries to create a short link through the share worker; if that is unavailable, it falls back to a long URL with the payload embedded. Recipients without the extension get a clean gallery of the quotes. Recipients with the extension can click **Open on original page →** to see them painted onto the live article.

### Draw
Toolbar icon → **✎ Draw on page**. Pen / line / rectangle tools with palette, three stroke widths, undo, and clear.

### Copy text
Toolbar icon → **📋 Copy text**. Drops every highlight on the current page onto your clipboard as plain text (title, URL, then each quote on its own line with optional tags/comment).

---

## Repo layout

```
/                  extension source (manifest.json + scripts/styles)
  background.js    service worker — onInstalled, default palette, message routing
  content.js       in-page logic — selection toolbar, hover/click controls, overlay
  drawing.js/css   drawing canvas + toolbar
  library.html/js  full-page library dashboard + design studio (tabs)
  popup.html/js    toolbar popup
  welcome.html/js  one-time onboarding shown on install
  icons/           extension icons + store promo tile

docs/              GitHub Pages site (gallery viewer + landing + privacy)
  index.html       landing page
  v.html / v.js    shared-highlights gallery viewer (decodes ?d=<payload>)
  privacy.html     privacy policy
  styles.css       shared site styles

scripts/
  make_icons.py    regenerate icon PNGs and the store promo tile
  package.sh       build a Chrome Web Store-ready .zip → dist/highlighter-<v>.zip
```

---

## Building a release

```bash
./scripts/package.sh
```

Produces `dist/highlighter-<version>.zip` containing only the files that ship in the Web Store package. Bump `manifest.json`'s `version` before each new submission.

To regenerate icons or the promo tile, edit `scripts/make_icons.py` then re-run it.

---

## Privacy

Highlights, drawings, and share history live in the user's `chrome.storage.local`; palette settings use Chrome sync storage when available. The extension has no analytics or third-party scripts. Data leaves the device only when the user copies/export highlights, creates a share link, or posts a comment on a shared link.

Full policy: [finnjclancy.github.io/highlighter/privacy.html](https://finnjclancy.github.io/highlighter/privacy.html)

---

## Licence

MIT.
