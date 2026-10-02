(() => {
  if (window.__hlReadAlongLoaded) return;
  window.__hlReadAlongLoaded = true;

  const SPEED_KEY = "hl_read_along_wpm";
  const SKIP = 'script,style,noscript,template,input,textarea,select,button,nav,[hidden],[aria-hidden="true"],[contenteditable]:not([contenteditable="false"]),[id^="hl-"],#pdf-appbar,#pdf-sidebar,#pdf-status,.pdf-ai-options-panel,.pdf-agent-panel,.pdf-ai-modal,.pdf-ai-toast';
  let wpm = 70;
  let session = null;
  let timer = null;
  let frame = null;
  let controls = null;
  let focus = null;
  let playButton = null;
  let progress = null;
  let status = null;
  let speedInput = null;
  let wordDisplay = null;
  let readerObserver = null;
  let generation = 0;
  let readingTails = [];
  const textObserver = new MutationObserver(mutations => {
    if (!session || session.index >= session.words.length) return;
    const changedPageText = mutations.some(mutation => {
      const element = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
      return !element?.closest("#hl-read-along,#hl-read-along-focus");
    });
    if (changedPageText && !currentRange()) stop();
  });
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const preferenceReady = chrome.storage.local.get(SPEED_KEY).then(data => {
    const value = Number(data[SPEED_KEY]);
    if (Number.isFinite(value) && value >= 30 && value <= 1000) wpm = Math.round(value);
  }).catch(() => {});

  // Build one text stream so a word split by inline markup still has one beat.
  // Block boundaries and PDF text runs supply separators absent from textContent.
  function collectWords(selection) {
    const startElement = selection.startContainer.nodeType === Node.ELEMENT_NODE
      ? selection.startContainer : selection.startContainer.parentElement;
    if (!startElement || startElement.closest(SKIP)) return [];
    const root = startElement.closest("#pdf-viewer,article,[role='article'],main,[role='main']") ||
      (startElement.getRootNode() instanceof ShadowRoot ? startElement.getRootNode() : document.body);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.matches(SKIP)) return NodeFilter.FILTER_REJECT;
          return node.tagName === "BR" ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
        const parent = node.parentElement;
        if (!node.data || !parent || parent.closest(SKIP)) return NodeFilter.FILTER_REJECT;
        if (!parent.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const segments = [];
    const parts = [];
    const blocks = new WeakMap();
    function blockFor(element) {
      if (!element || element === root) return root;
      if (blocks.has(element)) return blocks.get(element);
      const display = getComputedStyle(element).display;
      const block = display === "inline" || display === "contents" ? blockFor(element.parentElement) : element;
      blocks.set(element, block);
      return block;
    }
    let length = 0;
    let previousBlock = null;
    let previousPdfRun = null;
    let startOffset = null;
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        parts.push("\n");
        length++;
        continue;
      }
      const block = blockFor(node.parentElement);
      const pdfRun = node.parentElement.closest(".textLayer > span,.textLayer .markedContent > span");
      if (segments.length && (block !== previousBlock || pdfRun !== previousPdfRun)) {
        parts.push("\n");
        length++;
      }
      const begin = length;
      parts.push(node.data);
      length += node.length;
      segments.push({ node, start: begin, end: length, text: node.data });
      if (node === selection.startContainer) startOffset = begin + selection.startOffset;
      previousBlock = block;
      previousPdfRun = pdfRun;
    }
    if (startOffset === null) return [];
    const text = parts.join("");
    const language = document.documentElement.lang || navigator.language;
    let segmenter;
    try { segmenter = new Intl.Segmenter(language, { granularity: "word" }); }
    catch { segmenter = new Intl.Segmenter(undefined, { granularity: "word" }); }
    const words = [];
    let segmentIndex = 0;
    for (const word of segmenter.segment(text)) {
      if (!word.isWordLike || word.index + word.segment.length <= startOffset) continue;
      while (segmentIndex < segments.length && segments[segmentIndex].end <= word.index) segmentIndex++;
      const first = segments[segmentIndex];
      let endIndex = segmentIndex;
      const end = word.index + word.segment.length;
      while (endIndex < segments.length && segments[endIndex].end < end) endIndex++;
      const last = segments[endIndex];
      if (!first || !last) continue;
      words.push({ first, last, start: word.index - first.start, end: end - last.start, text: word.segment });
    }
    return words;
  }

  function stop() {
    generation++;
    textObserver.disconnect();
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    timer = frame = null;
    CSS.highlights?.delete("hl-read-word");
    readerObserver?.disconnect();
    readerObserver = wordDisplay = null;
    controls?.remove();
    focus?.remove();
    readingTails.forEach(tail => tail.remove());
    readingTails = [];
    session = controls = focus = null;
  }

  function updateControls(message) {
    if (!session) return;
    const finished = session.index >= session.words.length;
    playButton.textContent = session.playing ? "Ⅱ Pause" : finished ? "↺ Replay" : "▶ Resume";
    playButton.setAttribute("aria-label", session.playing ? "Pause read-along" : finished ? "Replay read-along" : "Resume read-along");
    controls.dataset.playing = String(session.playing);
    progress.textContent = `${Math.min(session.index + 1, session.words.length)} / ${session.words.length}`;
    const label = message || (session.playing ? "Reading" : finished ? "Finished" : "Paused");
    if (status.textContent !== label) status.textContent = label;
  }

  function pause(message) {
    if (!session) return;
    clearTimeout(timer);
    timer = null;
    session.playing = false;
    updateControls(message);
  }

  function currentRange() {
    const word = session?.words[session.index];
    if (!word || !word.first.node.isConnected || !word.last.node.isConnected ||
      word.first.node.data !== word.first.text || word.last.node.data !== word.last.text) return null;
    const range = document.createRange();
    range.setStart(word.first.node, word.start);
    range.setEnd(word.last.node, word.end);
    return range;
  }

  function drawFocus() {
    if (!session || !focus) return;
    const range = currentRange();
    focus.replaceChildren();
    if (!range) return;
    for (const rect of range.getClientRects()) {
      if (!rect.width || !rect.height) continue;
      const box = document.createElement("span");
      Object.assign(box.style, { left: `${rect.left - 2}px`, top: `${rect.top - 2}px`, width: `${rect.width + 4}px`, height: `${rect.height + 4}px` });
      focus.appendChild(box);
    }
  }

  function scrollToWord(range) {
    const element = range.startContainer.parentElement;
    const behavior = reducedMotion.matches ? "instant" : "smooth";
    const wordRect = range.getBoundingClientRect();
    const projected = { top: wordRect.top, bottom: wordRect.bottom, left: wordRect.left, right: wordRect.right };
    function scrollWithin(target, top, bottom, left, right) {
      const height = bottom - top;
      if (height <= 0 || right <= left) return;
      const safeTop = top + (target === window ? Math.min(100, height * 0.15) : Math.min(32, height * 0.1));
      const controlsTop = target === window ? (controls?.getBoundingClientRect().top ?? bottom) - 24 : bottom;
      const trigger = Math.min(top + height * 0.75, controlsTop);
      const landing = top + height * 0.2;
      const y = projected.top < safeTop || projected.bottom >= trigger ? projected.top - landing : 0;
      const x = projected.left < left || projected.right > right ? (projected.left + projected.right - left - right) / 2 : 0;
      const scroller = target === window ? document.scrollingElement : target;
      if (!scroller) return;
      const nextTop = Math.max(0, Math.min(scroller.scrollTop + y, scroller.scrollHeight - scroller.clientHeight));
      const nextLeft = x ? Math.max(0, Math.min(scroller.scrollLeft + x, scroller.scrollWidth - scroller.clientWidth)) : scroller.scrollLeft;
      const dy = nextTop - scroller.scrollTop;
      const dx = nextLeft - scroller.scrollLeft;
      if (dx || dy) target.scrollTo({ top: nextTop, left: nextLeft, behavior });
      // Account for the inner scroller's destination before scrolling its
      // ancestors, even while the smooth animation is still in progress.
      projected.top -= dy;
      projected.bottom -= dy;
      projected.left -= dx;
      projected.right -= dx;
    }
    for (let parent = element; parent && parent !== document.body; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (/(auto|scroll)/.test(style.overflowY + style.overflowX)) {
        const bounds = parent.getBoundingClientRect();
        scrollWithin(parent, bounds.top + parent.clientTop, bounds.top + parent.clientTop + parent.clientHeight,
          bounds.left + parent.clientLeft, bounds.left + parent.clientLeft + parent.clientWidth);
      }
    }
    // Use the word's rectangle, not its paragraph, so long paragraphs advance.
    // Leave space above the controls, including when they wrap on small screens.
    scrollWithin(window, 0, innerHeight, 0, document.documentElement.clientWidth);
  }

  function paintWord() {
    const range = currentRange();
    if (!range || !range.getClientRects().length) {
      stop(); // The page/PDF replaced its text. Never continue at stale offsets.
      return false;
    }
    CSS.highlights.set("hl-read-word", new Highlight(range));
    showReaderWord(session.words[session.index].text);
    scrollToWord(range);
    drawFocus();
    updateControls();
    return true;
  }

  function fitReaderWord() {
    if (!wordDisplay) return;
    const stage = wordDisplay.parentElement;
    const size = Math.min(72, Math.max(28, stage.clientHeight * 0.3));
    wordDisplay.style.fontSize = `${size}px`;
    const [before, anchor, after] = wordDisplay.children;
    const available = (wordDisplay.clientWidth - 40 - anchor.getBoundingClientRect().width) / 2 - 12;
    const textWidth = element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect().width;
    };
    const needed = Math.max(textWidth(before), textWidth(after));
    if (needed > available && available > 0) wordDisplay.style.fontSize = `${size * available / needed}px`;
  }

  function showReaderWord(text) {
    // Grapheme clusters keep accents and combined characters together. Align
    // the recognition letter itself to the center so the eye stays anchored.
    const letters = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), part => part.segment);
    const pivot = letters.length <= 1 ? 0 : letters.length <= 5 ? 1 : letters.length <= 9 ? 2 : letters.length <= 13 ? 3 : 4;
    const [before, anchor, after] = wordDisplay.children;
    before.textContent = letters.slice(0, pivot).join("");
    anchor.textContent = letters[pivot];
    after.textContent = letters.slice(pivot + 1).join("");
    wordDisplay.setAttribute("aria-label", text);
    fitReaderWord();
  }

  function scheduleNext() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!session?.playing) return;
      if (document.hidden) { pause("Paused · tab hidden"); return; }
      session.index++;
      if (session.index >= session.words.length) {
        CSS.highlights.delete("hl-read-word");
        focus.replaceChildren();
        pause("Finished");
        return;
      }
      if (paintWord()) scheduleNext();
    }, 60000 / wpm);
  }

  function play() {
    if (!session || document.hidden) return;
    if (session.index >= session.words.length) session.index = 0;
    session.playing = true;
    if (paintWord()) scheduleNext();
  }

  function addReadingSpace() {
    // Temporary blank space lets the final lines move above the controls too.
    // The document spacer is absolute so it cannot rearrange a flex/grid body.
    const documentTail = document.createElement("div");
    documentTail.id = "hl-read-along-tail";
    documentTail.setAttribute("aria-hidden", "true");
    const bottom = document.scrollingElement.scrollHeight;
    documentTail.style.cssText = `all:initial;position:absolute;top:${bottom}px;left:0;width:1px;height:80vh;visibility:hidden;pointer-events:none;`;
    document.documentElement.appendChild(documentTail);
    readingTails.push(documentTail);
    const visited = new Set();
    for (const word of session.words) {
      for (let parent = word.first.node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (visited.has(parent)) break;
        visited.add(parent);
        if (!/(auto|scroll)/.test(getComputedStyle(parent).overflowY) || parent.scrollHeight <= parent.clientHeight) continue;
        const tail = document.createElement("div");
        tail.id = `hl-read-along-tail-${readingTails.length}`;
        tail.setAttribute("aria-hidden", "true");
        const space = Math.ceil(parent.clientHeight * 0.8);
        tail.style.cssText = `all:initial;display:block;flex-shrink:0;grid-column:1/-1;width:1px;height:${space}px;min-height:${space}px;visibility:hidden;pointer-events:none;`;
        parent.appendChild(tail);
        readingTails.push(tail);
      }
    }
  }

  function buildControls() {
    controls = document.createElement("div");
    controls.id = "hl-read-along";
    controls.setAttribute("role", "region");
    controls.setAttribute("aria-label", "Read-along controls");
    controls.innerHTML = `
      <div class="hl-read-stage" aria-label="Current reading word">
        <div class="hl-read-word" dir="ltr"><span class="hl-read-before"></span><span class="hl-read-anchor"></span><span class="hl-read-after"></span></div>
      </div>
      <div class="hl-read-toolbar">
      <span class="hl-read-indicator" aria-hidden="true"></span>
      <span class="hl-read-info"><strong>Read along</strong><span class="hl-read-status" role="status"></span></span>
      <button class="hl-read-play" type="button"></button>
      <div class="hl-read-speed">
        <button class="hl-read-slower" type="button" aria-label="Decrease reading speed">−</button>
        <label><input type="number" min="30" max="1000" step="10" aria-label="Reading speed in words per minute"><span>WPM</span></label>
        <button class="hl-read-faster" type="button" aria-label="Increase reading speed">+</button>
      </div>
      <span class="hl-read-progress" aria-label="Reading progress"></span>
      <button class="hl-read-expand" type="button" aria-label="Expand reading box" aria-expanded="false" title="Expand reading box">⤢</button>
      <button class="hl-read-stop" type="button" aria-label="Stop read-along" title="Stop (Escape)">×</button>
      </div>`;
    playButton = controls.querySelector(".hl-read-play");
    progress = controls.querySelector(".hl-read-progress");
    status = controls.querySelector(".hl-read-status");
    speedInput = controls.querySelector("input");
    wordDisplay = controls.querySelector(".hl-read-word");
    speedInput.value = wpm;
    playButton.addEventListener("click", () => session?.playing ? pause() : play());
    controls.querySelector(".hl-read-stop").addEventListener("click", stop);
    function setSpeed(value) {
      if (!Number.isFinite(value) || value < 30 || value > 1000) { speedInput.value = wpm; return; }
      wpm = Math.round(value);
      speedInput.value = wpm;
      chrome.storage.local.set({ [SPEED_KEY]: wpm }).catch(() => {});
      if (session?.playing) scheduleNext();
      controls.querySelector(".hl-read-slower").disabled = wpm <= 30;
      controls.querySelector(".hl-read-faster").disabled = wpm >= 1000;
    }
    speedInput.addEventListener("change", () => setSpeed(Number(speedInput.value)));
    controls.querySelector(".hl-read-slower").addEventListener("click", () => setSpeed(Math.max(30, wpm - 10)));
    controls.querySelector(".hl-read-faster").addEventListener("click", () => setSpeed(Math.min(1000, wpm + 10)));
    controls.querySelector(".hl-read-slower").disabled = wpm <= 30;
    controls.querySelector(".hl-read-faster").disabled = wpm >= 1000;
    controls.querySelector(".hl-read-expand").addEventListener("click", event => {
      const expanded = controls.classList.toggle("hl-read-expanded");
      controls.style.width = controls.style.height = "";
      event.currentTarget.setAttribute("aria-expanded", String(expanded));
      event.currentTarget.setAttribute("aria-label", expanded ? "Shrink reading box" : "Expand reading box");
      event.currentTarget.title = expanded ? "Shrink reading box" : "Expand reading box";
    });
    // Selecting a speed or using a control must not create a selection toolbar.
    controls.addEventListener("mousedown", event => event.stopPropagation());
    document.body.appendChild(controls);
    readerObserver = new ResizeObserver(() => {
      fitReaderWord();
      const range = currentRange();
      if (range) scrollToWord(range);
    });
    readerObserver.observe(controls.querySelector(".hl-read-stage"));
    focus = document.createElement("div");
    focus.id = "hl-read-along-focus";
    focus.setAttribute("aria-hidden", "true");
    document.body.appendChild(focus);
  }

  window.addEventListener("hl-start-read-along", async event => {
    const selection = event.detail?.range?.cloneRange();
    if (!selection || !CSS.highlights || typeof Highlight === "undefined") return;
    stop();
    const startGeneration = generation;
    await preferenceReady;
    if (generation !== startGeneration) return;
    const words = collectWords(selection);
    if (!words.length) return;
    window.getSelection()?.removeAllRanges();
    session = { words, index: 0, playing: false };
    buildControls();
    addReadingSpace();
    textObserver.observe(words[0].first.node.getRootNode(), { subtree: true, childList: true, characterData: true });
    play();
  });
  window.addEventListener("hl-stop-read-along", stop);
  window.addEventListener("hl-pdf-rendered", stop);
  window.addEventListener("pagehide", stop);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && session?.playing) pause("Paused · tab hidden");
  });
  document.addEventListener("keydown", event => {
    if (!session) return;
    if (!event.target.closest?.("#hl-read-along") && event.target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
    if (event.key === "Escape") stop();
  });
  function reposition() {
    if (!session || frame) return;
    frame = requestAnimationFrame(() => { frame = null; drawFocus(); });
  }
  document.addEventListener("scroll", reposition, { passive: true, capture: true });
  window.addEventListener("resize", () => {
    if (session && readingTails.length) {
      for (const tail of readingTails.slice(1)) {
        const space = Math.ceil(tail.parentElement.clientHeight * 0.8);
        tail.style.height = tail.style.minHeight = `${space}px`;
      }
      const documentTail = readingTails[0];
      const previousX = scrollX;
      const previousY = scrollY;
      documentTail.style.display = "none";
      documentTail.style.top = `${document.scrollingElement.scrollHeight}px`;
      documentTail.style.display = "block";
      window.scrollTo({ left: previousX, top: previousY, behavior: "instant" });
      const range = currentRange();
      if (range && session.playing) scrollToWord(range);
    }
    reposition();
  });
})();
