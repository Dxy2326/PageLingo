/* eslint-disable no-undef */

try { importScripts("shared-utils.js"); } catch (_e) { /* 缺失会让所有功能失效，启动时会报错给用户 */ }
try { importScripts("secrets.js"); } catch (_e) { self.HELPER_DEEPSEEK_API_KEY = ""; }
try { importScripts("personas.js"); } catch (_e) { self.DEFAULT_PERSONAS = []; }
try { importScripts("providers.js"); } catch (_e) {
  self.PROVIDERS = [];
  self.getProvider = () => null;
  self.getTranslateProviders = () => [];
  self.getReplyProviders = () => [];
}

/* =========================================================================
 *  存储 schema（合并版）
 *  - providerConfigs：所有供应商的凭据（{[id]: { apiKey, model, baseUrl }}）
 *      由翻译和回复共享，避免同一个 Key 填两遍。
 *  - translate.{ enabled, providerId, targetLanguage }
 *  - reply.{ providerId, lastPersonaId }
 *  - personas：人设列表
 * ========================================================================= */

const STORAGE_KEYS = {
  providerConfigs: "providerConfigs",
  translate: "translate",
  reply: "reply",
  personas: "personas"
};

const DEFAULT_TRANSLATE = {
  enabled: true,
  providerId: "google",
  targetLanguage: "zh-CN"
};

const DEFAULT_REPLY = {
  providerId: "deepseek",
  lastPersonaId: "crypto-og"
};

const DEFAULT_SETTINGS = {
  [STORAGE_KEYS.providerConfigs]: {},
  [STORAGE_KEYS.translate]: DEFAULT_TRANSLATE,
  [STORAGE_KEYS.reply]: DEFAULT_REPLY,
  [STORAGE_KEYS.personas]: []
};

// 翻译目标语言 → 母语名映射，从 shared-utils.js 引入；若 shared-utils.js 没加载，回退一个最小集合
const LANGUAGE_NAMES = self.TRANSLATE_LANGUAGE_NAMES || {
  "zh-CN": "简体中文", "zh-TW": "繁體中文", ja: "日本語", ko: "한국어", en: "English"
};

chrome.runtime.onInstalled.addListener(async () => {
  await migrateLegacySettings();
  await mergeDefaultPersonas();
  // 安装 / 更新后立即预热当前选中的 provider，提升首次点击 AI 回的速度
  warmUpSelectedProviders();
});

// service worker 每次冷启动都跑一次（onInstalled 不会触发非首次启动）
warmUpSelectedProviders();

/**
 * 把 DEFAULT_PERSONAS 里 ID 不存在的人设追加到用户的 personas，
 * 不会动用户改过的或自定义的人设。首次安装时也走这条路径。
 */
async function mergeDefaultPersonas() {
  const stored = await chrome.storage.sync.get([STORAGE_KEYS.personas]);
  const current = Array.isArray(stored.personas) ? stored.personas : [];
  const defaults = self.DEFAULT_PERSONAS || [];
  const existingIds = new Set(current.map((p) => p.id));
  const additions = defaults.filter((p) => !existingIds.has(p.id));
  if (additions.length === 0 && current.length > 0) return;
  await chrome.storage.sync.set({
    personas: current.length === 0 ? defaults : [...current, ...additions]
  });
}

/**
 * 把两个旧插件的存储字段迁到合并版的新结构。
 * - 翻译旧版：{ enabled, provider, apiKey, apiBaseUrl, model, targetLanguage }
 * - 回复旧版：{ providerId, providerConfigs, personas, lastPersonaId }
 */
async function migrateLegacySettings() {
  const stored = await chrome.storage.sync.get(null);
  const haveNew =
    stored[STORAGE_KEYS.translate] || stored[STORAGE_KEYS.reply] ||
    (stored[STORAGE_KEYS.providerConfigs] &&
      Object.keys(stored[STORAGE_KEYS.providerConfigs]).length > 0);
  if (haveNew) return;

  const providerConfigs = {};
  let translate = { ...DEFAULT_TRANSLATE };
  let reply = { ...DEFAULT_REPLY };

  // 翻译旧版
  if (stored.provider || stored.apiBaseUrl || stored.targetLanguage) {
    const oldProvider = stored.provider || "google";
    // 翻译旧 ID 映射到合并版 ID
    const map = { google: "google", deepseek: "deepseek", openai: "openai", claude: "anthropic", gemini: "gemini", custom: "custom" };
    const newId = map[oldProvider] || "google";
    translate = {
      enabled: typeof stored.enabled === "boolean" ? stored.enabled : true,
      providerId: newId,
      targetLanguage: stored.targetLanguage || "zh-CN"
    };
    if (newId !== "google" && stored.apiKey) {
      providerConfigs[newId] = {
        apiKey: stored.apiKey,
        model: stored.model || "",
        baseUrl: stored.apiBaseUrl || ""
      };
    }
  }

  // 回复旧版（如果两边在同一个浏览器装过）
  if (stored.providerConfigs && typeof stored.providerConfigs === "object") {
    for (const [pid, cfg] of Object.entries(stored.providerConfigs)) {
      if (!providerConfigs[pid]) providerConfigs[pid] = cfg;
    }
  }
  if (stored.providerId) {
    reply = {
      providerId: stored.providerId,
      lastPersonaId: stored.lastPersonaId || "crypto-og"
    };
  }

  await chrome.storage.sync.set({
    [STORAGE_KEYS.providerConfigs]: providerConfigs,
    [STORAGE_KEYS.translate]: translate,
    [STORAGE_KEYS.reply]: reply
  });
}

/* =========================================================================
 *  消息分发
 * ========================================================================= */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message?.type) {
    case "translateTweet":
      translateTweet(message.text, message.targetLanguage, message.forceRefresh, { profile: "x" })
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;

    case "translateText":
      translateTweet(message.text, message.targetLanguage, message.forceRefresh, {
        profile: message.profile || "web",
        url: message.url || ""
      })
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;

    case "translateBatch":
      translateBatch(message.texts, message.targetLanguage, message.forceRefresh, {
        profile: message.profile || "x",
        url: message.url || ""
      })
        .then((results) => sendResponse({ ok: true, results }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;

    case "generateReplies":
      generateReplies(message)
        .then((replies) => sendResponse({ ok: true, replies }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;

    case "testTranslate":
      testTranslate()
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;

    case "testReply":
      testReply()
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;

    case "listModels":
      listModels(message.providerId, message.apiKey, message.baseUrl)
        .then((models) => sendResponse({ ok: true, models }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;

    case "warmUp":
      // hover 预热的轻量 ping：唤醒 SW + 触发 TLS 预连。立即 ack，不等任何网络。
      warmUpSelectedProviders();
      sendResponse({ ok: true });
      return false;

    default:
      return false;
  }
});

/* =========================================================================
 *  生成回复的可取消通道：content script 通过 chrome.runtime.connect
 *  建立 port，发送 generateReplies 消息后，关闭 port 即取消请求。
 * ========================================================================= */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "xh-generate") return;

  const controller = new AbortController();
  let finished = false;

  port.onMessage.addListener((message) => {
    if (message?.type !== "generateReplies") return;
    generateReplies({ ...message, signal: controller.signal })
      .then((replies) => {
        if (finished) return;
        finished = true;
        try { port.postMessage({ ok: true, replies }); } catch (_e) { /* port closed */ }
      })
      .catch((error) => {
        if (finished) return;
        finished = true;
        const aborted = controller.signal.aborted || error?.name === "AbortError" || /aborted/i.test(error?.message || "");
        try {
          port.postMessage({
            ok: false,
            cancelled: aborted,
            error: aborted ? "已取消" : (error?.message || String(error))
          });
        } catch (_e) { /* port closed */ }
      });
  });

  port.onDisconnect.addListener(() => {
    if (finished) return;
    finished = true;
    controller.abort();
  });
});

/* =========================================================================
 *  Settings 内存缓存
 *  storage.sync.get 单次 100~300ms 抖动，是回复/翻译冷启动的主要瓶颈之一。
 *  service worker 内存缓存一份，storage.onChanged 触发失效。
 * ========================================================================= */
let rootCache = null;
let rootCachePromise = null;

async function getRoot() {
  if (rootCache) return rootCache;
  if (rootCachePromise) return rootCachePromise;
  rootCachePromise = chrome.storage.sync.get(DEFAULT_SETTINGS).then((r) => {
    rootCache = r;
    rootCachePromise = null;
    return r;
  }).catch((e) => {
    rootCachePromise = null;
    throw e;
  });
  return rootCachePromise;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !rootCache) return;
  // 把变更的键 patch 到内存里。删除走 newValue=undefined。
  for (const [key, { newValue }] of Object.entries(changes)) {
    if (newValue === undefined) delete rootCache[key];
    else rootCache[key] = newValue;
  }
  // 用户切换了 provider 或改了凭据时，重新预热
  if (changes[STORAGE_KEYS.translate] || changes[STORAGE_KEYS.reply] || changes[STORAGE_KEYS.providerConfigs]) {
    warmedHosts.clear();
    warmUpSelectedProviders();
  }
});

/* =========================================================================
 *  连接预热
 *  service worker 启动 / 用户切换 provider 后，发一次轻量请求让 TLS / DNS 暖起来。
 *  失败完全不影响功能（只是预热没成功）。
 * ========================================================================= */
const warmedHosts = new Set();
async function warmUpProvider(providerId) {
  if (!providerId || providerId === "google") return;
  try {
    const root = await getRoot();
    const cfg = (root[STORAGE_KEYS.providerConfigs] || {})[providerId] || {};
    const provider = self.getProvider(providerId);
    if (!provider) return;
    const baseUrl = (cfg.baseUrl || provider.baseUrl || "").replace(/\/+$/, "");
    if (!baseUrl) return;
    const host = new URL(baseUrl).host;
    if (warmedHosts.has(host)) return;
    warmedHosts.add(host);
    // OPTIONS 通常更轻量；多数 LLM 网关会返回 200 / 204 / 405 都行，关键是建立 TLS
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    try {
      await fetch(baseUrl, { method: "OPTIONS", signal: ctrl.signal, cache: "no-store" });
    } catch (_e) { /* ignore：连不上也不影响真正请求 */ }
    finally { clearTimeout(timer); }
  } catch (_e) { /* ignore */ }
}

/**
 * Service worker 启动时调一次（onInstalled + 首次 getRoot 后），
 * 把当前选中的回复 / 翻译 provider 都预热。
 */
async function warmUpSelectedProviders() {
  try {
    const root = await getRoot();
    const tProvider = (root[STORAGE_KEYS.translate] || DEFAULT_TRANSLATE).providerId;
    const rProvider = (root[STORAGE_KEYS.reply] || DEFAULT_REPLY).providerId;
    // 并行预热，不互相阻塞
    Promise.allSettled([warmUpProvider(tProvider), warmUpProvider(rProvider)]);
  } catch (_e) { /* ignore */ }
}

/**
 * 取某个 providerId 的实际配置（合并默认值 + 用户填的）。
 * 如果是 deepseek 且用户没填 Key，会回落到 secrets.js 里的 fallback Key。
 */
function resolveProviderConfig(providerId, providerConfigs) {
  const provider = self.getProvider(providerId);
  if (!provider) throw new Error(`未知供应商：${providerId}`);
  const cfg = (providerConfigs && providerConfigs[providerId]) || {};
  const fallbackKey = providerId === "deepseek" ? self.HELPER_DEEPSEEK_API_KEY || "" : "";
  return {
    provider,
    apiKey: cfg.apiKey || fallbackKey,
    model: cfg.model || provider.defaultModel,
    baseUrl: (cfg.baseUrl || provider.baseUrl || "").replace(/\/+$/, "")
  };
}


/* =========================================================================
 *  翻译模块
 * ========================================================================= */

const translateCache = new Map();
const MAX_CACHE_ENTRIES = 2000;
let cacheLoaded = false;
const inflightRequests = new Map();
let saveTimer = null;

loadCacheFromStorage();

async function loadCacheFromStorage() {
  try {
    const data = await chrome.storage.local.get("xhlpCache");
    const arr = data?.xhlpCache;
    if (Array.isArray(arr)) {
      for (const [k, v] of arr) translateCache.set(k, v);
    }
  } catch (_e) { /* ignore */ }
  cacheLoaded = true;
}

function saveCacheToStorage() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const arr = Array.from(translateCache.entries());
    chrome.storage.local.set({ xhlpCache: arr }).catch(() => {});
  }, 5000);
}

function trimCache() {
  if (translateCache.size <= MAX_CACHE_ENTRIES) return;
  let remove = translateCache.size - MAX_CACHE_ENTRIES;
  for (const key of translateCache.keys()) {
    translateCache.delete(key);
    remove -= 1;
    if (remove <= 0) break;
  }
}

async function translateTweet(text, targetLanguage, forceRefresh = false, options = {}) {
  const normalizedText = String(text || "").trim();
  if (!normalizedText) return { translatedText: "", providerLabel: "", fellBack: false };

  const root = await getRoot();
  const t = root[STORAGE_KEYS.translate] || DEFAULT_TRANSLATE;
  const providerConfigs = root[STORAGE_KEYS.providerConfigs] || {};

  const language = targetLanguage || t.targetLanguage || "zh-CN";
  const providerId = t.providerId || "google";
  const resolved = resolveProviderConfig(providerId, providerConfigs);
  const profile = normalizeTranslateProfile(options.profile, options.url);
  const cacheKey = `${providerId}:${resolved.model}:${language}:${profile}:${normalizedText}`;

  if (!cacheLoaded) await loadCacheFromStorage();
  if (!forceRefresh && translateCache.has(cacheKey)) return translateCache.get(cacheKey);
  if (!forceRefresh && inflightRequests.has(cacheKey)) return inflightRequests.get(cacheKey);

  const promise = doTranslate(normalizedText, language, providerId, resolved, cacheKey, profile);
  inflightRequests.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    inflightRequests.delete(cacheKey);
  }
}

/**
 * 批量翻译。content script 给一组文本 → 后台并行 fan out → 结果按原顺序返回。
 * 单条失败用 ok:false 报错占位，不影响其它条。
 */
async function translateBatch(texts, targetLanguage, forceRefresh = false, options = {}) {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const settled = await Promise.allSettled(
    texts.map((t) => translateTweet(t, targetLanguage, forceRefresh, options))
  );
  return settled.map((s) =>
    s.status === "fulfilled"
      ? { ok: true, ...s.value }
      : { ok: false, error: s.reason?.message || String(s.reason) }
  );
}

async function doTranslate(text, language, providerId, resolved, cacheKey, profile = "x") {
  let translated = "";
  let actualProvider = providerId;
  let actualModel = resolved.model || "";
  let fellBack = false;

  try {
    if (providerId === "google") {
      translated = await translateWithGoogle(text, language);
      actualModel = "";
    } else if (!resolved.apiKey) {
      // 没填 Key 自动降级到 Google
      translated = await translateWithGoogle(text, language);
      actualProvider = "google";
      actualModel = "";
      fellBack = true;
    } else if (resolved.provider.api === "anthropic") {
      translated = await translateWithClaude(text, language, resolved, profile);
    } else {
      translated = await translateWithOpenAICompat(text, language, resolved, profile);
    }
  } catch (error) {
    if (providerId !== "google") {
      translated = await translateWithGoogle(text, language);
      actualProvider = "google";
      actualModel = "";
      fellBack = true;
    } else {
      throw error;
    }
  }

  translated = postProcessTranslation(translated, text);
  if (isRefusal(translated)) translated = "";

  const result = {
    translatedText: translated,
    providerLabel: providerLabelOf(actualProvider),
    providerTooltip: actualModel ? `${providerLabelOf(actualProvider)} · ${actualModel}` : providerLabelOf(actualProvider),
    fellBack
  };
  translateCache.set(cacheKey, result);
  trimCache();
  saveCacheToStorage();
  return result;
}

function providerLabelOf(providerId) {
  const provider = self.getProvider(providerId);
  return provider?.name || providerId;
}

function normalizeTranslateProfile(profile, url = "") {
  const raw = String(profile || "").toLowerCase();
  if (raw === "github" || /(^|\.)github\.com$/i.test(safeHost(url))) return "github";
  if (raw === "web" || raw === "article") return "web";
  return "x";
}

function safeHost(url) {
  try { return new URL(url).host; } catch (_e) { return ""; }
}

function isRefusal(text) {
  if (!text) return false;
  const sample = text.trim().slice(0, 120).toLowerCase();
  const patterns = [
    /抱歉[，,].*(无法|不能|没办法)/,
    /我无法(处理|翻译|完成|回答)/,
    /^对不起[，,]/,
    /请提供(需要|更多|具体)/,
    /作为(一个)?(ai|人工智能|语言模型)/i,
    /^(sorry|i(?:'|’)?m sorry|i cannot|i can(?:'|’)?t|i am unable|as an ai)/i,
    /please provide (the|some|more) (text|content|input)/i
  ];
  return patterns.some((re) => re.test(sample));
}

async function translateWithOpenAICompat(text, targetLanguage, resolved, profile = "x") {
  const languageName = LANGUAGE_NAMES[targetLanguage] || targetLanguage;
  const maxTokens = Math.min(1800, Math.max(80, Math.ceil(text.length * 1.6) + 80));
  const raw = await chatCompletion(resolved, {
    system: buildTranslateSystemPrompt(languageName, profile),
    user: text,
    maxTokens,
    temperature: 0,
    jsonMode: true
  });
  return parseTranslationOutput(raw);
}

async function translateWithClaude(text, targetLanguage, resolved, profile = "x") {
  const languageName = LANGUAGE_NAMES[targetLanguage] || targetLanguage;
  const maxTokens = Math.min(1800, Math.max(80, Math.ceil(text.length * 1.6) + 80));
  const raw = await chatCompletion(resolved, {
    system: buildTranslateSystemPrompt(languageName, profile),
    user: text,
    maxTokens,
    temperature: 0
    // Anthropic 自身不支持 OpenAI 形式的 json_object 模式，靠 system prompt 约束输出
  });
  return parseTranslationOutput(raw);
}

function buildTranslateSystemPrompt(languageName, profile = "x") {
  if (profile === "github") return buildGithubTranslateSystemPrompt(languageName);
  if (profile === "web") return buildWebTranslateSystemPrompt(languageName);

  if (languageName === "简体中文") {
    return [
      "你是 X（Twitter）专业译者，把推文译成【简体中文】。",
      '只返回 JSON：{"translation":"<译文>"}。无任何解释、Markdown、代码块。',
      "",
      "【保留原样】@用户、#标签、链接、$代码、emoji、数字单位（10K/1.5B/2x）、代码、变量名、commit hash。",
      "",
      "【风格】口语化中文网感，不翻译腔；保留原情绪（吐槽/讽刺/兴奋/自嘲）；保留省略号/破折号/多感叹号节奏。",
      "",
      "【缩写黑话处理】",
      "- 中文圈通用缩写不译不解释：API、GPU、LLM、CEO、IPO、KPI、ROI、SaaS、ETF、CPI、FED 等。",
      "- 网络黑话直接套中文版：lol→笑死、ngl→不瞒你说、imo→我觉得、wagmi→咱们一定行、cooked→寄了、based→牛、fr→真的、tldr→长话短说、iykyk→懂的都懂、gm→早。",
      "- 生僻行业缩写「翻译 + 括号补 4-8 字精炼解释」让普通读者秒懂。例：MoE（混合专家）、ICL（上下文学习）、TGE（代币首发）、PMF（产品市场契合）、ARR（年度经常性收入）、CAC（获客成本）、TVL（锁仓量）、APY（年化收益）、HODL（死拿不卖）。",
      "",
      "【返回空字符串】原文已是简体中文 / 只有 @用户/链接/emoji / 想拒答道歉。严禁任何拒答或道歉话语，遇到一律返回空字符串。",
      "",
      "【人名品牌】马斯克、奥特曼、黄仁勋、特斯拉、微软、谷歌、苹果。模型/厂牌不译：OpenAI、Anthropic、Claude、GPT、Gemini、DeepSeek、NVIDIA。",
      "",
      "【示例】",
      'In: ngl this is fire, @sama cooked\nOut: {"translation":"不瞒你说，这玩意真顶，@sama 牛批"}',
      'In: Our new MoE model uses ICL for 1M context. Beats GPT.\nOut: {"translation":"我们新的 MoE（混合专家）模型用 ICL（上下文学习）处理 1M 上下文，干翻 GPT。"}',
      'In: Hit PMF, ARR crossed $10M. Closing Series B.\nOut: {"translation":"打到 PMF（产品市场契合）了，ARR（年度经常性收入）破 $10M，准备关 B 轮。"}',
      'In: 今天天气真不错\nOut: {"translation":""}'
    ].join("\n");
  }

  return [
    `你是 X（Twitter）专业译者，把推文译成【${languageName}】。`,
    `只返回 JSON：{"translation":"<译文>"}。无解释、无 Markdown。`,
    `保留 @用户、#标签、链接、$代码、emoji、数字单位原样。语气口语化贴近社交媒体。`,
    `行业缩写若目标语言里没有现成对应表达，先翻译再用括号补简短注释。`,
    `原文已是${languageName}、或只含 @用户/链接/emoji、或想拒答道歉 → translation 返回空字符串。`
  ].join("\n");
}

function buildGithubTranslateSystemPrompt(languageName) {
  const target = languageName || "目标语言";
  return [
    `你是专业技术翻译，正在翻译 GitHub 页面内容，目标语言是【${target}】。`,
    '只返回 JSON：{"translation":"<译文>"}。不要解释，不要 Markdown 代码块。',
    "",
    "翻译范围可能来自 README、Issue、PR、Release、Discussion、Wiki 或代码审查评论。",
    "保持技术准确，不要意译 API、CLI 参数、函数名、变量名、包名、文件名、路径、commit hash、版本号、错误码、URL。",
    "保留 Markdown 结构、行内代码、列表编号、引用符号、链接文本的含义；代码块内容不要翻译。",
    "GitHub 固定术语建议：issue=议题，pull request/PR=PR，commit=提交，branch=分支，release=发布，workflow=工作流，action=Action，runner=运行器，artifact=构件，review=审查，merge=合并，rebase=变基，squash=压缩合并。",
    "英文技术词在中文开发者圈更常用时保留英文，例如 API、SDK、CLI、CI、CD、JSON、YAML、HTTP、token、cache、hook、middleware。",
    "若原文已经是目标语言，或只有代码、日志、链接、用户名、路径，translation 返回空字符串。",
    "语气自然、清楚、像开发者给开发者看的译文。"
  ].join("\n");
}

function buildWebTranslateSystemPrompt(languageName) {
  const target = languageName || "目标语言";
  return [
    `你是网页内容翻译助手，目标语言是【${target}】。`,
    '只返回 JSON：{"translation":"<译文>"}。不要解释，不要 Markdown 代码块。',
    "",
    "翻译新闻、文档、博客、产品说明、论坛和帮助中心等常见网页正文。",
    "保持原意和语气，不要总结，不要扩写，不要添加观点。",
    "保留品牌名、人名、产品名、URL、邮箱、代码、命令、快捷键、版本号、单位和数字。",
    "若是标题，译得短而有力；若是段落，译得自然顺畅；若是按钮或菜单，译得简洁。",
    "若原文已经是目标语言，或只有链接、用户名、数字、符号、代码，translation 返回空字符串。"
  ].join("\n");
}

function parseTranslationOutput(raw) {
  if (!raw) return "";
  // 优先按 JSON 解析（含 markdown 围栏剥离）
  const obj = self.parseJsonObjectLoose(raw);
  if (obj && typeof obj.translation === "string") return obj.translation;
  // JSON 失败时，从模型可能输出的散文里抠出 translation 字段
  const match = String(raw).match(/"translation"\s*:\s*"([\s\S]*?)"\s*[,}]/);
  if (match) {
    try { return JSON.parse(`"${match[1]}"`); } catch (_e) { return match[1]; }
  }
  return raw;
}

function postProcessTranslation(text, original) {
  if (!text) return "";
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json|text)?\s*/i, "").replace(/```$/i, "").trim();
  cleaned = cleaned.replace(/^["'“”‘’「」`]+|["'“”‘’「」`]+$/g, "").trim();
  cleaned = cleaned.replace(/^(译文|翻译|中文|Translation)\s*[:：]\s*/i, "").trim();
  if (cleaned === original.trim()) return "";
  return cleaned;
}

async function translateWithGoogle(text, targetLanguage) {
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "auto");
  url.searchParams.set("tl", targetLanguage);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text);

  const response = await fetchWithRetry(url.toString());
  if (!response.ok) throw new Error(`Google 翻译失败：${response.status}`);
  const payload = await response.json();
  return payload?.[0]?.map((part) => part?.[0] || "").join("") || "";
}


/* =========================================================================
 *  回复模块
 * ========================================================================= */

async function generateReplies({ tweetText, author, language, personaId, extraInstruction, count, translation, quoted, toneId, signal }) {
  const root = await getRoot();
  const r = root[STORAGE_KEYS.reply] || DEFAULT_REPLY;
  const providerConfigs = root[STORAGE_KEYS.providerConfigs] || {};
  const personas = root[STORAGE_KEYS.personas] && root[STORAGE_KEYS.personas].length > 0
    ? root[STORAGE_KEYS.personas]
    : self.DEFAULT_PERSONAS || [];

  const providerId = r.providerId || "deepseek";
  const provider = self.getProvider(providerId);
  if (!provider || !provider.canReply) {
    throw new Error(`供应商「${providerId}」不支持生成回复，请到弹窗里换一个`);
  }
  const resolved = resolveProviderConfig(providerId, providerConfigs);
  if (!resolved.apiKey) throw new Error("API Key 为空，请在插件弹窗里填入");
  if (!resolved.baseUrl) throw new Error("API Base URL 为空，请在插件弹窗里填入");
  if (!resolved.model) throw new Error("模型名为空，请在插件弹窗里填入");

  const persona = pickPersona(personas, personaId);
  const desiredCount = Math.min(Math.max(count || 3, 1), 5);
  const systemPrompt = buildReplySystemPrompt({
    persona, language, extraInstruction, count: desiredCount,
    hasTranslation: !!translation,
    hasQuoted: !!quoted,
    toneId: toneId || "neutral"
  });
  const userPayload = buildReplyUserPayload({ tweetText, author, translation, quoted });

  const raw = await callReplyLLM({ resolved, systemPrompt, userPayload, signal });

  const parsed = parseReplies(raw);
  const cleaned = parsed.map((item) => cleanReply(item, language)).filter(Boolean);

  if (cleaned.length === 0) throw new Error("模型没返回可用的回复，稍后再试");
  return cleaned.slice(0, desiredCount);
}

async function callReplyLLM({ resolved, systemPrompt, userPayload, signal }) {
  return chatCompletion(resolved, {
    system: systemPrompt,
    user: userPayload,
    maxTokens: 800,
    temperature: 0.7,
    topP: 0.9,
    presencePenalty: 0.5,
    frequencyPenalty: 0.4,
    jsonMode: true,
    timeoutMs: 45000,
    signal,
    errorPrefix: "生成失败"
  });
}

function pickPersona(personas, id) {
  const list = personas && personas.length > 0 ? personas : self.DEFAULT_PERSONAS || [];
  return list.find((p) => p.id === id) || list[0] || { id: "default", name: "默认", prompt: "" };
}

function buildReplySystemPrompt({ persona, language, extraInstruction, count, hasTranslation, hasQuoted, toneId }) {
  const isChinese = language === "zh";
  // 把每种语言的"必须用 X 回复"规则做成显式映射，避免英文规则被套到日韩等语言上
  const LANG_NAMES = {
    zh: { native: "简体中文", en: "Simplified Chinese" },
    ja: { native: "日本語",   en: "Japanese" },
    ko: { native: "한국어",   en: "Korean" },
    en: { native: "English",  en: "English" },
    ru: { native: "Русский",  en: "Russian" },
    ar: { native: "العربية",  en: "Arabic" }
  };
  const langInfo = LANG_NAMES[language] || LANG_NAMES.en;
  const langInstruction = isChinese
    ? `必须用【简体中文】回复，语气像中文 X 上的真人用户。`
    : [
        `The original tweet is in ${langInfo.en} (${langInfo.native}).`,
        `You MUST reply in ${langInfo.en} (${langInfo.native}). Do NOT translate, do NOT switch to English or any other language. Match the tweet's casual social-media register.`
      ].join(" ");

  const antiAi = isChinese
    ? [
        "【去 AI 味硬规则】",
        "- 禁止开头套话：'这是一个很好的观点/很有意思的想法/总的来说/确实如此/非常赞同'。",
        "- 禁止结尾升华：'期待更多讨论/一起学习/共同进步/让我们拭目以待'。",
        "- 禁止 markdown、列表、标题、加粗、引号包裹。",
        "- 禁止堆 emoji，最多一个，且只在真的贴切时用。",
        "- 不要翻译腔，不要书面语。短句为主，允许省略号、破折号。",
        "- 中文推特里少用句号，一句话可以直接断开。",
        "- 允许不同意、反问、挑刺，但不要杠精。",
        "- 不要重复原推内容，不要概括原推。",
        "- 不要自我介绍，不要说'作为 XX'。"
      ].join("\n")
    : [
        "【Anti-AI rules】",
        "- Do NOT open with 'Great point / Interesting take / I agree / Absolutely'.",
        "- Do NOT close with 'Looking forward / Excited to see / Let's see what happens'.",
        "- No markdown, no lists, no bold, no surrounding quotes.",
        "- At most ONE emoji, only if it really fits.",
        "- Casual, tweet-like. Short. Fragments are fine.",
        "- It's OK to disagree, push back, or joke. Don't be sycophantic.",
        "- Don't summarize the original tweet back to them.",
        "- No 'As an AI' or self-introduction."
      ].join("\n");

  const lengthRule = isChinese
    ? "每条回复 15~60 字，绝不超过 260 字符。"
    : "Each reply 10~40 words, never exceed 260 characters.";

  // 情绪适配：在生成前先在心里给原推贴一个情绪标签，再决定怎么接
  const emotionRule = isChinese
    ? [
        "【情绪适配】",
        "动笔前先判断原推的情绪基调（吐槽/兴奋/求助/炫耀/感伤/中立分享 等），按对应方式接话：",
        "- 求助 → 给具体建议或具体信息，别打太极。",
        "- 炫耀 → 不要硬夸，可以认可一个具体细节或反问代价。",
        "- 吐槽 → 顺着情绪共鸣或加一个相关吐槽，不要劝向上。",
        "- 兴奋 → 接住情绪但不油，避免'恭喜'类公文回复。",
        "- 感伤 → 简短共情或保持安静，绝不输出鸡汤。",
        "- 中立分享 → 给一个具体观点或细节补充，不要纯转述。"
      ].join("\n")
    : [
        "【Emotion match】",
        "Detect the original tweet's tone first (rant / excitement / asking for help / flexing / sad / neutral share) and react accordingly:",
        "- Asking for help → give concrete advice, not vague reassurance.",
        "- Flexing → recognize a specific detail or ask about the cost; do not gush.",
        "- Rant → resonate or add a related complaint, do not preach.",
        "- Excitement → match the energy without being corny.",
        "- Sad → brief empathy or silence; never inspirational.",
        "- Neutral share → add a specific take or detail, do not paraphrase."
      ].join("\n");

  const diversity = isChinese
    ? [
        "【3 条候选角度尽量不同】",
        "- 第 1 条：顺着原推、补一个具体细节或自己的小经验。",
        "- 第 2 条：从另一个角度轻微反问或挑刺，不杠。",
        "- 第 3 条：玩一下梗、接一句俏皮话，或自嘲。",
        "如果只要 1~2 条，优先第 1 和第 2。"
      ].join("\n")
    : [
        "【Diversify angles】",
        "- #1: agree and add a specific detail or personal take.",
        "- #2: gently push back or ask a sharp question.",
        "- #3: a witty / meme-y / self-deprecating line.",
        "If fewer are requested, drop #3 first."
      ].join("\n");

  const personaBlock = persona?.prompt
    ? `【人设】\n${persona.prompt}`
    : "【人设】\n你是一个普通 X 用户，说话自然、有温度。";

  const extra = extraInstruction?.trim()
    ? isChinese
      ? `【本条额外要求】\n${extraInstruction.trim()}`
      : `【Extra for this tweet】\n${extraInstruction.trim()}`
    : "";

  // 上下文使用说明：告诉模型译文/引文怎么用，避免模型直接把它们当主推
  const contextGuide = (hasTranslation || hasQuoted)
    ? isChinese
      ? [
          "【上下文字段说明】",
          hasTranslation ? "- 用户已经看过原推的中文译文，译文仅供你理解原意，回复时必须围绕'原推'本身写，不要直接复述译文。" : "",
          hasQuoted ? "- 这条原推引用了另一条推文（quoted）。引文是背景信息，回复主要针对原推作者；只有当原推本身就是在评价引文时，才围绕引文展开。" : ""
        ].filter(Boolean).join("\n")
      : [
          "【Context fields】",
          hasTranslation ? "- A Chinese translation is provided only for your understanding. Reply about the original tweet, do not echo the translation." : "",
          hasQuoted ? "- The tweet quotes another tweet. Treat it as background; reply mostly to the original author unless the original is explicitly commenting on the quote." : ""
        ].filter(Boolean).join("\n")
    : "";

  const outputRule = [
    "【输出格式】",
    `只返回 JSON：{"replies": ["...", "...", "..."]}，共 ${count} 条。`,
    "不要任何解释、不要 markdown、不要代码围栏。每条都是可以直接粘贴到 X 的纯文本。"
  ].join("\n");

  // 语气调节：和人设正交。中立时不输出额外段，避免无效噪音
  const toneBlock = (() => {
    const tones = {
      friendly: isChinese
        ? ["【语气倾向：友好】",
           "整体偏暖，认可对方分享或观点中的一个具体细节。允许一句轻微好奇的反问，不要肉麻或无脑夸。",
           "禁止：'谢谢分享'、'学到了'、'真不错'这种空洞反应词。"].join("\n")
        : ["【Tone: Friendly】",
           "Warm overall, acknowledge a specific detail from their tweet. A light curious question is fine. Do not gush.",
           "Forbidden: 'Thanks for sharing', 'Loved this', 'So great' style hollow reactions."].join("\n"),
      playful: isChinese
        ? ["【语气倾向：调侃】",
           "整体松弛、不正经，可以接梗、玩谐音、自嘲、抛冷笑话。",
           "梗要现场接、贴原推内容，不要套用网上烂大街的模板。",
           "禁止：装深刻、解释自己的梗、冒犯弱势群体。"].join("\n")
        : ["【Tone: Playful】",
           "Loose, not too serious. You can riff, pun, deadpan, or self-deprecate.",
           "The joke must hook into the actual tweet, not generic copy-paste memes.",
           "Forbidden: explaining your own joke, punching down, forced 'lol'."].join("\n"),
      contrary: isChinese
        ? ["【语气倾向：反对】",
           "礼貌但直接表达不同意。每条至少给一个具体反对理由：反例、被忽略的代价、不同时间维度。",
           "对真正强的论点要承认；靠论点赢不是靠态度赢。",
           "禁止：人身攻击、阴阳怪气、'呵呵'、'是吗？'这种挑衅式回应。"].join("\n")
        : ["【Tone: Disagree】",
           "Polite but direct disagreement. Each reply must include a concrete reason: a counter-example, an overlooked cost, or a different time horizon.",
           "Acknowledge any genuinely strong point. Win on argument, not attitude.",
           "Forbidden: ad hominem, snark, 'sure buddy' style provocation."].join("\n"),
      neutral: ""
    };
    return tones[toneId] || "";
  })();

  return [personaBlock, langInstruction, antiAi, lengthRule, emotionRule, toneBlock, diversity, contextGuide, extra, outputRule]
    .filter(Boolean)
    .join("\n\n");
}

function buildReplyUserPayload({ tweetText, author, translation, quoted }) {
  const lines = [];
  if (author) lines.push(`作者：@${author}`);
  lines.push("原推内容：", tweetText);
  if (translation) {
    lines.push("", "中文译文（仅供理解原意，回复围绕原推本身）：", translation);
  }
  if (quoted) {
    const head = quoted.author ? `被引用推文（@${quoted.author}）：` : "被引用推文（quoted）：";
    lines.push("", head, quoted.text);
  }
  return lines.join("\n");
}

function parseReplies(raw) {
  if (!raw) return [];
  // 第一招：宽松 JSON
  const obj = self.parseJsonObjectLoose(raw);
  if (obj) {
    if (Array.isArray(obj.replies)) return obj.replies;
    if (Array.isArray(obj)) return obj;
  }
  // 第二招：从散文里抠 replies 数组
  const stripped = String(raw).replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  const match = stripped.match(/"replies"\s*:\s*\[([\s\S]*?)\]/);
  if (match) {
    try {
      return JSON.parse(`[${match[1]}]`);
    } catch (_inner) {
      // 第三招：按行拆，剥常见的列表前缀
      return stripped
        .split(/\n+/)
        .map((line) => line.replace(/^[\s"\-\d.、]+|[",]+$/g, "").trim())
        .filter(Boolean);
    }
  }
  return [stripped].filter(Boolean);
}

function cleanReply(text, language) {
  if (typeof text !== "string") return "";
  let out = text.trim();
  if (!out) return "";

  out = out.replace(/^```(?:\w+)?\s*/i, "").replace(/```$/i, "").trim();
  out = out.replace(/^["'“”‘’「」`]+|["'“”‘’「」`]+$/g, "").trim();
  out = out.replace(/^\s*(回复|答|Reply|A)\s*[:：]\s*/i, "").trim();

  if (language === "zh") {
    const openers = [
      /^这是?一个?(非常|很|相当)?(有趣|好|有价值|深刻)的(观点|想法|问题|看法)[,，。！!\s]*/,
      /^(总的来说|综上所述|总结一下|总体而言)[,，。！!\s]*/,
      /^(非常|完全|十分|真的)?(赞同|认同|同意)[,，。！!\s]*/,
      /^(确实如此|说得对|说得好|没错)[,，。！!\s]*/,
      /^作为[一个]*(AI|人工智能|观察者|用户)[，,][^\n]{0,30}?[，,。]\s*/
    ];
    for (const re of openers) out = out.replace(re, "");

    const closers = [
      /[,，。\s]*(期待更多讨论|一起学习|共同进步|拭目以待|加油！?)。?$/,
      /[,，。\s]*(希望对你有帮助|祝好|感谢分享)。?$/
    ];
    for (const re of closers) out = out.replace(re, "");
  } else {
    const openers = [
      /^(great|interesting|thoughtful)\s+(point|take|question)[!.,\s]*/i,
      /^(i\s+)?(totally\s+|absolutely\s+)?agree[!.,\s]*/i,
      /^(well\s+said|exactly|this)[!.,\s]*/i,
      /^as an (ai|assistant|observer)[,\s][^\n]{0,40}?[.,]\s*/i
    ];
    for (const re of openers) out = out.replace(re, "");

    const closers = [
      /[,\s]*(looking forward to (more|seeing).*|excited to see.*|let'?s see what happens)[.!]?$/i,
      /[,\s]*(hope this helps|just my two cents)[.!]?$/i
    ];
    for (const re of closers) out = out.replace(re, "");
  }

  // 压 emoji
  const emojiRegex = /\p{Extended_Pictographic}/gu;
  const emojis = out.match(emojiRegex) || [];
  if (emojis.length > 1) {
    let kept = false;
    out = out.replace(emojiRegex, (m) => {
      if (!kept) { kept = true; return m; }
      return "";
    });
  }

  out = out.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  out = self.truncateByTwitterWeight(out, 270);
  return out;
}


/* =========================================================================
 *  通用工具
 * ========================================================================= */

/**
 * 统一 LLM client。封装 OpenAI 兼容 / Anthropic Messages 两种协议形状。
 * 翻译和回复都走这一条调用层。
 *
 * @param {object} resolved  resolveProviderConfig 的返回 { provider, apiKey, model, baseUrl }
 * @param {object} opts
 *   - system   {string}   system prompt（OpenAI 走 messages[0]，Anthropic 走 system 字段）
 *   - user     {string}   user message 文本
 *   - maxTokens {number}  默认 800
 *   - temperature {number} 默认 0.7
 *   - topP {number}        可选
 *   - presencePenalty {number}    OpenAI 专属，可选
 *   - frequencyPenalty {number}   OpenAI 专属，可选
 *   - jsonMode {boolean}   尝试 OpenAI response_format json_object，400 时自动降级；
 *                          Anthropic 总是忽略此字段，靠 prompt 约束
 *   - timeoutMs {number}   默认 30000
 *   - signal {AbortSignal} 外部取消信号
 *   - errorPrefix {string} 抛错时的前缀，默认 "请求失败"
 * @returns {Promise<string>} 模型纯文本响应（已 trim）
 */
async function chatCompletion(resolved, {
  system,
  user,
  maxTokens = 800,
  temperature = 0.7,
  topP,
  presencePenalty,
  frequencyPenalty,
  jsonMode = false,
  timeoutMs = 30000,
  signal,
  errorPrefix = "请求失败"
}) {
  const isAnthropic = resolved.provider.api === "anthropic";

  if (isAnthropic) {
    return callAnthropic({ resolved, system, user, maxTokens, temperature, topP, timeoutMs, signal, errorPrefix });
  }
  return callOpenAICompat({
    resolved, system, user, maxTokens, temperature, topP,
    presencePenalty, frequencyPenalty, jsonMode, timeoutMs, signal, errorPrefix
  });
}

async function callOpenAICompat({
  resolved, system, user, maxTokens, temperature, topP,
  presencePenalty, frequencyPenalty, jsonMode, timeoutMs, signal, errorPrefix
}) {
  const endpoint = `${resolved.baseUrl}/chat/completions`;
  const body = {
    model: resolved.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    max_tokens: maxTokens,
    temperature,
    stream: false
  };
  if (topP !== undefined) body.top_p = topP;
  if (presencePenalty !== undefined) body.presence_penalty = presencePenalty;
  if (frequencyPenalty !== undefined) body.frequency_penalty = frequencyPenalty;
  // 仅在供应商声称支持 + 调用方要求时才带 response_format
  if (jsonMode && resolved.provider.supportsJsonMode) {
    body.response_format = { type: "json_object" };
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${resolved.apiKey}`
  };
  // OpenRouter 推荐带 referer / title，不带也能用
  if (resolved.provider.id === "openrouter") {
    headers["HTTP-Referer"] = "https://x.com";
    headers["X-Title"] = "PageLingo";
  }

  let response = await fetchWithRetry(
    endpoint,
    { method: "POST", headers, body: JSON.stringify(body) },
    { timeoutMs, signal }
  );

  // 部分模型不支持 response_format，400 时降级重试
  if (!response.ok && response.status === 400 && body.response_format) {
    delete body.response_format;
    response = await fetchWithRetry(
      endpoint,
      { method: "POST", headers, body: JSON.stringify(body) },
      { timeoutMs, signal }
    );
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${errorPrefix}：${response.status || "网络错误"} ${detail.slice(0, 200)}`);
  }

  const payload = await response.json();
  return payload?.choices?.[0]?.message?.content?.trim() || "";
}

async function callAnthropic({ resolved, system, user, maxTokens, temperature, topP, timeoutMs, signal, errorPrefix }) {
  const endpoint = `${resolved.baseUrl}/messages`;
  const body = {
    model: resolved.model,
    max_tokens: maxTokens,
    temperature,
    system,
    messages: [{ role: "user", content: user }]
  };
  if (topP !== undefined) body.top_p = topP;

  const response = await fetchWithRetry(
    endpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": resolved.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify(body)
    },
    { timeoutMs, signal }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${errorPrefix}：${response.status || "网络错误"} ${detail.slice(0, 200)}`);
  }

  const payload = await response.json();
  const blocks = payload?.content || [];
  return blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

async function fetchWithRetry(input, init, { timeoutMs = 30000, signal: externalSignal } = {}) {
  // 如果外部 signal 已经 abort，直接抛
  if (externalSignal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const attempt = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // 把外部 signal 也接到本次 attempt 的 controller 上
    const onExternalAbort = () => controller.abort();
    if (externalSignal) externalSignal.addEventListener("abort", onExternalAbort, { once: true });

    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } catch (error) {
      const aborted = error?.name === "AbortError";
      // 如果是被外部取消，向上抛 AbortError，让上层识别
      if (aborted && externalSignal?.aborted) {
        throw error;
      }
      return {
        ok: false,
        status: 0,
        text: async () => (aborted ? `请求超时（${timeoutMs}ms）` : error.message || String(error))
      };
    } finally {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
    }
  };

  let response = await attempt();
  if (response.ok) return response;
  if (response.status !== 0 && response.status !== 429 && response.status < 500) return response;
  // 重试前再次检查是否已经被取消，避免做无用功
  if (externalSignal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  await new Promise((r) => setTimeout(r, 800));
  if (externalSignal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  return attempt();
}

async function testTranslate() {
  const root = await getRoot();
  const t = root[STORAGE_KEYS.translate] || DEFAULT_TRANSLATE;
  const providerConfigs = root[STORAGE_KEYS.providerConfigs] || {};
  const providerId = t.providerId || "google";
  const sample = "Hello, world!";

  if (providerId === "google") {
    const reply = await translateWithGoogle(sample, t.targetLanguage || "zh-CN");
    return { provider: "Google", model: "—", sample: reply };
  }

  const resolved = resolveProviderConfig(providerId, providerConfigs);
  if (!resolved.apiKey) throw new Error("API Key 为空");

  const reply = resolved.provider.api === "anthropic"
    ? await translateWithClaude(sample, t.targetLanguage || "zh-CN", resolved)
    : await translateWithOpenAICompat(sample, t.targetLanguage || "zh-CN", resolved);

  return { provider: resolved.provider.name, model: resolved.model, sample: reply };
}

async function testReply() {
  const root = await getRoot();
  const r = root[STORAGE_KEYS.reply] || DEFAULT_REPLY;
  const replies = await generateReplies({
    tweetText: "Just shipped a new feature, testing the waters here.",
    author: "test",
    language: "en",
    personaId: r.lastPersonaId || "default",
    count: 1
  });
  const providerConfigs = root[STORAGE_KEYS.providerConfigs] || {};
  const resolved = resolveProviderConfig(r.providerId || "deepseek", providerConfigs);
  return {
    provider: resolved.provider.name,
    model: resolved.model,
    sample: replies[0]
  };
}

/**
 * 拉取某个供应商的可用模型列表。
 * - OpenAI 兼容：GET {base}/models
 * - Anthropic：GET {base}/models?limit=1000
 * - Google 翻译：返回空
 */
async function listModels(providerId, apiKey, baseUrl) {
  const provider = self.getProvider(providerId);
  if (!provider) throw new Error(`未知供应商：${providerId}`);
  if (provider.api === "google-translate") return [];

  if (!apiKey) throw new Error("请先填入 API Key");

  const base = (baseUrl || provider.baseUrl || "").replace(/\/+$/, "");
  if (!base) throw new Error("请先填入 Base URL");

  if (provider.api === "anthropic") {
    const response = await fetchWithRetry(`${base}/models?limit=1000`, {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      }
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`${response.status} ${detail.slice(0, 180)}`);
    }
    const payload = await response.json();
    return (payload?.data || []).map((m) => m.id).filter(Boolean);
  }

  const response = await fetchWithRetry(`${base}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    }
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${response.status} ${detail.slice(0, 180)}`);
  }
  const payload = await response.json();
  const list = payload?.data || payload?.models || [];
  return list
    .map((m) => m?.id || m?.name || "")
    .filter(Boolean)
    .map((id) => id.replace(/^models\//, ""));
}
