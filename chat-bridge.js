(() => {
  const ALLOWED_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);

  function findComposer() {
    const selectors = [
      "#prompt-textarea",
      "textarea[data-testid='prompt-textarea']",
      "form textarea",
      "form [contenteditable='true']"
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  function insertIntoComposer(composer, prompt) {
    composer.focus();
    const hasContent = composer.tagName === "TEXTAREA" || composer.tagName === "INPUT"
      ? Number(composer.value?.length || 0) > 0
      : Number(composer.childNodes?.length || 0) > 0;
    const text = (hasContent ? "\n\n" : "") + prompt;

    if (composer.tagName === "TEXTAREA" || composer.tagName === "INPUT") {
      const end = Number(composer.value?.length || 0);
      if (typeof composer.setRangeText === "function") composer.setRangeText(text, end, end, "end");
      else composer.value += text;
      composer.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }

    const selection = window.getSelection?.();
    const range = document.createRange?.();
    if (selection && range) {
      range.selectNodeContents(composer);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    const inserted = typeof document.execCommand === "function" && document.execCommand("insertText", false, text);
    if (!inserted) {
      composer.append(document.createTextNode(text));
      composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "insertHighlighterChatPrompt") return;
    if (!ALLOWED_HOSTS.has(location.hostname)) {
      sendResponse({ ok: false, error: "This is not a supported ChatGPT page." });
      return;
    }
    const prompt = String(message.prompt || "").trim().slice(0, 8000);
    if (!prompt) {
      sendResponse({ ok: false, error: "The chat prompt is empty." });
      return;
    }
    const composer = findComposer();
    if (!composer) {
      sendResponse({ ok: false, error: "Open a ChatGPT conversation and try again." });
      return;
    }
    try {
      insertIntoComposer(composer, prompt);
      sendResponse({ ok: true });
    } catch {
      sendResponse({ ok: false, error: "ChatGPT's composer could not be updated." });
    }
  });
})();
