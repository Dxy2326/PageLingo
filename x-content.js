/* global chrome */

/* =========================================================================
 *  PageLingo · X 内容脚本
 *  同时负责：
 *    1) 自动翻译推文，在 tweetText 下面插入「译文」块
 *    2) 在每条推文操作栏插入「AI 回」按钮，弹出回复草稿面板
 *  两套功能复用同一份扫描循环和 DOM 选择器。
 * ========================================================================= */

const TWEET_SELECTOR = 'article[data-testid="tweet"], article[role="article"]';
const TEXT_SELECTOR = '[data-testid="tweetText"]';
const LONG_TEXT_SELECTOR = [
  '[data-testid="articleText"]',
  '[data-testid="tweetDetailNote"]',
  '[data-testid="tweetDetailNoteText"]',
  '[data-testid="NoteTweetText"]',
  '[data-testid="noteTweetText"]'
].join(", ");
const LONG_TEXT_CONTAINER_SELECTOR = [
  '[data-testid="article"]',
  '[data-testid="tweetDetailNote"]',
  '[data-testid="NoteTweet"]',
  '[data-testid="noteTweet"]'
].join(", ");

/* ---------- 翻译相关常量 ---------- */
const TRANSLATED_ATTR = "data-xh-tr-state";
const TRANSLATION_CLASS = "xh-translation";
const CONCURRENCY = 6;

/* ---------- 回复相关常量 ---------- */
const REPLY_BTN_ATTR = "data-xh-reply-attached";
const REPLY_PANEL_CLASS = "xh-reply-panel";
const REPLY_BTN_CLASS = "xh-reply-btn";

const FALLBACK_PERSONAS = [{ id: "default", name: "通用真人感", prompt: "" }];

const TONES = [
  { id: "neutral", name: "中立", desc: "保持人设原本的语气，不额外加倾向。" },
  { id: "friendly", name: "友好", desc: "整体偏暖，认可对方的具体细节，避免肉麻和无脑夸。允许一句轻微好奇的反问。" },
  { id: "playful", name: "调侃", desc: "整体松弛、不正经，可以接梗、玩谐音、自嘲。不冒犯弱势群体，点到为止。" },
  { id: "contrary", name: "反对", desc: "礼貌但直接表达不同意。给具体理由（反例、被忽略的代价、不同时间维度），靠论点而非态度赢。禁止人身攻击和阴阳怪气。" }
];

const state = {
  translate: { enabled: true, targetLanguage: "zh-CN" },
  reply: { lastPersonaId: "crypto-og", lastToneId: "neutral" },
  personas: FALLBACK_PERSONAS.slice()
};

let observer = null;
let viewportObserver = null;
let scanTimer = null;
const queue = [];
let activeWorkers = 0;
const pendingTasks = new WeakMap();

init();

/* =========================================================================
 *  全局快捷键
 *  Alt+R：在鼠标悬停的推文上展开/收起 AI 回面板
 *  Alt+T：折叠/展开鼠标悬停推文的译文块
 *  Esc ：关闭当前打开的 AI 回面板（并取消正在跑的生成请求）
 * ========================================================================= */
let lastMouseX = 0;
let lastMouseY = 0;
document.addEventListener("mousemove", (e) => {
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
}, { passive: true });

document.addEventListener("keydown", (e) => {
  // 不打扰输入：在输入框、textarea、contenteditable 里时不响应
  const target = e.target;
  const isEditable =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable);

  if (e.key === "Escape") {
    // Esc 始终响应：关掉打开的面板（不打断 X 自己的 Esc 行为，所以不 preventDefault）
    const panel = document.querySelector(`.${REPLY_PANEL_CLASS}`);
    if (panel) {
      const closeBtn = panel.querySelector(".xh-close");
      if (closeBtn) closeBtn.click();
      else panel.remove();
    }
    return;
  }

  // Alt+R / Alt+T 在输入框里不响应
  if (isEditable) return;
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;

  const key = e.key.toLowerCase();
  if (key === "r") {
    const tweet = findTweetUnderCursor();
    if (tweet) {
      e.preventDefault();
      toggleReplyPanel(tweet);
    }
  } else if (key === "t") {
    const tweet = findTweetUnderCursor();
    if (tweet) {
      const block = tweet.querySelector(`.${TRANSLATION_CLASS}`);
      if (block) {
        e.preventDefault();
        const collapsed = block.getAttribute("data-collapsed") === "true";
        block.setAttribute("data-collapsed", collapsed ? "false" : "true");
      }
    }
  }
}, true);

/**
 * 在鼠标当前位置下找最近的推文 article。鼠标停在面板/按钮上时也会回到所属推文。
 */
function findTweetUnderCursor() {
  const el = document.elementFromPoint(lastMouseX, lastMouseY);
  if (!el) return null;
  return el.closest(TWEET_SELECTOR);
}

async function init() {
  injectStyles();
  await loadSettings();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;

    let needClearTr = false;
    let needRescan = false;

    if (changes.translate) {
      const next = changes.translate.newValue || {};
      const prev = changes.translate.oldValue || {};
      state.translate = { ...state.translate, ...next };
      if (prev.enabled !== next.enabled || prev.targetLanguage !== next.targetLanguage || prev.providerId !== next.providerId) {
        needClearTr = true;
        needRescan = !!state.translate.enabled;
      }
    }
    if (changes.providerConfigs) {
      // 凭据变了，清掉旧译文
      needClearTr = true;
      needRescan = !!state.translate.enabled;
    }
    if (changes.reply) {
      state.reply = { ...state.reply, ...(changes.reply.newValue || {}) };
    }
    if (changes.personas) {
      state.personas = changes.personas.newValue && changes.personas.newValue.length > 0
        ? changes.personas.newValue
        : FALLBACK_PERSONAS;
    }

    if (needClearTr) clearAllTranslations();
    if (needRescan) scheduleScan(0);
  });

  scheduleScan(200);
  watchPage();
}

async function loadSettings() {
  try {
    const stored = await chrome.storage.sync.get([
      "translate",
      "reply",
      "personas"
    ]);
    if (stored.translate) state.translate = { ...state.translate, ...stored.translate };
    if (stored.reply) state.reply = { ...state.reply, ...stored.reply };
    state.personas = stored.personas && stored.personas.length > 0 ? stored.personas : FALLBACK_PERSONAS;
  } catch (_e) {
    /* ignore */
  }
}

function watchPage() {
  // 简单可靠：直接监听 document.body，任何 DOM 变化都触发 scan。
  // 性能保护交给 scheduleScan 的 throttle + scanTweets 内部的 attr 守卫。
  observer = new MutationObserver(() => scheduleScan(200));
  observer.observe(document.body, { childList: true, subtree: true });

  viewportObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const tweet = entry.target;
          viewportObserver.unobserve(tweet);
          if (tweet.getAttribute(TRANSLATED_ATTR) === "queued") {
            tweet.setAttribute(TRANSLATED_ATTR, "pending");
            const task = pendingTasks.get(tweet);
            if (task) {
              pendingTasks.delete(tweet);
              queue.push(task);
              drainQueue();
            }
          }
        }
      }
    },
    { rootMargin: "300px 0px" }
  );
}

function scheduleScan(delay) {
  if (scanTimer) return;
  scanTimer = window.setTimeout(() => {
    scanTimer = null;
    scanTweets();
  }, delay);
}

function scanTweets() {
  const tweets = document.querySelectorAll(TWEET_SELECTOR);
  for (const tweet of tweets) {
    if (state.translate.enabled) enqueueTweetForTranslation(tweet);
    attachReplyButton(tweet);
  }
  drainQueue();
}

/* =========================================================================
 *  翻译：扫描 / 入队 / 渲染
 * ========================================================================= */

function enqueueTweetForTranslation(tweet) {
  if (!tweet || !tweet.isConnected) return;
  if (tweet.getAttribute(TRANSLATED_ATTR)) return;

  const content = extractPrimaryTweetContent(tweet);
  if (!content) return;

  const { textNode, text } = content;
  if (!text) {
    tweet.setAttribute(TRANSLATED_ATTR, "skip");
    return;
  }
  if (!shouldTranslate(text)) {
    tweet.setAttribute(TRANSLATED_ATTR, "skip");
    return;
  }

  const task = { tweet, textNode, text };
  const rect = tweet.getBoundingClientRect();
  const inViewport =
    rect.bottom > -300 && rect.top < (window.innerHeight || 800) + 300;

  if (inViewport) {
    tweet.setAttribute(TRANSLATED_ATTR, "pending");
    queue.push(task);
  } else {
    tweet.setAttribute(TRANSLATED_ATTR, "queued");
    pendingTasks.set(tweet, task);
    if (viewportObserver) viewportObserver.observe(tweet);
  }
}

function drainQueue() {
  while (activeWorkers < CONCURRENCY && queue.length > 0) {
    const task = queue.shift();
    if (!task.tweet.isConnected) continue;
    activeWorkers += 1;
    translateOne(task)
      .catch(() => {})
      .finally(() => {
        activeWorkers -= 1;
        if (queue.length > 0) drainQueue();
      });
  }
}

async function translateOne({ tweet, textNode, text }, forceRefresh = false) {
  const placeholder = insertTranslationBlock(textNode, "翻译中…", "loading", "", false, "");
  tweet.setAttribute(TRANSLATED_ATTR, "loading");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "translateTweet",
      text,
      targetLanguage: state.translate.targetLanguage,
      forceRefresh
    });
    if (!response?.ok) throw new Error(response?.error || "未知错误");

    const translated = (response.translatedText || "").trim();
    if (!translated || translated === text) {
      placeholder.remove();
      tweet.setAttribute(TRANSLATED_ATTR, "skip");
      return;
    }

    renderTranslation(placeholder, translated, "ok", response.providerLabel || "", response.fellBack || false, response.providerTooltip || "");
    bindTranslationToolsHandlers(placeholder, { tweet, textNode, text });
    tweet.setAttribute(TRANSLATED_ATTR, "done");
  } catch (error) {
    renderTranslation(placeholder, `翻译失败：${error.message || error}`, "error", "", false, "");
    bindTranslationToolsHandlers(placeholder, { tweet, textNode, text });
    tweet.setAttribute(TRANSLATED_ATTR, "error");
  }
}

function insertTranslationBlock(textNode, message, statusType, providerLabel, fellBack, providerTooltip) {
  const existing = findExistingTranslation(textNode);
  if (existing) existing.remove();

  const block = document.createElement("div");
  block.className = TRANSLATION_CLASS;
  block.setAttribute("data-state", statusType);
  block.setAttribute("dir", "auto");

  const label = document.createElement("span");
  label.className = `${TRANSLATION_CLASS}-label`;
  label.textContent = "译文";
  label.title = "点击折叠/展开译文";
  block.appendChild(label);

  const content = document.createElement("span");
  content.className = `${TRANSLATION_CLASS}-text`;
  content.textContent = message;
  block.appendChild(content);

  const provider = document.createElement("span");
  provider.className = `${TRANSLATION_CLASS}-provider`;
  provider.textContent = providerLabel || "";
  if (providerTooltip) provider.title = providerTooltip;
  if (fellBack) {
    provider.setAttribute("data-fellback", "true");
    provider.title = "上游 API 不可用，已降级到 Google 免费翻译";
  }
  block.appendChild(provider);

  const tools = document.createElement("span");
  tools.className = `${TRANSLATION_CLASS}-tools`;

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = `${TRANSLATION_CLASS}-btn`;
  copyBtn.dataset.action = "copy";
  copyBtn.textContent = "⧉ 复制";
  copyBtn.title = "复制译文到剪贴板";
  tools.appendChild(copyBtn);

  const retryBtn = document.createElement("button");
  retryBtn.type = "button";
  retryBtn.className = `${TRANSLATION_CLASS}-btn`;
  retryBtn.dataset.action = "retry";
  retryBtn.textContent = "↻ 重译";
  retryBtn.title = "用最新设置重新翻译这条推文";
  tools.appendChild(retryBtn);

  block.appendChild(tools);

  textNode.insertAdjacentElement("afterend", block);
  return block;
}

function renderTranslation(block, text, statusType, providerLabel, fellBack, providerTooltip) {
  block.setAttribute("data-state", statusType);
  const content = block.querySelector(`.${TRANSLATION_CLASS}-text`);
  if (content) content.textContent = text;
  const provider = block.querySelector(`.${TRANSLATION_CLASS}-provider`);
  if (provider) {
    provider.textContent = providerLabel || "";
    if (fellBack) {
      provider.setAttribute("data-fellback", "true");
      provider.title = "上游 API 不可用，已降级到 Google 免费翻译";
    } else {
      provider.removeAttribute("data-fellback");
      if (providerTooltip) provider.title = providerTooltip;
      else provider.removeAttribute("title");
    }
  }
}

function bindTranslationToolsHandlers(block, task) {
  const label = block.querySelector(`.${TRANSLATION_CLASS}-label`);
  if (label) {
    label.addEventListener("click", (e) => {
      e.stopPropagation();
      const collapsed = block.getAttribute("data-collapsed") === "true";
      block.setAttribute("data-collapsed", collapsed ? "false" : "true");
    });
  }

  const copyBtn = block.querySelector(`.${TRANSLATION_CLASS}-btn[data-action="copy"]`);
  if (copyBtn) {
    copyBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const content = block.querySelector(`.${TRANSLATION_CLASS}-text`);
      const text = content?.textContent || "";
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        const original = copyBtn.textContent;
        copyBtn.textContent = "✓ 已复制";
        copyBtn.classList.add("is-success");
        setTimeout(() => {
          copyBtn.textContent = original;
          copyBtn.classList.remove("is-success");
        }, 1200);
      } catch (_err) {
        copyBtn.textContent = "✗ 失败";
        setTimeout(() => { copyBtn.textContent = "⧉ 复制"; }, 1200);
      }
    });
  }

  const retryBtn = block.querySelector(`.${TRANSLATION_CLASS}-btn[data-action="retry"]`);
  if (retryBtn) {
    retryBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      retryBtn.disabled = true;
      task.tweet.setAttribute(TRANSLATED_ATTR, "pending");
      await translateOne(task, true);
    });
  }
}

function findExistingTranslation(textNode) {
  const next = textNode.nextElementSibling;
  if (next && next.classList?.contains(TRANSLATION_CLASS)) return next;
  return null;
}

function extractTweetText(container) {
  const raw = container.innerText || container.textContent || "";
  return raw.replace(/\s+\n/g, "\n").trim();
}

function extractPrimaryTweetContent(tweet) {
  const textNodes = findPrimaryTweetTextNodes(tweet);
  if (textNodes.length === 0) return null;

  const parts = [];
  const seen = new Set();
  for (const node of textNodes) {
    const text = extractTweetText(node);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    parts.push(text);
  }

  const text = parts.join("\n\n").trim();
  if (!text) return null;

  return {
    textNode: textNodes[textNodes.length - 1],
    text
  };
}

function findPrimaryTweetTextNodes(tweet) {
  const candidates = [];

  const add = (node) => {
    if (!node || !tweet.contains(node)) return;
    if (isQuotedTweetNode(tweet, node)) return;
    if (candidates.some((item) => item === node || item.contains(node))) return;

    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      if (node.contains(candidates[i])) candidates.splice(i, 1);
    }
    candidates.push(node);
  };

  tweet.querySelectorAll(TEXT_SELECTOR).forEach(add);
  tweet.querySelectorAll(LONG_TEXT_SELECTOR).forEach(add);
  tweet.querySelectorAll(LONG_TEXT_CONTAINER_SELECTOR).forEach((container) => {
    const langBlocks = container.matches("[lang]")
      ? [container]
      : Array.from(container.querySelectorAll("[lang]"));
    langBlocks.forEach(add);
  });

  if (candidates.length === 0) {
    tweet.querySelectorAll("[lang]").forEach((node) => {
      const text = extractTweetText(node);
      if (text.length < 20) return;
      if (node.closest('[data-testid="User-Name"], [role="button"], time')) return;
      add(node);
    });
  }

  return candidates;
}

function isQuotedTweetNode(tweet, node) {
  const quoteLink = node.closest('[role="link"]');
  if (!quoteLink || !tweet.contains(quoteLink)) return false;
  if (quoteLink.querySelector(TEXT_SELECTOR) !== node && !quoteLink.contains(node)) return false;
  return !!quoteLink.querySelector('[data-testid="User-Name"]');
}

function shouldTranslate(text) {
  if (!text || text.length < 2) return false;

  const stripped = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[@#$][\w\u4e00-\u9fff]+/g, "")
    .replace(/[\p{Emoji}\p{Emoji_Component}\p{Extended_Pictographic}]/gu, "")
    .replace(/[\u200B-\u200D\uFE0F\uFEFF]/g, "")
    .replace(/\s+/g, "");

  if (stripped.length < 3) return false;

  const cjk = stripped.match(/[\u3400-\u9fff]/g)?.length || 0;
  const latin = stripped.match(/[A-Za-z\u00c0-\u024f]/g)?.length || 0;
  const cyrillic = stripped.match(/[\u0400-\u04ff]/g)?.length || 0;
  const kana = stripped.match(/[\u3040-\u30ff]/g)?.length || 0;
  const hangul = stripped.match(/[\uac00-\ud7af]/g)?.length || 0;

  const nonCjkLetters = latin + cyrillic + kana + hangul;
  if (cjk === 0 && nonCjkLetters === 0) return false;

  const targetIsChinese = /^zh/i.test(state.translate.targetLanguage || "");
  if (targetIsChinese) {
    if (cjk >= 3 && cjk >= nonCjkLetters) return false;
    if (cjk > 0 && cjk / (cjk + nonCjkLetters) >= 0.5) return false;
  } else {
    if (cjk > 0 && cjk / (cjk + nonCjkLetters) >= 0.7) return false;
  }
  return true;
}

function clearAllTranslations() {
  document.querySelectorAll(`.${TRANSLATION_CLASS}`).forEach((el) => el.remove());
  document.querySelectorAll(`[${TRANSLATED_ATTR}]`).forEach((el) => {
    el.removeAttribute(TRANSLATED_ATTR);
    if (viewportObserver) viewportObserver.unobserve(el);
  });
  queue.length = 0;
}


/* =========================================================================
 *  回复：注入按钮 / 草稿面板 / 填入 X 编辑器
 * ========================================================================= */

function findActionBar(tweet) {
  const replyBtn = tweet.querySelector('[data-testid="reply"]');
  if (replyBtn) {
    const bar = replyBtn.closest('[role="group"]');
    if (bar) return bar;
  }
  const likeBtn = tweet.querySelector('[data-testid="like"], [data-testid="unlike"]');
  if (likeBtn) {
    const bar = likeBtn.closest('[role="group"]');
    if (bar) return bar;
  }
  return null;
}

function attachReplyButton(tweet) {
  if (!tweet || !tweet.isConnected) return;

  const content = extractPrimaryTweetContent(tweet);
  if (!content) return;

  const actionBar = findActionBar(tweet);
  if (!actionBar) return;

  if (tweet.getAttribute(REPLY_BTN_ATTR) === "1" && actionBar.querySelector(`.${REPLY_BTN_CLASS}`)) {
    return;
  }
  tweet.setAttribute(REPLY_BTN_ATTR, "1");

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = REPLY_BTN_CLASS;
  btn.textContent = "AI 回";
  btn.title = "生成回复草稿（不自动发送）";
  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    event.preventDefault();
    toggleReplyPanel(tweet);
  });

  // hover 预热：鼠标停在按钮上 200ms 后给后台发一个空 ping，
  // 触发 service worker 冷启动 + provider TLS 预连。
  // 用户接下来点击时，SW 已经醒了，省掉 ~100~300ms 冷启动延迟。
  let warmTimer = null;
  btn.addEventListener("mouseenter", () => {
    if (warmTimer) return;
    warmTimer = setTimeout(() => {
      warmTimer = null;
      try { chrome.runtime.sendMessage({ type: "warmUp" }).catch(() => {}); } catch (_e) { /* ignore */ }
    }, 200);
  });
  btn.addEventListener("mouseleave", () => {
    if (warmTimer) { clearTimeout(warmTimer); warmTimer = null; }
  });

  actionBar.appendChild(btn);
}

function toggleReplyPanel(tweet) {
  const existing = tweet.querySelector(`.${REPLY_PANEL_CLASS}`);
  if (existing) {
    existing.remove();
    return;
  }

  const content = extractPrimaryTweetContent(tweet);
  if (!content) return;

  const { textNode, text: tweetText } = content;
  if (!tweetText) return;

  const author = extractAuthor(tweet);
  const language = detectReplyLanguage(tweetText);

  // 合并版联动 1：把已生成的译文也送给模型，帮助理解原推
  const translation = extractTranslationForReply(tweet);
  // 合并版联动 2：被引用推文（quote tweet）的内容，给模型完整上下文
  const quoted = extractQuotedTweet(tweet, textNode);

  const panel = buildReplyPanel({ tweet, tweetText, author, language, translation, quoted });
  const actionBar = findActionBar(tweet);
  if (actionBar && actionBar.parentElement) {
    actionBar.parentElement.insertAdjacentElement("afterend", panel);
  } else {
    textNode.insertAdjacentElement("afterend", panel);
  }
}

/**
 * 如果这条推文已经被翻译模块翻过，返回译文文本。
 * 状态可能是 done（成功）或 error（失败）—— 失败的不返回。
 */
function extractTranslationForReply(tweet) {
  const block = tweet.querySelector(`.${TRANSLATION_CLASS}`);
  if (!block) return "";
  if (block.getAttribute("data-state") !== "ok") return "";
  const textEl = block.querySelector(`.${TRANSLATION_CLASS}-text`);
  return (textEl?.textContent || "").trim();
}

/**
 * 提取被引用推文（quote tweet）。
 * X 的 DOM 结构：当前推 article 里如果有 quote，会嵌套一个 [role="link"]，
 * 里面包含被引推的 User-Name 和 tweetText。
 * 用"第二个 tweetText"作为定位锚点，找到它所在的 quote 容器，再回头取作者。
 */
function extractQuotedTweet(tweet, currentTextNode) {
  const allTexts = tweet.querySelectorAll(TEXT_SELECTOR);
  if (allTexts.length < 2) return null;

  // 第一个是当前推自己；找一个不是当前推的 tweetText
  let quotedTextNode = null;
  for (const node of allTexts) {
    if (node !== currentTextNode && !currentTextNode.contains(node) && !node.contains(currentTextNode)) {
      quotedTextNode = node;
      break;
    }
  }
  if (!quotedTextNode) return null;

  const text = (quotedTextNode.innerText || "").trim();
  if (!text) return null;

  // 引文容器：通常是包裹 quote 的 [role="link"]
  const container = quotedTextNode.closest('[role="link"]') || quotedTextNode.parentElement;
  let author = "";
  if (container) {
    const userBlock = container.querySelector('[data-testid="User-Name"]');
    if (userBlock) {
      const link = userBlock.querySelector('a[href^="/"]');
      const handle = ((link?.getAttribute("href") || "").replace(/^\/+/, "").split("/")[0] || "").toLowerCase();
      if (handle && !/^(i|status|home|explore|notifications|messages|search|compose)$/.test(handle)) {
        author = handle;
      }
    }
  }
  return { text, author };
}

function buildReplyPanel({ tweet, tweetText, author, language, translation, quoted }) {
  const panel = document.createElement("div");
  panel.className = REPLY_PANEL_CLASS;
  panel.setAttribute("dir", "auto");

  // 上下文徽章：显示模型这次能看到哪些额外信号（译文 / 引文）
  const contextBadges = [];
  if (translation) contextBadges.push(`<span class="xh-ctx" title="模型会读到这条推的中文译文">📖 已带译文</span>`);
  if (quoted) {
    const tag = quoted.author ? `@${quoted.author}` : "引文";
    contextBadges.push(`<span class="xh-ctx" title="模型会读到被引用推文：${escapeHtml(quoted.text)}">↳ ${escapeHtml(tag)}</span>`);
  }
  const badgesHtml = contextBadges.length > 0
    ? `<div class="xh-ctx-row">${contextBadges.join("")}</div>`
    : "";

  // 语气 chips：与人设正交，决定整体倾向
  const currentToneId = state.reply.lastToneId || "neutral";
  const toneChipsHtml = TONES.map((t) => `
    <button type="button" class="xh-tone${t.id === currentToneId ? " is-active" : ""}" data-tone="${t.id}" title="${escapeHtml(t.desc)}">${t.name}</button>
  `).join("");

  panel.innerHTML = `
    <div class="xh-row">
      <label class="xh-label">人设</label>
      <select class="xh-persona"></select>
      <span class="xh-lang">${LANG_LABEL[language] || language}</span>
      <button type="button" class="xh-close" title="关闭">×</button>
    </div>
    <div class="xh-row xh-tone-row">
      <label class="xh-label">语气</label>
      <div class="xh-tones">${toneChipsHtml}</div>
    </div>
    ${badgesHtml}
    <textarea class="xh-extra" rows="1" placeholder="（可选）本条回复的额外要求，例如：带一点反问 / 贴一个具体例子"></textarea>
    <div class="xh-row">
      <button type="button" class="xh-generate">生成 3 条</button>
      <button type="button" class="xh-regenerate xh-secondary" disabled>再来一组</button>
    </div>
    <div class="xh-results"></div>
    <div class="xh-hint">生成结果只进草稿，不会自动发送。点"复制并填入"后，X 的回复编辑器会打开，文本同时进剪贴板和编辑器，你可以继续修改再发。<br>快捷键：Alt+R 切换面板 · Alt+T 折叠译文 · Esc 关闭。</div>
  `;

  const personaSelect = panel.querySelector(".xh-persona");
  renderPersonaOptions(personaSelect);

  // 语气 chips 单选行为
  const toneButtons = Array.from(panel.querySelectorAll(".xh-tone"));
  toneButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      toneButtons.forEach((b) => b.classList.toggle("is-active", b === btn));
      const toneId = btn.dataset.tone;
      state.reply.lastToneId = toneId;
      chrome.storage.sync.set({ reply: { ...state.reply, lastToneId: toneId } });
    });
  });

  const genBtn = panel.querySelector(".xh-generate");
  const regenBtn = panel.querySelector(".xh-regenerate");
  const extraInput = panel.querySelector(".xh-extra");
  const results = panel.querySelector(".xh-results");

  // 当前生成请求的 port，用于"取消生成"
  let activePort = null;

  const setGenerating = (isGenerating) => {
    if (isGenerating) {
      genBtn.textContent = "取消生成";
      genBtn.classList.add("xh-cancel");
      regenBtn.disabled = true;
    } else {
      genBtn.textContent = "生成 3 条";
      genBtn.classList.remove("xh-cancel");
      regenBtn.disabled = false;
    }
  };

  const cancelActive = () => {
    if (activePort) {
      try { activePort.disconnect(); } catch (_e) { /* ignore */ }
      activePort = null;
    }
  };

  const run = () => {
    // 已经在跑 → 这次点击是"取消"
    if (activePort) {
      cancelActive();
      results.innerHTML = '<div class="xh-error">已取消</div>';
      setGenerating(false);
      return;
    }

    const personaId = personaSelect.value;
    state.reply.lastPersonaId = personaId;
    chrome.storage.sync.set({ reply: { ...state.reply, lastPersonaId: personaId } });

    setGenerating(true);
    results.innerHTML = '<div class="xh-loading">生成中…（再点一次按钮可取消）</div>';

    let port;
    try {
      port = chrome.runtime.connect({ name: "xh-generate" });
    } catch (error) {
      results.innerHTML = `<div class="xh-error">生成失败：${escapeHtml(error.message || "无法连接后台")}</div>`;
      setGenerating(false);
      return;
    }
    activePort = port;

    port.onMessage.addListener((response) => {
      if (port !== activePort) return; // 已被取消，忽略迟到的消息
      activePort = null;
      if (!response) {
        results.innerHTML = `<div class="xh-error">生成失败：后台无响应</div>`;
      } else if (response.cancelled) {
        results.innerHTML = '<div class="xh-error">已取消</div>';
      } else if (!response.ok) {
        results.innerHTML = `<div class="xh-error">生成失败：${escapeHtml(response.error || "未知错误")}</div>`;
      } else {
        renderReplyResults(results, response.replies, tweet, language);
      }
      setGenerating(false);
      try { port.disconnect(); } catch (_e) { /* ignore */ }
    });

    port.onDisconnect.addListener(() => {
      // 后台主动 disconnect（极少发生），如果还是当前 port 就视为取消
      if (port === activePort) {
        activePort = null;
        results.innerHTML = '<div class="xh-error">连接断开</div>';
        setGenerating(false);
      }
    });

    port.postMessage({
      type: "generateReplies",
      tweetText, author, language, personaId,
      toneId: state.reply.lastToneId || "neutral",
      translation: translation || "",
      quoted: quoted || null,
      extraInstruction: extraInput.value,
      count: 3
    });
  };

  genBtn.addEventListener("click", run);
  regenBtn.addEventListener("click", run);

  // 面板被关闭时既要取消请求也要移除 DOM
  panel.querySelector(".xh-close").addEventListener("click", () => {
    cancelActive();
    panel.remove();
  });

  return panel;
}

function renderPersonaOptions(select) {
  select.innerHTML = "";
  const list = state.personas && state.personas.length > 0 ? state.personas : [{ id: "default", name: "默认" }];
  for (const p of list) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    if (p.id === state.reply.lastPersonaId) opt.selected = true;
    select.appendChild(opt);
  }
}

function renderReplyResults(container, replies, tweet, sourceLanguage) {
  container.innerHTML = "";
  // 非中文回复时，每条额外加一行中文译注（懒加载）
  const needGloss = sourceLanguage && sourceLanguage !== "zh";

  replies.forEach((reply, idx) => {
    const weight = twitterWeightedLength(reply);
    const overLimit = weight > 270;

    const item = document.createElement("div");
    item.className = "xh-item";
    item.innerHTML = `
      <div class="xh-item-head">
        <span class="xh-item-index">#${idx + 1}</span>
        <span class="xh-item-count ${overLimit ? "is-over" : ""}" title="X 字数权重（中文 ×2，其他 ×1，上限 280）">${weight} / 270</span>
      </div>
      <div class="xh-item-text"></div>
      ${needGloss ? '<div class="xh-item-gloss" data-state="loading">中：翻译中…</div>' : ""}
      <div class="xh-item-actions">
        <button type="button" class="xh-copy xh-secondary">复制</button>
        <button type="button" class="xh-fill">复制并填入</button>
      </div>
    `;
    item.querySelector(".xh-item-text").textContent = reply;

    item.querySelector(".xh-copy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(reply);
        flashButton(item.querySelector(".xh-copy"), "已复制");
      } catch (_error) {
        flashButton(item.querySelector(".xh-copy"), "复制失败");
      }
    });

    item.querySelector(".xh-fill").addEventListener("click", async () => {
      const btn = item.querySelector(".xh-fill");
      btn.disabled = true;
      btn.textContent = "处理中…";

      // 先尝试复制到剪贴板。即使后面填入失败，剪贴板里也有了。
      let copied = false;
      try {
        await navigator.clipboard.writeText(reply);
        copied = true;
      } catch (_e) {
        /* 忽略，继续尝试填入 */
      }

      try {
        await fillReply(tweet, reply);
        btn.textContent = copied ? "已复制并填入" : "已填入";
      } catch (error) {
        btn.textContent = copied ? "仅复制成功" : "失败";
        console.warn("[xh] fillReply error", error);
      } finally {
        setTimeout(() => {
          btn.disabled = false;
          btn.textContent = "复制并填入";
        }, 1600);
      }
    });

    container.appendChild(item);
  });

  // 非中文回复 → 一次性 batch 翻译，后台并行 fan out（比 3 次串行 sendMessage 快很多）
  if (needGloss) {
    const items = Array.from(container.querySelectorAll(".xh-item"));
    chrome.runtime.sendMessage({
      type: "translateBatch",
      texts: replies,
      targetLanguage: "zh-CN",
      forceRefresh: false
    }).then((response) => {
      if (!response?.ok || !Array.isArray(response.results)) {
        // batch 整体失败，把所有 loading 行收掉
        items.forEach((it) => it.querySelector(".xh-item-gloss")?.remove());
        return;
      }
      response.results.forEach((res, i) => {
        const glossEl = items[i]?.querySelector(".xh-item-gloss");
        if (!glossEl || !glossEl.isConnected) return;
        if (res?.ok && res.translatedText) {
          glossEl.dataset.state = "ok";
          glossEl.textContent = `中：${res.translatedText}`;
        } else {
          glossEl.remove();
        }
      });
    }).catch(() => {
      const all = container.querySelectorAll(".xh-item-gloss");
      all.forEach((el) => el.remove());
    });
  }
}

async function fillReply(tweet, text) {
  const replyBtn = tweet.querySelector('[data-testid="reply"]');
  if (replyBtn) replyBtn.click();

  const editor = await waitForComposer(5000);
  if (!editor) throw new Error("没找到 X 的回复编辑器，可能是页面结构变了");

  editor.focus();
  try {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand("delete", false, null);
  } catch (_error) {
    /* ignore */
  }

  const ok = document.execCommand("insertText", false, text);
  if (ok) return;

  try {
    editor.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true, cancelable: true, inputType: "insertText", data: text
    }));
    editor.dispatchEvent(new InputEvent("input", {
      bubbles: true, cancelable: false, inputType: "insertText", data: text
    }));
  } catch (_error) {
    editor.textContent = text;
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function waitForComposer(timeoutMs) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const el =
        document.querySelector('[data-testid="tweetTextarea_0"]') ||
        document.querySelector('div[role="textbox"][contenteditable="true"]');
      if (el) return resolve(el);
      if (Date.now() - start > timeoutMs) return resolve(null);
      requestAnimationFrame(tick);
    };
    tick();
  });
}

function extractAuthor(tweet) {
  const userLink = tweet.querySelector('[data-testid="User-Name"] a[href^="/"]');
  if (userLink) {
    const href = userLink.getAttribute("href") || "";
    const handle = (href.replace(/^\/+/, "").split("/")[0] || "").toLowerCase();
    if (handle && !/^(i|status|home|explore|notifications|messages|search|compose)$/.test(handle)) {
      return handle;
    }
  }
  const links = tweet.querySelectorAll('a[role="link"][href^="/"]');
  for (const a of links) {
    const handle = ((a.getAttribute("href") || "").replace(/^\/+/, "").split("/")[0] || "").toLowerCase();
    if (handle && !/^(i|status|home|explore|notifications|messages|search|compose)$/.test(handle)) {
      return handle;
    }
  }
  return "";
}

/* ---------- 共享纯函数：从 shared-utils.js 引入 ----------
 * detectReplyLanguage / LANG_LABEL / twitterWeight* / escapeHtml 之前都在这里定义，
 * 现在移到 shared-utils.js 单一来源。这里只做本地别名，避免改动调用点。
 */
const detectReplyLanguage = self.detectLanguage;
const LANG_LABEL = Object.fromEntries(Object.entries(self.LANGS || {}).map(([k, v]) => [k, v.label]));
const twitterWeight = self.twitterWeight;
const twitterWeightedLength = self.twitterWeightedLength;
const escapeHtml = self.escapeHtml;

function flashButton(btn, msg) {
  const prev = btn.textContent;
  btn.textContent = msg;
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = prev;
    btn.disabled = false;
  }, 1200);
}

/* ---------- X 字数权重 / escapeHtml 已迁到 shared-utils.js（顶部别名声明） ---------- */


/* =========================================================================
 *  样式注入（合并版：翻译块 + 回复按钮 + 回复面板）
 * ========================================================================= */
function injectStyles() {
  if (document.getElementById("xh-style")) return;
  const style = document.createElement("style");
  style.id = "xh-style";
  style.textContent = `
    /* ---------- 翻译块 ---------- */
    .${TRANSLATION_CLASS} {
      margin-top: 8px;
      padding: 8px 10px;
      border-left: 3px solid #1d9bf0;
      background: rgba(29, 155, 240, 0.08);
      color: inherit;
      font-size: 15px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
      border-radius: 4px;
      position: relative;
    }
    .${TRANSLATION_CLASS}[data-state="loading"] { opacity: 0.65; font-style: italic; }
    .${TRANSLATION_CLASS}[data-state="error"] {
      border-left-color: #f4212e;
      background: rgba(244, 33, 46, 0.08);
    }
    .${TRANSLATION_CLASS}[data-collapsed="true"] .${TRANSLATION_CLASS}-text,
    .${TRANSLATION_CLASS}[data-collapsed="true"] .${TRANSLATION_CLASS}-tools {
      display: none;
    }
    .${TRANSLATION_CLASS}[data-collapsed="true"] { padding: 4px 10px; opacity: 0.7; }
    .${TRANSLATION_CLASS}-label {
      display: inline-block;
      margin-right: 6px;
      padding: 0 6px;
      border-radius: 3px;
      background: #1d9bf0;
      color: #fff;
      font-size: 11px;
      line-height: 16px;
      vertical-align: middle;
      cursor: pointer;
      user-select: none;
    }
    .${TRANSLATION_CLASS}-label:hover { background: #1a8cd8; }
    .${TRANSLATION_CLASS}-provider { display: none; }
    .${TRANSLATION_CLASS}[data-state="error"] .${TRANSLATION_CLASS}-label { background: #f4212e; }
    .${TRANSLATION_CLASS}-tools {
      display: inline-flex;
      gap: 6px;
      margin-left: 8px;
      vertical-align: middle;
    }
    .${TRANSLATION_CLASS}-btn {
      padding: 1px 7px;
      border: 0;
      border-radius: 10px;
      background: rgba(0, 0, 0, 0.05);
      color: #536471;
      font: inherit;
      font-size: 11px;
      line-height: 16px;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease;
    }
    .${TRANSLATION_CLASS}:hover .${TRANSLATION_CLASS}-btn { opacity: 1; }
    .${TRANSLATION_CLASS}-btn:hover { background: rgba(29, 155, 240, 0.15); color: #1d9bf0; }
    .${TRANSLATION_CLASS}-btn.is-success { background: rgba(0, 186, 124, 0.15); color: #00ba7c; }
    .${TRANSLATION_CLASS}-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    /* ---------- AI 回 按钮 ---------- */
    .${REPLY_BTN_CLASS} {
      margin-left: auto;
      padding: 2px 10px;
      border: 1px solid rgba(29, 155, 240, 0.45);
      border-radius: 999px;
      background: transparent;
      color: #1d9bf0;
      font-size: 12px;
      line-height: 20px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .${REPLY_BTN_CLASS}:hover { background: rgba(29, 155, 240, 0.1); }

    /* ---------- 回复草稿面板 ---------- */
    .${REPLY_PANEL_CLASS} {
      margin: 6px 12px 12px;
      padding: 10px 12px;
      border: 1px solid rgba(29, 155, 240, 0.3);
      border-radius: 10px;
      background: rgba(29, 155, 240, 0.06);
      color: inherit;
      font-size: 14px;
      line-height: 1.45;
    }
    .${REPLY_PANEL_CLASS} .xh-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .${REPLY_PANEL_CLASS} .xh-label { font-size: 12px; color: #8b98a5; }
    .${REPLY_PANEL_CLASS} .xh-persona {
      flex: 0 0 auto;
      min-width: 120px;
      padding: 4px 8px;
      border: 1px solid #cfd9de;
      border-radius: 6px;
      background: #fff;
      color: #0f1419;
      font: inherit;
    }
    .${REPLY_PANEL_CLASS} .xh-lang {
      font-size: 12px;
      color: #536471;
      padding: 2px 8px;
      border-radius: 4px;
      background: rgba(139, 152, 165, 0.15);
    }
    .${REPLY_PANEL_CLASS} .xh-tone-row { margin-bottom: 8px; }
    .${REPLY_PANEL_CLASS} .xh-tones {
      display: inline-flex;
      gap: 4px;
      flex-wrap: wrap;
    }
    .${REPLY_PANEL_CLASS} button.xh-tone {
      padding: 2px 10px;
      border: 1px solid rgba(29, 155, 240, 0.3);
      border-radius: 999px;
      background: transparent;
      color: #536471;
      font: inherit;
      font-size: 12px;
      line-height: 18px;
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    }
    .${REPLY_PANEL_CLASS} button.xh-tone:hover {
      background: rgba(29, 155, 240, 0.08);
      color: #1d9bf0;
    }
    .${REPLY_PANEL_CLASS} button.xh-tone.is-active {
      background: #1d9bf0;
      border-color: #1d9bf0;
      color: #fff;
    }
    .${REPLY_PANEL_CLASS} .xh-close {
      margin-left: auto;
      width: 24px;
      height: 24px;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: #8b98a5;
      font-size: 18px;
      line-height: 20px;
      cursor: pointer;
    }
    .${REPLY_PANEL_CLASS} .xh-close:hover { background: rgba(139, 152, 165, 0.2); }
    .${REPLY_PANEL_CLASS} .xh-extra {
      width: 100%;
      min-height: 32px;
      padding: 6px 8px;
      margin-bottom: 8px;
      border: 1px solid #cfd9de;
      border-radius: 6px;
      background: #fff;
      color: #0f1419;
      font: inherit;
      resize: vertical;
    }
    .${REPLY_PANEL_CLASS} .xh-ctx-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 8px;
    }
    .${REPLY_PANEL_CLASS} .xh-ctx {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      font-size: 11px;
      line-height: 16px;
      color: #1d9bf0;
      background: rgba(29, 155, 240, 0.12);
      border-radius: 999px;
      max-width: 200px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      cursor: help;
    }
    .${REPLY_PANEL_CLASS} button.xh-generate,
    .${REPLY_PANEL_CLASS} button.xh-regenerate,
    .${REPLY_PANEL_CLASS} button.xh-fill,
    .${REPLY_PANEL_CLASS} button.xh-copy {
      padding: 6px 14px;
      border: 0;
      border-radius: 999px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    .${REPLY_PANEL_CLASS} button.xh-generate,
    .${REPLY_PANEL_CLASS} button.xh-fill {
      color: #fff;
      background: #1d9bf0;
    }
    .${REPLY_PANEL_CLASS} button.xh-generate:hover,
    .${REPLY_PANEL_CLASS} button.xh-fill:hover { background: #1a8cd8; }
    .${REPLY_PANEL_CLASS} button.xh-generate.xh-cancel {
      background: #f4212e;
    }
    .${REPLY_PANEL_CLASS} button.xh-generate.xh-cancel:hover {
      background: #d91e2a;
    }
    .${REPLY_PANEL_CLASS} button.xh-secondary {
      color: #0f1419;
      background: #eff3f4;
    }
    .${REPLY_PANEL_CLASS} button.xh-secondary:hover { background: #dfe7ea; }
    .${REPLY_PANEL_CLASS} button:disabled { opacity: 0.55; cursor: not-allowed; }

    .${REPLY_PANEL_CLASS} .xh-results {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 8px;
    }
    .${REPLY_PANEL_CLASS} .xh-item {
      padding: 8px 10px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.6);
      border: 1px solid rgba(207, 217, 222, 0.8);
    }
    .${REPLY_PANEL_CLASS} .xh-item-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 4px;
    }
    .${REPLY_PANEL_CLASS} .xh-item-index { font-size: 11px; color: #8b98a5; }
    .${REPLY_PANEL_CLASS} .xh-item-count {
      font-size: 11px;
      color: #8b98a5;
      font-variant-numeric: tabular-nums;
      cursor: help;
    }
    .${REPLY_PANEL_CLASS} .xh-item-count.is-over {
      color: #f4212e;
      font-weight: 700;
    }
    .${REPLY_PANEL_CLASS} .xh-item-text {
      white-space: pre-wrap;
      word-break: break-word;
      margin-bottom: 8px;
      color: #0f1419;
    }
    .${REPLY_PANEL_CLASS} .xh-item-gloss {
      margin: -4px 0 8px;
      padding: 6px 8px;
      border-left: 2px solid rgba(29, 155, 240, 0.4);
      background: rgba(29, 155, 240, 0.05);
      border-radius: 0 4px 4px 0;
      color: #536471;
      font-size: 12px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .${REPLY_PANEL_CLASS} .xh-item-gloss[data-state="loading"] {
      opacity: 0.6;
      font-style: italic;
    }
    .${REPLY_PANEL_CLASS} .xh-item-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
    .${REPLY_PANEL_CLASS} .xh-loading {
      padding: 12px;
      text-align: center;
      color: #536471;
      font-style: italic;
    }
    .${REPLY_PANEL_CLASS} .xh-error {
      padding: 8px 10px;
      border-radius: 6px;
      background: rgba(244, 33, 46, 0.1);
      border-left: 3px solid #f4212e;
      color: #b00020;
    }
    .${REPLY_PANEL_CLASS} .xh-hint {
      margin-top: 8px;
      font-size: 11px;
      color: #8b98a5;
    }

    @media (prefers-color-scheme: dark) {
      .${TRANSLATION_CLASS} {
        background: rgba(29, 155, 240, 0.12);
        border-left-color: #1d9bf0;
      }
      .${TRANSLATION_CLASS}[data-state="error"] { background: rgba(244, 33, 46, 0.15); }
      .${TRANSLATION_CLASS}-btn { background: rgba(255, 255, 255, 0.08); color: #8b98a5; }
      .${TRANSLATION_CLASS}-btn:hover { background: rgba(29, 155, 240, 0.25); color: #71c1f5; }

      .${REPLY_PANEL_CLASS} { background: rgba(29, 155, 240, 0.08); }
      .${REPLY_PANEL_CLASS} .xh-persona,
      .${REPLY_PANEL_CLASS} .xh-extra {
        background: #15202b;
        color: #e7e9ea;
        border-color: #2f3336;
      }
      .${REPLY_PANEL_CLASS} .xh-item {
        background: rgba(21, 32, 43, 0.6);
        border-color: #2f3336;
      }
      .${REPLY_PANEL_CLASS} .xh-item-text { color: #e7e9ea; }
      .${REPLY_PANEL_CLASS} .xh-item-gloss {
        background: rgba(29, 155, 240, 0.08);
        color: #8b98a5;
      }
      .${REPLY_PANEL_CLASS} button.xh-secondary { color: #e7e9ea; background: #273340; }
      .${REPLY_PANEL_CLASS} button.xh-secondary:hover { background: #324254; }
    }
  `;
  document.head.appendChild(style);
}
