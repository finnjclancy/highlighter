# Chrome Web Store listing - Highlight

Prepared: 2026-08-22

## Upload package

Upload this ZIP:

`dist/highlighter-1.9.0.zip`

## Product details

Name:

`Highlight`

Short description:

`Highlight web pages and PDFs manually, with AI, or securely paired agents. Organise quotes, add comments, and share live links.`

Category:

`Productivity`

Language:

`English`

Detailed description:

```text
Highlight any page. Share what you read.

Highlight is a clean browser extension for saving useful passages from articles, docs, research pages, PDFs, and reference material. Select text on any web page, choose a colour, and Highlight saves it so you can find it again later.

Key features:

- Highlight selected text on any web page with a custom colour palette
- Re-colour or remove highlights without leaving the page
- Add comments and folders so quotes stay organized
- Browse every saved quote in one searchable library
- Filter by folder, source site, or search term
- Select a precise set of Library highlights, open a prepared instruction in ChatGPT web, or copy it for a browser agent
- Export selected highlights as plain text or Markdown
- Draw on pages with pen, line, and rectangle tools
- Highlight selectable PDFs manually, use optional AI-assisted Deep Highlight after reviewing its disclosure, or ask a connected agent to read the open PDF and create exact annotated highlights
- Create share links for a page's highlights
- Securely pair ChatGPT or another OAuth-capable MCP agent with a one-time code—your private browser token never goes into the chat client
- Use 24 focused MCP tools to read PDFs open in Highlight, retrieve an exact staged Library selection, search the full library, create or reorganize folders, make reversible edits, compare sources, export research, and create or manage protected live links
- Highlight the current browser selection from the context menu or a keyboard shortcut
- Let recipients read shared highlights in a clean gallery, or reopen them on the original page with Highlight installed
- Customize highlight colours in Design Studio

Highlight is local-first: your highlights, drawings, folders, comments, palette, and share history are stored in your browser by default. There are no accounts, no ads, and no tracking. Data leaves your browser only when you explicitly use optional AI or agent features, copy/export content, create a share link, or post a comment on a shared link. Highlight can prepare a Library instruction in ChatGPT web, but it never reads your conversation or presses Send.

Good for research, studying, writing, product work, collecting quotes, reviewing long articles, and sending source-backed notes to other people.
```

## Graphic assets

Store icon:

`store-listing/assets/icon-128.png`

Upload these five screenshots in this order:

1. `store-listing/assets/screenshot-1-highlighting.png`
2. `store-listing/assets/screenshot-2-page-panel.png`
3. `store-listing/assets/screenshot-3-drawing-tools.png`
4. `store-listing/assets/screenshot-4-library.png`
5. `store-listing/assets/screenshot-5-design-studio.png`

Alternate screenshot, do not upload unless you replace one of the five above:

`store-listing/assets/screenshot-6-share-gallery.png`

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
Highlight lets users highlight selected text, draw on pages, organize saved quotes, export notes, and create share links for content they explicitly choose.
```

Recommended data disclosure:

- Website content: Yes. User-created or agent-requested highlights, selected text, notes/comments, folders/tags, drawings, highlight colours, and shared-link comments.
- Web history: Yes, conservatively. Highlight stores source page URLs and titles only for pages where the user creates highlights, drawings, exports, or share links.
- Personally identifiable information: Conservatively, Yes. Highlight has no accounts and does not collect profile data, but a viewer can deliberately submit an optional author name with a shared-gallery comment.
- Authentication information: Conservatively, Yes. A randomly generated private MCP connection token and live-link management credentials are stored locally. Public agent pairing uses a one-time code and OAuth session records tied only to a hash-derived browser identifier. Optional gallery passwords are sent over HTTPS and stored by the service only as cryptographic hashes.
- User activity: No analytics, tracking, browsing activity monitoring, ad measurement, or background profiling.

Data use:

```text
Data is used only to provide Highlight's core functionality: saving highlights/drawings, organizing and exporting quotes, customizing colours, staging user-selected Library items for a chat, optionally applying, searching, updating, restoring, summarizing, or comparing highlights through a user-connected agent, and creating, managing, or displaying share links requested by the user. Data is not sold, used for advertising, used for credit-worthiness, or transferred for unrelated purposes.
```

Remote storage:

```text
Most data is stored locally in the user's browser. When a user or their connected agent creates a share link, the selected highlights for that page are sent over HTTPS to Highlight's share service and stored for the selected expiry period of 1–365 days. Optional gallery passwords and management credentials are stored only as cryptographic hashes by the service. Viewer comments, reactions, optional author names, and related highlight IDs are stored with the share until it expires. If the user enables the optional agent connection, active-page details, exact highlight requests, saved highlighted text, library searches, exports, snapshots, and requested changes are relayed through the Highlight Worker in memory and are not intentionally stored by the agent bridge. Public pairing codes expire after 10 minutes, authorization codes after 5 minutes, access tokens after 1 hour, and OAuth refresh sessions after 30 days. The service never stores the raw private browser token during public pairing.
```

Permission justifications:

- `storage`: Saves highlights, drawings, folders, comments, colour palette, and share history in the user's browser.
- `activeTab`: Reads the active tab URL/title after the user opens the extension, so Highlight can show page counts and copy/share highlights for the current page.
- `clipboardWrite`: Copies exported text, Markdown, share links, and staged Library instructions when the user chooses those actions.
- `alarms`: Restores the optional live agent connection after Chrome restarts or suspends the extension service worker.
- `contextMenus`: Adds right-click actions for highlighting selected text, choosing a colour, and opening tag/note editing.
- Host permission `<all_urls>`: Lets Highlight apply and restore highlights and drawings on any web page the user chooses to use it on. On `chatgpt.com`, it also lets Highlight append a prepared Library instruction only after the user presses **Open in ChatGPT web**; it never reads the conversation or presses Send.

## Reviewer test instructions

1. Install the submitted ZIP and open any ordinary HTTPS article.
2. Select text and choose a colour from the Highlight toolbar. Open the extension popup and choose **Open library / design** to verify the saved quote.
3. In the Library, select one or more rows. **Copy for browser agent** stages their local IDs and copies a short instruction. **Open in ChatGPT web** opens or focuses `chatgpt.com` and fills the composer without sending; a ChatGPT account is needed only to test that optional destination.
4. To test the optional MCP bridge, add `https://highlighter-share.finnjclancy.workers.dev/mcp` as a Streamable HTTP MCP server in an OAuth-capable client. When its authorization page opens, press **? → Pair ChatGPT** in the extension, paste the generated one-time code, and approve the connection. The code expires after 10 minutes and works once. The connection exposes 24 tools; the private browser token remains local.
5. Open a selectable PDF in Highlight's PDF Reader. **Copy for ChatGPT extension** copies an MCP instruction while keeping the PDF active; open the ChatGPT browser extension and paste it into a chat with Highlight enabled. **Open ChatGPT web** is the separate web-tab option. The agent can call `get_pdf_document` to read page-numbered text and use `highlight_passages` to create exact marks. Highlight never presses Send.
6. PDF Deep Highlight is optional and requires accepting the in-product disclosure. All manual highlighting, Library, drawing, export, agent, and ordinary share-link features can be tested without accepting the Gemini disclosure.

## Final pre-submit checks

- Publish the updated `docs/privacy.html` and `docs/index.html` before submitting, so the live privacy URL matches the extension's current share-link behaviour.
- Confirm the uploaded ZIP is the rebuilt `dist/highlighter-1.8.0.zip`.
- Upload no more than five screenshots.
- Mature content: `No`, unless future user-facing content changes require it.
- Region distribution: use all regions unless you have a specific launch restriction.
