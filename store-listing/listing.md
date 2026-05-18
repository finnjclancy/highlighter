# Chrome Web Store listing - Highlighter

Prepared: 2026-05-18

## Upload package

Upload this ZIP:

`dist/highlighter-1.0.1.zip`

## Product details

Name:

`Highlighter`

Short description:

`Highlight any web page in custom colours. Organise quotes into folders, add comments, and share live links.`

Category:

`Productivity`

Language:

`English`

Detailed description:

```text
Highlight any page. Share what you read.

Highlighter is a clean browser extension for saving useful passages from articles, docs, research pages, PDFs, and reference material. Select text on any web page, choose a colour, and Highlighter saves it so you can find it again later.

Key features:

- Highlight selected text on any web page with a custom colour palette
- Re-colour or remove highlights without leaving the page
- Add comments and folders so quotes stay organized
- Browse every saved quote in one searchable library
- Filter by folder, source site, or search term
- Export selected highlights as plain text or Markdown
- Draw on pages with pen, line, and rectangle tools
- Create share links for a page's highlights
- Let recipients read shared highlights in a clean gallery, or reopen them on the original page with Highlighter installed
- Customize highlight colours in Design Studio

Highlighter is local-first: your highlights, drawings, folders, comments, palette, and share history are stored in your browser by default. There are no accounts, no ads, and no tracking. Data leaves your browser only when you explicitly copy/export it, create a share link, or post a comment on a shared link.

Good for research, studying, writing, product work, collecting quotes, reviewing long articles, and sending source-backed notes to other people.
```

## Graphic assets

Store icon:

`store-listing/assets/icon-128.png`

Upload these five screenshots in this order:

1. `store-listing/assets/screenshot-1-highlighting.png`
2. `store-listing/assets/screenshot-3-drawing-tools.png`
3. `store-listing/assets/screenshot-4-library.png`
4. `store-listing/assets/screenshot-5-design-studio.png`
5. `store-listing/assets/screenshot-6-share-gallery.png`

Alternate screenshot, do not upload unless you replace one of the five above:

`store-listing/assets/screenshot-2-page-panel.png`

Small promo tile:

`store-listing/assets/promo-small-440x280.png`

Marquee promo tile:

`store-listing/assets/promo-marquee-1400x560.png`

Do not upload:

`store-listing/assets/contact-sheet.png`

## URLs

Homepage URL:

`https://finnjclancy.github.io/highlighter/`

Privacy policy URL:

`https://finnjclancy.github.io/highlighter/privacy.html`

Support URL:

`https://github.com/finnjclancy/highlighter/issues`

Official URL:

Use `https://finnjclancy.github.io/highlighter/` only if the domain/site is verified in the Chrome Web Store developer account. Otherwise leave this blank.

## Privacy practices

Single purpose:

```text
Highlighter lets users highlight selected text, draw on pages, organize saved quotes, export notes, and create share links for content they explicitly choose.
```

Recommended data disclosure:

- Website content: Yes. User-created highlights, selected text, notes/comments, folders/tags, drawings, highlight colours, and shared-link comments.
- Web history: Yes, conservatively. Highlighter stores source page URLs and titles only for pages where the user creates highlights, drawings, exports, or share links.
- Personally identifiable information: No account/profile data is collected by the extension. If the dashboard treats optional share-gallery author names as PII, disclose that optional author name can be submitted by viewers when they post comments on shared links.
- User activity: No analytics, tracking, browsing activity monitoring, ad measurement, or background profiling.

Data use:

```text
Data is used only to provide Highlighter's core functionality: saving highlights/drawings, organizing and exporting quotes, customizing colours, and creating or displaying share links requested by the user. Data is not sold, used for advertising, used for credit-worthiness, or transferred for unrelated purposes.
```

Remote storage:

```text
Most data is stored locally in the user's browser. When a user creates a share link, the selected highlights for that page are sent over HTTPS to Highlighter's share service and stored for about one year so the link can work. Viewer comments on shared links are also stored with the share for about one year.
```

Permission justifications:

- `storage`: Saves highlights, drawings, folders, comments, colour palette, and share history in the user's browser.
- `activeTab`: Reads the active tab URL/title after the user opens the extension, so Highlighter can show page counts and copy/share highlights for the current page.
- `clipboardWrite`: Copies exported text, Markdown, and share links to the clipboard when the user chooses those actions.
- Host permission `<all_urls>`: Lets Highlighter apply and restore highlights and drawings on any web page the user chooses to use it on.

## Final pre-submit checks

- Publish the updated `docs/privacy.html` and `docs/index.html` before submitting, so the live privacy URL matches the extension's current share-link behaviour.
- Confirm the uploaded ZIP is the rebuilt `dist/highlighter-1.0.1.zip`.
- Upload no more than five screenshots.
- Mature content: `No`, unless future user-facing content changes require it.
- Region distribution: use all regions unless you have a specific launch restriction.
