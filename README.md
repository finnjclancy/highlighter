# Highlighter

A clean browser extension for highlighting text on any web page with custom colours, organising quotes into folders, and sharing live links.

> Highlight any page. Share what you read.

**Live site:** [finnjclancy.github.io/highlighter](https://finnjclancy.github.io/highlighter/)

---

## Features

- **Custom palette** — each swatch has its own text and background colour. Hover a highlight to re-colour or remove it instantly.
- **Folders, tags, comments** — organise quotes the way you think. Free-form notes per highlight, batch-select and export selections as plain text or Markdown.
- **Floating overlay** — a tiny burger in the bottom-left lists every highlight on the current page; click any to flash + scroll to it.
- **PDF reader** — open browser PDFs in Highlighter's own selectable reader, then highlight and organise them with the same palette and library as web pages.
- **Draw on the page** — pen, line, and rectangle tools for marking up diagrams, screenshots, or PDFs in-place.
- **Library** — single dashboard for every highlight across every site. Filter by folder, site, or search.
- **Design Studio** — drag-and-drop palette editor with presets, live preview, and per-swatch text/background pickers.
- **Sharing** — generate a single link that works two ways: viewers without the extension see a clean reader-style gallery; viewers with the extension can jump straight to the source page with your highlights painted on it.
- **Bulk management** — select several or all highlights directly in the page/PDF panel, or delete every highlight in the current filtered Library view, with confirmation before removal.
- **Agent research workspace** — select highlights in the Library and add that exact set to a chat, then let ChatGPT or another MCP-compatible agent create, move, rename, merge, or remove folders; search and organize the full library; update or restore highlights; compare sources; export research; and manage collaborative live galleries.
- **Fast actions** — highlight the current selection from the page context menu or with `Alt+Shift+H` (`⌃⇧H` on macOS).
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

**[chromewebstore.google.com/detail/highlighter/hkldppfkemipnahfagbgbombdhcoogeo](https://chromewebstore.google.com/detail/highlighter/hkldppfkemipnahfagbgbombdhcoogeo)** — one-click install for Chrome / Edge / Brave / Arc.

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

### PDFs
Open a PDF in the browser → click the Highlighter toolbar icon. The document opens immediately in an extension-owned PDF.js reader so selections, saved highlights, comments, and the page overlay work normally. The original PDF URL remains the document identity in the library. Shared PDF links hand off to this reader automatically when Highlighter is installed.

### AI highlights
In the PDF reader, click **✦ Deep highlight** to run a high-thinking reading process with no highlight quota. Without a custom instruction, Gemini examines the paper section by section for materially important candidates and performs a second editorial pass to remove redundancy. With a custom instruction, Highlighter follows it directly: literal requests such as “highlight every sentence containing *world model*” are matched exhaustively, while broader semantic instructions are evaluated independently across chunks of the paper so matches are not lost in one global summary. The passages fade in, are saved as ordinary editable highlights, and are included in live share links. Turn on **Auto** to run this once whenever a new PDF opens using the saved instruction.

The first use shows a disclosure and requires consent. Extracted PDF text and any reader instruction are sent over HTTPS to the Highlighter Worker. Exact keyword/phrase requests are matched in the Worker; semantic requests are forwarded to Google's Gemini API. The API key remains a Worker secret, and source PDF text is not stored by Highlighter. Repeated requests with the same document, instruction, model, and prompt version can reuse a 30-day cache of selected span IDs and reasons.

### Agent connection
Toolbar icon → press the **?** beside the agent connection for the built-in setup guide. The short version:

1. Press **Copy private MCP link** in Highlighter.
2. In ChatGPT, open **Settings → Security and login** and enable **Developer mode**.
3. Open [ChatGPT Plugins](https://chatgpt.com/plugins), press **+**, and name the connection **Highlighter**.
4. Choose the public URL / Streamable HTTP connection, paste the complete private MCP URL, create the connection, and review the discovered tools.

Treat the copied URL like a password. Press the connected-agent row to copy it again, or use × to disconnect and discard the local token. Developer mode availability can depend on the ChatGPT account and workspace policy; see the [official OpenAI setup guide](https://developers.openai.com/plugins/deploy/connect-chatgpt) for current details.

The connection exposes 23 focused tools. Alongside active-page reading, exact highlighting, quote retrieval, reversible removal, and live-link creation, an agent can load the exact highlights staged from the Library, inspect and reorganize folders, update notes/tags/colours, search the entire local library, list highlighted pages, undo operations, highlight the current browser selection, export Markdown/JSON/CSV/BibTeX/RIS, prepare source-linked summaries and cross-page comparisons, add page notes, capture snapshots, manage or revoke protected live links, collaborate with attributed comments/reactions, retrieve surrounding context, and open a saved passage in Chrome.

Every highlight mutation returns an operation ID and can be reversed. Summary and comparison tools return only your marked passages and source links; the connected model performs the synthesis. Live links can be unlisted or password-protected, can expire from 1–365 days, and receive a local-only management credential so the agent can refresh or revoke links without exposing that credential in chat.

### Copy text
Toolbar icon → **📋 Copy text**. Drops every highlight on the current page onto your clipboard as plain text (title, URL, then each quote on its own line with optional tags/comment).

---

## Repo layout

```
/                  extension source (manifest.json + scripts/styles)
  background.js    service worker — onInstalled, default palette, message routing
  content.js       in-page logic — selection toolbar, hover/click controls, overlay
  pdf-reader.*     PDF.js reader — renders selectable PDF text for highlighting
  drawing.js/css   drawing canvas + toolbar
  library.html/js  full-page library dashboard + design studio (tabs)
  popup.html/js    toolbar popup
  welcome.html/js  one-time onboarding shown on install
  icons/           extension icons + store promo tile
  vendor/          bundled PDF.js runtime and licence

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

Highlights, drawings, AI consent/preferences, agent-connection settings, and share history live in the user's `chrome.storage.local`; palette settings use Chrome sync storage when available. The extension has no analytics or third-party scripts. Data leaves the device only when the user invokes AI highlights, enables an agent connection, copies/exports highlights, creates a share link, or posts a comment on a shared link.

Full policy: [finnjclancy.github.io/highlighter/privacy.html](https://finnjclancy.github.io/highlighter/privacy.html)

---

## Licence

MIT.
