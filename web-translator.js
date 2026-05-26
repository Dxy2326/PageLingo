/* global chrome */

(() => {
  const TRANSLATED_ATTR = "data-xh-web-tr-state";
  const TRANSLATION_CLASS = "xh-web-translation";
  const BATCH_SIZE = 8;
  const CONCURRENCY = 2;

  const DEFAULT_TRANSLATE = {
    enabled: true,
    providerId: "google",
    targetLanguage: "zh-CN"
  };

  const SKIP_HOSTS = [
    "x.com",
    "twitter.com",
    "mobile.twitter.com"
  ];

  const SKIP_SELECTOR = [
    "script",
    "style",
    "noscript",
    "template",
    "svg",
    "canvas",
    "video",
    "audio",
    "iframe",
    "pre",
    "code",
    "kbd",
    "samp",
    "textarea",
    "input",
    "select",
    "button",
    "[contenteditable='true']",
    "[aria-hidden='true']",
    "[data-xh-web-tr-state]",
    ".xh-translation",
    ".xh-web-translation",
    ".highlight",
    ".blob-wrapper",
    ".react-code-view",
    ".js-file-line-container"
  ].join(", ");

  const DEFAULT_PROFILE = {
    id: "web",
    label: "Common Web",
    hostPattern: ".*",
    promptProfile: "web",
    selectors: ["main p", "main li", "article p", "article li", "[role='main'] p", "[role='main'] li"],
    minLength: 28,
    maxLength: 1000
  };

  const state = {
    translate: { ...DEFAULT_TRANSLATE },
    profile: pickProfile(),
    scanTimer: null,
    active: 0,
    queue: [],
    observer: null,
    viewportObserver: null,
    pending: new WeakMap()
  };

  if (shouldRunOnThisPage()) init();

  async function init() {
    injectStyles();
    await loadSettings();
    bindSettingsUpdates();
    setupObservers();
    scheduleScan(250);
  }

  function shouldRunOnThisPage() {
    if (!/^https?:$/i.test(location.protocol)) return false;
    const host = location.hostname.toLowerCase();
    return !SKIP_HOSTS.some((item) => host === item || host.endsWith(`.${item}`));
  }

  function pickProfile() {
    const host = location.hostname;
    const profiles = Array.isArray(self.XH_SITE_TRANSLATION_PROFILES)
      ? self.XH_SITE_TRANSLATION_PROFILES
      : [DEFAULT_PROFILE];
    return normalizeProfile(
      profiles.find((profile) => new RegExp(profile.hostPattern, "i").test(host)) || DEFAULT_PROFILE
    );
  }

  function normalizeProfile(profile) {
    return {
      ...DEFAULT_PROFILE,
      ...profile,
      selectors: Array.isArray(profile.selectors)
        ? profile.selectors.join(", ")
        : profile.selectors || DEFAULT_PROFILE.selectors.join(", "),
      promptProfile: profile.promptProfile || profile.id || "web"
    };
  }

  async function loadSettings() {
    try {
      const stored = await chrome.storage.sync.get(["translate"]);
      state.translate = { ...DEFAULT_TRANSLATE, ...(stored.translate || {}) };
    } catch (_error) {
      state.translate = { ...DEFAULT_TRANSLATE };
    }
  }

  function bindSettingsUpdates() {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" || !changes.translate) return;
      const next = changes.translate.newValue || {};
      const prev = state.translate;
      state.translate = { ...state.translate, ...next };
      if (
        prev.enabled !== state.translate.enabled ||
        prev.targetLanguage !== state.translate.targetLanguage ||
        prev.providerId !== state.translate.providerId
      ) {
        clearTranslations();
        if (state.translate.enabled) scheduleScan(0);
      }
    });
  }

  function setupObservers() {
    state.observer = new MutationObserver(() => scheduleScan(350));
    state.observer.observe(document.body, { childList: true, subtree: true });

    state.viewportObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const node = entry.target;
        state.viewportObserver.unobserve(node);
        if (node.getAttribute(TRANSLATED_ATTR) !== "queued") continue;
        const task = state.pending.get(node);
        if (!task) continue;
        state.pending.delete(node);
        node.setAttribute(TRANSLATED_ATTR, "pending");
        state.queue.push(task);
      }
      drainQueue();
    }, { rootMargin: "400px 0px" });
  }

  function scheduleScan(delay) {
    if (state.scanTimer) return;
    state.scanTimer = window.setTimeout(() => {
      state.scanTimer = null;
      scanPage();
    }, delay);
  }

  function scanPage() {
    if (!state.translate.enabled) return;
    const nodes = Array.from(document.querySelectorAll(state.profile.selectors));
    for (const node of nodes) enqueueNode(node);
    drainQueue();
  }

  function enqueueNode(node) {
    if (!isTranslatableNode(node)) return;
    const text = normalizeText(node.innerText || node.textContent || "");
    if (!shouldTranslate(text)) {
      node.setAttribute(TRANSLATED_ATTR, "skip");
      return;
    }

    const task = { node, text };
    const rect = node.getBoundingClientRect();
    const inViewport = rect.bottom > -400 && rect.top < (window.innerHeight || 800) + 400;
    if (inViewport) {
      node.setAttribute(TRANSLATED_ATTR, "pending");
      state.queue.push(task);
    } else {
      node.setAttribute(TRANSLATED_ATTR, "queued");
      state.pending.set(node, task);
      state.viewportObserver.observe(node);
    }
  }

  function drainQueue() {
    while (state.active < CONCURRENCY && state.queue.length > 0) {
      const tasks = state.queue.splice(0, BATCH_SIZE).filter((task) => task.node.isConnected);
      if (tasks.length === 0) continue;
      state.active += 1;
      translateTasks(tasks)
        .catch(() => {})
        .finally(() => {
          state.active -= 1;
          if (state.queue.length > 0) drainQueue();
        });
    }
  }

  async function translateTasks(tasks) {
    for (const task of tasks) {
      renderTranslation(task.node, "Translating...", "loading");
      task.node.setAttribute(TRANSLATED_ATTR, "loading");
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: "translateBatch",
        texts: tasks.map((task) => task.text),
        targetLanguage: state.translate.targetLanguage,
        forceRefresh: false,
        profile: state.profile.promptProfile,
        url: location.href
      });
      if (!response?.ok || !Array.isArray(response.results)) throw new Error(response?.error || "Translate failed");

      response.results.forEach((result, index) => {
        const task = tasks[index];
        if (!task?.node?.isConnected) return;
        const translated = (result?.translatedText || "").trim();
        if (!result?.ok || !translated || translated === task.text) {
          removeTranslation(task.node);
          task.node.setAttribute(TRANSLATED_ATTR, "skip");
          return;
        }
        renderTranslation(task.node, translated, "ok");
        task.node.setAttribute(TRANSLATED_ATTR, "done");
      });
    } catch (error) {
      for (const task of tasks) {
        if (!task.node.isConnected) continue;
        renderTranslation(task.node, `Translate failed: ${error.message || error}`, "error");
        task.node.setAttribute(TRANSLATED_ATTR, "error");
      }
    }
  }

  function isTranslatableNode(node) {
    if (!(node instanceof HTMLElement)) return false;
    if (!node.isConnected || node.getAttribute(TRANSLATED_ATTR)) return false;
    if (node.closest(SKIP_SELECTOR)) return false;
    if (node.querySelector(`.${TRANSLATION_CLASS}`)) return false;
    if (hasTranslatableAncestor(node)) return false;

    const text = normalizeText(node.innerText || node.textContent || "");
    if (text.length < state.profile.minLength || text.length > state.profile.maxLength) return false;
    if (text.split(/\s+/).length < 3 && !/[.!?。！？]/.test(text)) return false;
    if (looksLikeCodeOrChrome(text)) return false;

    return true;
  }

  function hasTranslatableAncestor(node) {
    let parent = node.parentElement;
    while (parent && parent !== document.body) {
      if (parent.getAttribute(TRANSLATED_ATTR) && parent.getAttribute(TRANSLATED_ATTR) !== "skip") return true;
      if (parent.matches("article, main, [role='main'], .markdown-body, .comment-body")) return false;
      parent = parent.parentElement;
    }
    return false;
  }

  function shouldTranslate(text) {
    if (!text) return false;
    const stripped = text
      .replace(/https?:\/\/\S+/g, "")
      .replace(/[@#$][\w\u4e00-\u9fff-]+/g, "")
      .replace(/[\p{Emoji}\p{Emoji_Component}\p{Extended_Pictographic}]/gu, "")
      .replace(/[\u200B-\u200D\uFE0F\uFEFF]/g, "")
      .replace(/\s+/g, "");

    if (stripped.length < 8) return false;
    const cjk = stripped.match(/[\u3400-\u9fff]/g)?.length || 0;
    const latin = stripped.match(/[A-Za-z\u00c0-\u024f]/g)?.length || 0;
    const cyrillic = stripped.match(/[\u0400-\u04ff]/g)?.length || 0;
    const kana = stripped.match(/[\u3040-\u30ff]/g)?.length || 0;
    const hangul = stripped.match(/[\uac00-\ud7af]/g)?.length || 0;
    const nonCjkLetters = latin + cyrillic + kana + hangul;
    if (nonCjkLetters === 0) return false;

    const targetIsChinese = /^zh/i.test(state.translate.targetLanguage || "");
    if (targetIsChinese && cjk / Math.max(cjk + nonCjkLetters, 1) >= 0.45) return false;
    return true;
  }

  function looksLikeCodeOrChrome(text) {
    const sample = text.trim();
    if (/^(npm|pnpm|yarn|git|gh|curl|docker|kubectl|pip|python|node)\s/i.test(sample)) return true;
    if (/^[\w.-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(sample)) return true;
    if (/^https?:\/\/\S+$/.test(sample)) return true;
    if (/^[A-Z0-9_./:-]{8,}$/.test(sample)) return true;

    const symbolCount = (sample.match(/[{}()[\];=<>`|]/g) || []).length;
    const letterCount = (sample.match(/[A-Za-z\u3400-\u9fff]/g) || []).length;
    return symbolCount > 5 && symbolCount > letterCount * 0.25;
  }

  function normalizeText(text) {
    return String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function renderTranslation(node, text, status) {
    let block = findTranslationBlock(node);
    if (!block) {
      block = document.createElement("div");
      block.className = TRANSLATION_CLASS;
      block.setAttribute("dir", "auto");

      const label = document.createElement("span");
      label.className = `${TRANSLATION_CLASS}-label`;
      label.textContent = "译";
      label.title = "点击折叠/展开译文";
      label.addEventListener("click", () => {
        const collapsed = block.getAttribute("data-collapsed") === "true";
        block.setAttribute("data-collapsed", collapsed ? "false" : "true");
      });
      block.appendChild(label);

      const content = document.createElement("span");
      content.className = `${TRANSLATION_CLASS}-text`;
      block.appendChild(content);

      if (node.tagName === "LI") node.appendChild(block);
      else node.insertAdjacentElement("afterend", block);
    }

    block.dataset.state = status;
    const content = block.querySelector(`.${TRANSLATION_CLASS}-text`);
    if (content) content.textContent = text;
  }

  function removeTranslation(node) {
    findTranslationBlock(node)?.remove();
  }

  function findTranslationBlock(node) {
    if (node.tagName === "LI") {
      const last = node.lastElementChild;
      return last?.classList?.contains(TRANSLATION_CLASS) ? last : null;
    }
    const next = node.nextElementSibling;
    return next?.classList?.contains(TRANSLATION_CLASS) ? next : null;
  }

  function clearTranslations() {
    document.querySelectorAll(`.${TRANSLATION_CLASS}`).forEach((el) => el.remove());
    document.querySelectorAll(`[${TRANSLATED_ATTR}]`).forEach((el) => {
      el.removeAttribute(TRANSLATED_ATTR);
      state.viewportObserver?.unobserve(el);
    });
    state.queue.length = 0;
    state.pending = new WeakMap();
  }

  function injectStyles() {
    if (document.getElementById("xh-web-translator-style")) return;
    const style = document.createElement("style");
    style.id = "xh-web-translator-style";
    style.textContent = `
      .${TRANSLATION_CLASS} {
        margin: 6px 0 10px;
        padding: 8px 10px;
        border-left: 3px solid #1f883d;
        background: rgba(31, 136, 61, 0.08);
        color: inherit;
        font-size: 0.95em;
        line-height: 1.55;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        border-radius: 4px;
      }
      .${TRANSLATION_CLASS}[data-state="loading"] {
        opacity: 0.7;
        font-style: italic;
      }
      .${TRANSLATION_CLASS}[data-state="error"] {
        border-left-color: #cf222e;
        background: rgba(207, 34, 46, 0.08);
      }
      .${TRANSLATION_CLASS}[data-collapsed="true"] .${TRANSLATION_CLASS}-text {
        display: none;
      }
      .${TRANSLATION_CLASS}-label {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 18px;
        margin-right: 7px;
        border-radius: 4px;
        background: #1f883d;
        color: #fff;
        font-size: 12px;
        line-height: 18px;
        cursor: pointer;
        user-select: none;
      }
      .${TRANSLATION_CLASS}[data-state="error"] .${TRANSLATION_CLASS}-label {
        background: #cf222e;
      }
      @media (prefers-color-scheme: dark) {
        .${TRANSLATION_CLASS} {
          background: rgba(63, 185, 80, 0.12);
          border-left-color: #3fb950;
        }
        .${TRANSLATION_CLASS}-label {
          background: #238636;
        }
      }
    `;
    document.head.appendChild(style);
  }
})();
