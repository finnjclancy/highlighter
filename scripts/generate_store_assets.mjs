import { createServer } from "node:http";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_DIR = join(ROOT, "store-listing", "assets");
const PROFILE_DIR = join(ROOT, "output", "playwright", "highlighter-store-profile");
const EXTENSION_DIR = ROOT;
const CHROME = process.env.CHROME_EXECUTABLE || chromium.executablePath();

const palette = [
  { name: "Yellow", bg: "#fff59d", fg: "#1a1a1a" },
  { name: "Green", bg: "#b9f6ca", fg: "#0b3d1a" },
  { name: "Pink", bg: "#f8bbd0", fg: "#4a0028" },
  { name: "Blue", bg: "#b3e5fc", fg: "#0b2a3d" },
  { name: "Orange", bg: "#ffcc80", fg: "#3d1f00" },
  { name: "Purple", bg: "#d1c4e9", fg: "#1c0b3d" },
  { name: "Red", bg: "#ffab91", fg: "#3d0b00" },
  { name: "Dark", bg: "#263238", fg: "#ffffff" }
];

const now = Date.UTC(2026, 4, 18, 10, 30, 0);

function htmlPage(body) {
  return `<!doctype html><html lang="en">${body}</html>`;
}

function demoArticle() {
  return htmlPage(`
<head>
  <meta charset="utf-8">
  <title>Field Notes: Reading the Web With Better Memory</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #f4f0e8;
      color: #171717;
      font: 17px/1.68 Georgia, "Times New Roman", serif;
    }
    .shell {
      width: 100%;
      min-height: 100vh;
      display: grid;
      grid-template-columns: 220px minmax(0, 760px) 1fr;
      gap: 46px;
      padding: 48px 56px 96px;
    }
    aside {
      padding-top: 72px;
      color: #73706a;
      font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    aside div { padding: 11px 0; border-bottom: 1px solid rgba(23,23,23,0.12); }
    article {
      background: #fffaf0;
      border: 1px solid rgba(23,23,23,0.1);
      box-shadow: 0 18px 80px rgba(20,18,14,0.1);
      padding: 56px 64px 72px;
    }
    .kicker {
      font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: #8b5e34;
      font-weight: 700;
      margin-bottom: 14px;
    }
    h1 {
      font: 700 52px/0.98 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: -0.05em;
      margin: 0 0 18px;
    }
    .dek {
      font: 20px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #5b5750;
      margin: 0 0 36px;
      max-width: 36rem;
    }
    h2 {
      font: 700 22px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: -0.02em;
      margin: 38px 0 12px;
    }
    p { margin: 0 0 20px; }
    blockquote {
      margin: 30px 0;
      padding: 0 0 0 22px;
      border-left: 4px solid #171717;
      font-size: 22px;
      line-height: 1.5;
      color: #28251f;
    }
    .figure {
      margin: 28px 0 32px;
      border-radius: 8px;
      background: #18181b;
      color: #fafafa;
      padding: 26px;
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .bars { display: flex; align-items: end; gap: 10px; height: 142px; margin-top: 18px; }
    .bar { flex: 1; border-radius: 6px 6px 2px 2px; background: linear-gradient(180deg, #b9f6ca, #6366f1); }
    .right-note {
      padding-top: 142px;
      color: #6d675e;
      font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      max-width: 260px;
    }
  </style>
</head>
<body>
  <div class="shell">
    <aside>
      <div>Research</div>
      <div>Marginalia</div>
      <div>Source notes</div>
      <div>Export-ready</div>
    </aside>
    <article>
      <div class="kicker">Workflow notes</div>
      <h1>Reading the web with better memory</h1>
      <p class="dek">A short field guide for collecting useful passages without breaking your focus.</p>
      <p>Modern reading happens across tabs, articles, PDFs, issue threads, and docs. The useful part is rarely the whole page. It is the small section that changes what you think next.</p>
      <p><span id="phrase-one">A good annotation tool should stay out of the way while you read, then make the important passages easy to find again.</span> That means the capture step has to be fast, and the review step has to be structured.</p>
      <h2>Capture first, organize later</h2>
      <p>The most reliable workflow is simple: mark the sentence while the thought is fresh, then add context when you return to the library. <span id="phrase-two">Folders, comments, and export formats matter most after the reading session, when the notes become material for writing or decisions.</span></p>
      <blockquote><span id="phrase-three">The best saved quote is not just visible. It is portable, searchable, and still connected to the page where it came from.</span></blockquote>
      <div class="figure">
        Highlight density by reading phase
        <div class="bars">
          <div class="bar" style="height:42%"></div>
          <div class="bar" style="height:66%"></div>
          <div class="bar" style="height:88%"></div>
          <div class="bar" style="height:58%"></div>
          <div class="bar" style="height:74%"></div>
        </div>
      </div>
      <p>When highlights can be shared, the quote becomes a lightweight handoff. Teammates can scan the extracted passages first, then open the original page only when they need the surrounding detail.</p>
    </article>
    <div class="right-note">
      Highlighter adds a small palette on text selection, a page overlay for saved quotes, and a library for every source you have marked.
    </div>
  </div>
</body>`);
}

function promoPage(kind) {
  const isMarquee = kind === "marquee";
  const titleSize = isMarquee ? 74 : 31;
  const subSize = isMarquee ? 29 : 14;
  const iconSize = isMarquee ? 238 : 118;
  const featureSize = isMarquee ? 20 : 11;
  return htmlPage(`
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      overflow: hidden;
      background:
        radial-gradient(circle at 86% 28%, rgba(34, 197, 94, 0.55), transparent 28%),
        radial-gradient(circle at 68% 78%, rgba(236, 72, 153, 0.72), transparent 32%),
        linear-gradient(135deg, #0c0c0e 0%, #18181b 42%, #312e81 100%);
      color: #fafafa;
      font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
    }
    .wrap {
      width: 100vw;
      height: 100vh;
      display: grid;
      grid-template-columns: ${isMarquee ? "360px 1fr" : "154px 1fr"};
      align-items: center;
      gap: ${isMarquee ? "46px" : "22px"};
      padding: ${isMarquee ? "64px 92px" : "34px 38px"};
    }
    .icon {
      width: ${iconSize}px;
      height: ${iconSize}px;
      border-radius: ${isMarquee ? "52px" : "28px"};
      background: linear-gradient(135deg, #6366f1, #ec4899);
      box-shadow: 0 26px 80px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255,255,255,0.24);
      position: relative;
      display: grid;
      place-items: center;
    }
    .icon::before {
      content: "";
      width: 74%;
      height: 28%;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.95);
      transform: rotate(-32deg);
      box-shadow: 0 2px 10px rgba(0,0,0,0.16);
    }
    h1 {
      margin: 0 0 ${isMarquee ? "18px" : "9px"};
      font-size: ${titleSize}px;
      line-height: 0.95;
      letter-spacing: -0.055em;
    }
    p {
      margin: 0;
      color: rgba(250,250,250,0.78);
      font-size: ${subSize}px;
      line-height: 1.28;
      letter-spacing: -0.015em;
      max-width: ${isMarquee ? "620px" : "210px"};
    }
    .features {
      display: flex;
      gap: ${isMarquee ? "14px" : "6px"};
      margin-top: ${isMarquee ? "34px" : "16px"};
      flex-wrap: wrap;
    }
    .chip {
      border: 1px solid rgba(255,255,255,0.16);
      background: rgba(255,255,255,0.1);
      border-radius: 999px;
      padding: ${isMarquee ? "9px 15px" : "4px 8px"};
      color: rgba(250,250,250,0.88);
      font-size: ${featureSize}px;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="icon" aria-hidden="true"></div>
    <main>
      <h1>Highlighter</h1>
      <p>Highlight any web page in custom colours. Organise quotes, add comments, and share live links.</p>
      <div class="features">
        <span class="chip">Custom colours</span>
        <span class="chip">Folders</span>
        <span class="chip">Live links</span>
        <span class="chip">No tracking</span>
      </div>
    </main>
  </div>
</body>`);
}

function contentType(pathname) {
  const ext = extname(pathname).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

async function startServer() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    try {
      if (url.pathname === "/" || url.pathname === "/demo.html") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(demoArticle());
        return;
      }
      if (url.pathname === "/promo-small.html") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(promoPage("small"));
        return;
      }
      if (url.pathname === "/promo-marquee.html") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(promoPage("marquee"));
        return;
      }
      if (url.pathname.startsWith("/docs/")) {
        const file = join(ROOT, url.pathname.replace(/^\//, ""));
        const bytes = await readFile(file);
        res.writeHead(200, { "content-type": contentType(url.pathname) });
        res.end(bytes);
        return;
      }
      res.writeHead(404);
      res.end("not found");
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function waitForExtensionId(context) {
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) serviceWorker = await context.waitForEvent("serviceworker", { timeout: 15000 });
  const [, , extensionId] = serviceWorker.url().split("/");
  if (!extensionId) throw new Error(`Could not read extension id from ${serviceWorker.url()}`);
  return extensionId;
}

async function selectText(page, selector) {
  await page.locator(selector).evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const rect = range.getBoundingClientRect();
    const ev = new MouseEvent("mouseup", {
      bubbles: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    });
    document.dispatchEvent(ev);
  });
  await page.waitForSelector("#hl-toolbar", { timeout: 5000 });
}

async function highlight(page, selector, swatchIndex) {
  await selectText(page, selector);
  await page.locator("#hl-toolbar .hl-swatch").nth(swatchIndex).click({ force: true });
  await page.waitForTimeout(220);
}

function b64url(input) {
  return Buffer.from(input, "utf8").toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function pageKey(url) {
  const u = new URL(url);
  return `hl_page_${u.origin}${u.pathname}`;
}

function seedData(baseUrl) {
  const demoUrl = `${baseUrl}/demo.html`;
  const mk = (id, url, title, text, bg, fg, tags, note, offset = 0) => ({
    id,
    url,
    title,
    text,
    bg,
    fg,
    tags,
    note,
    createdAt: now - offset
  });

  return {
    local: {
      [pageKey(demoUrl)]: [
        mk("h_demo_1", demoUrl, "Field Notes: Reading the Web With Better Memory", "A good annotation tool should stay out of the way while you read, then make the important passages easy to find again.", "#fff59d", "#1a1a1a", ["Research", "Reading"], "Use this in the positioning copy.", 10_000),
        mk("h_demo_2", demoUrl, "Field Notes: Reading the Web With Better Memory", "Folders, comments, and export formats matter most after the reading session, when the notes become material for writing or decisions.", "#b9f6ca", "#0b3d1a", ["Workflow"], "Good screenshot candidate for the library.", 20_000),
        mk("h_demo_3", demoUrl, "Field Notes: Reading the Web With Better Memory", "The best saved quote is not just visible. It is portable, searchable, and still connected to the page where it came from.", "#b3e5fc", "#0b2a3d", ["Share"], "", 30_000)
      ],
      [pageKey("https://developer.chrome.com/docs/extensions/get-started")]: [
        mk("h_chrome_1", "https://developer.chrome.com/docs/extensions/get-started", "Chrome Extensions documentation", "Extensions are software programs built on web technologies that customize the browsing experience.", "#d1c4e9", "#1c0b3d", ["Chrome", "Reference"], "Useful definition for onboarding.", 50_000),
        mk("h_chrome_2", "https://developer.chrome.com/docs/extensions/get-started", "Chrome Extensions documentation", "The extension manifest is the only required file that must have a specific file name: manifest.json.", "#ffcc80", "#3d1f00", ["Chrome"], "", 70_000)
      ],
      [pageKey("https://example.com/research/report")]: [
        mk("h_report_1", "https://example.com/research/report", "Quarterly research report", "Participants preferred highlights that preserved the surrounding source context.", "#f8bbd0", "#4a0028", ["Research", "Product"], "Backs up the share-link flow.", 90_000),
        mk("h_report_2", "https://example.com/research/report", "Quarterly research report", "Exported notes were most useful when grouped by topic rather than by capture date.", "#b9f6ca", "#0b3d1a", ["Workflow", "Export"], "", 110_000),
        mk("h_report_3", "https://example.com/research/report", "Quarterly research report", "Teams used comments to add interpretation without changing the original quote.", "#fff59d", "#1a1a1a", ["Teams"], "Mention comments without overselling.", 130_000)
      ],
      [pageKey("https://news.example.com/deep-dive")]: [
        mk("h_news_1", "https://news.example.com/deep-dive", "How attention fragments across tabs", "The smallest useful unit of saved reading is often one sentence, not one bookmark.", "#ffab91", "#3d0b00", ["Reading"], "", 150_000),
        mk("h_news_2", "https://news.example.com/deep-dive", "How attention fragments across tabs", "A highlight that can be reopened in context carries more trust than a copied quote alone.", "#263238", "#ffffff", ["Share", "Trust"], "Nice closing line.", 170_000)
      ],
      hl_shares: [
        {
          id: "readweb26",
          name: "Reading workflow notes",
          url: "https://highlighter-share.finnjclancy.workers.dev/v/readweb26",
          shortened: true,
          sourceUrl: demoUrl,
          sourceTitle: "Field Notes: Reading the Web With Better Memory",
          count: 3,
          createdAt: now - 600_000
        },
        {
          id: "teamcopy",
          name: "Team research excerpts",
          url: "https://highlighter-share.finnjclancy.workers.dev/v/teamcopy",
          shortened: true,
          sourceUrl: "https://example.com/research/report",
          sourceTitle: "Quarterly research report",
          count: 3,
          createdAt: now - 1_800_000
        }
      ]
    },
    palette
  };
}

function sharePayload(baseUrl) {
  const url = `${baseUrl}/demo.html`;
  return {
    v: 3,
    url,
    title: "Field Notes: Reading the Web With Better Memory",
    name: "Reading workflow notes",
    highlights: [
      {
        id: "h_share_1",
        bg: "#fff59d",
        fg: "#1a1a1a",
        text: "A good annotation tool should stay out of the way while you read, then make the important passages easy to find again.",
        note: "This is the core promise.",
        tags: ["Research", "Reading"]
      },
      {
        id: "h_share_2",
        bg: "#b9f6ca",
        fg: "#0b3d1a",
        text: "Folders, comments, and export formats matter most after the reading session, when the notes become material for writing or decisions.",
        note: "Turns raw highlights into usable work.",
        tags: ["Workflow"]
      },
      {
        id: "h_share_3",
        bg: "#b3e5fc",
        fg: "#0b2a3d",
        text: "The best saved quote is not just visible. It is portable, searchable, and still connected to the page where it came from.",
        note: "",
        tags: ["Share"]
      }
    ]
  };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await rm(PROFILE_DIR, { recursive: true, force: true });
  await mkdir(PROFILE_DIR, { recursive: true });

  const { server, baseUrl } = await startServer();
  let context;
  let plainBrowser;
  try {
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      executablePath: CHROME,
      headless: false,
      ignoreDefaultArgs: ["--disable-extensions"],
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      args: [
        `--disable-extensions-except=${EXTENSION_DIR}`,
        `--load-extension=${EXTENSION_DIR}`,
        "--no-first-run",
        "--no-default-browser-check"
      ]
    });

    const extensionId = await waitForExtensionId(context);
    const demo = await context.newPage();
    await demo.goto(`${baseUrl}/demo.html`, { waitUntil: "domcontentloaded" });
    await demo.waitForSelector("#hl-panel", { timeout: 10000 });
    await demo.waitForTimeout(500);

    await highlight(demo, "#phrase-one", 0);
    await highlight(demo, "#phrase-two", 1);
    await selectText(demo, "#phrase-three");
    await demo.screenshot({ path: join(OUT_DIR, "screenshot-1-highlighting.png") });

    await demo.locator("#hl-toolbar .hl-swatch").nth(3).click({ force: true });
    await demo.locator("#hl-panel .hl-panel-toggle").click({ force: true });
    await demo.waitForTimeout(250);
    await demo.locator("#hl-panel .hl-item").first().click({ force: true });
    await demo.waitForTimeout(250);
    await demo.screenshot({ path: join(OUT_DIR, "screenshot-2-page-panel.png") });

    await demo.locator("#hl-panel .hl-panel-draw").click({ force: true });
    await demo.waitForTimeout(300);
    await demo.mouse.move(580, 546);
    await demo.mouse.down();
    await demo.mouse.move(760, 492, { steps: 10 });
    await demo.mouse.move(880, 585, { steps: 10 });
    await demo.mouse.up();
    await demo.mouse.move(575, 648);
    await demo.mouse.down();
    await demo.mouse.move(860, 648, { steps: 8 });
    await demo.mouse.up();
    await demo.waitForTimeout(250);
    await demo.screenshot({ path: join(OUT_DIR, "screenshot-3-drawing-tools.png") });

    const extensionUrl = `chrome-extension://${extensionId}`;
    const library = await context.newPage();
    await library.goto(`${extensionUrl}/library.html`, { waitUntil: "domcontentloaded" });
    await library.evaluate(async seed => {
      await chrome.storage.local.clear();
      await chrome.storage.local.set(seed.local);
      await chrome.storage.sync.set({ palette: seed.palette });
    }, seedData(baseUrl));
    await library.reload({ waitUntil: "domcontentloaded" });
    await library.waitForFunction(() => document.querySelectorAll("#results .row").length >= 8);
    await library.screenshot({ path: join(OUT_DIR, "screenshot-4-library.png") });

    await library.goto(`${extensionUrl}/library.html#design`, { waitUntil: "domcontentloaded" });
    await library.waitForFunction(() => document.querySelectorAll("#grid .card").length >= 6);
    await library.screenshot({ path: join(OUT_DIR, "screenshot-5-design-studio.png") });

    plainBrowser = await chromium.launch({
      executablePath: CHROME,
      headless: true
    });
    const plain = await plainBrowser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1
    });

    const gallery = await plain.newPage();
    const encoded = b64url(JSON.stringify(sharePayload(baseUrl)));
    await gallery.goto(`${baseUrl}/docs/v.html?d=${encoded}`, { waitUntil: "networkidle" });
    await gallery.waitForSelector(".card", { timeout: 10000 });
    await gallery.screenshot({ path: join(OUT_DIR, "screenshot-6-share-gallery.png") });

    const promoSmall = await plain.newPage();
    await promoSmall.setViewportSize({ width: 440, height: 280 });
    await promoSmall.goto(`${baseUrl}/promo-small.html`, { waitUntil: "domcontentloaded" });
    await promoSmall.screenshot({ path: join(OUT_DIR, "promo-small-440x280.png") });

    const promoMarquee = await plain.newPage();
    await promoMarquee.setViewportSize({ width: 1400, height: 560 });
    await promoMarquee.goto(`${baseUrl}/promo-marquee.html`, { waitUntil: "domcontentloaded" });
    await promoMarquee.screenshot({ path: join(OUT_DIR, "promo-marquee-1400x560.png") });
    await plain.close();

    await copyFile(join(ROOT, "icons", "icon-128.png"), join(OUT_DIR, "icon-128.png"));

    console.log(`Generated Chrome Web Store assets in ${OUT_DIR}`);
    console.log(`Extension ID used for screenshots: ${extensionId}`);
  } finally {
    if (plainBrowser) await plainBrowser.close();
    if (context) await context.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
