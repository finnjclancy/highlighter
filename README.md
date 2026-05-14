# Highlighter

A browser extension for highlighting text on any web page with custom colors, plus a library to organize, tag, and annotate your highlights.

## Features

- Select text → floating toolbar with your custom color palette (text + background per swatch)
- Highlights are saved per-URL and restored when you revisit
- Floating side panel on every page (works in fullscreen): collapse/expand button stays top-left
- **Library** (full page, opens from the extension icon): every highlight from every page, with tags, comments, search, and filters by tag/color/site
- **Design Studio** (options page): drag-to-reorder color cards, live preview, presets, hex/picker inputs
- Highlight styling can never change the host page's font size, weight, or family (forced inheritance)
- Deep links: `#hl=<id>` scrolls to a specific highlight on page load

## Install (Chrome / Edge / Brave)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this folder

## Usage

- Click the toolbar icon → **Open Library** to manage everything
- Select text on any page → click a color to highlight
- Side panel: click a highlight to scroll-and-flash to it; click × to delete
- Library cards: add tags (enter to confirm), type notes (auto-saved), delete, jump to the source URL
- Design Studio: pick a preset, or click + to add a swatch; drag cards to reorder

## Files

- `manifest.json`, `background.js`
- `content.js` / `content.css` — selection toolbar, highlight rendering, floating panel
- `popup.html` / `popup.js` — toolbar popup (stats + entry points)
- `library.html` / `library.js` — full-page highlight library with tags, notes, filters
- `options.html` / `options.js` — Design Studio (palette editor)
