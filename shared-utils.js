/**
 * PageLingo · 共享工具库
 * 同时供 content script 和 service worker 使用：
 *   - content script: manifest content_scripts.js 数组里排在 x-content.js 前面
 *   - service worker: importScripts("shared-utils.js")
 *
 * 所有内容挂在 self 顶层，避免 ES module 在 MV3 service worker 上的兼容麻烦。
 */

/* =========================================================================
 *  语言检测
 * ========================================================================= */

/**
 * 推文/文本主语言检测。返回 BCP-47 子码：zh / ja / ko / en / ru / ar
 * 平假名/片假名是日文独占特征（中文绝不用），有假名直接判日文 —— 这是最强信号。
 * Hangul / 西里尔 / 阿拉伯字母同理。
 */
self.detectLanguage = function (text) {
  const stripped = String(text || "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[@#$][\w\u4e00-\u9fff]+/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, "");

  const han = stripped.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length || 0;
  // 平假名 + 片假名（含半角片假名常用区段）
  const kana = stripped.match(/[\u3040-\u309f\u30a0-\u30ff\uff66-\uff9f]/g)?.length || 0;
  const hangul = stripped.match(/[\uac00-\ud7af\u1100-\u11ff]/g)?.length || 0;
  const cyrillic = stripped.match(/[\u0400-\u04ff]/g)?.length || 0;
  const arabic = stripped.match(/[\u0600-\u06ff]/g)?.length || 0;

  if (kana > 0) return "ja";
  if (hangul >= 2) return "ko";
  if (han >= 3) return "zh";
  if (cyrillic >= 3) return "ru";
  if (arabic >= 3) return "ar";
  return "en";
};

/**
 * 各语言的元信息表。集中维护一份，content / background / popup 都引用它。
 *  - label：UI 显示名（短）
 *  - native：母语自称（用于 prompt 提示模型用什么语言回复）
 *  - en：英文学术名（让英文 prompt 也能引用）
 *  - rtl：是否右到左（暂未用，留作样式钩子）
 */
self.LANGS = {
  zh: { label: "中文",    native: "简体中文", en: "Simplified Chinese", rtl: false },
  ja: { label: "日本語",  native: "日本語",   en: "Japanese",           rtl: false },
  ko: { label: "한국어",  native: "한국어",   en: "Korean",             rtl: false },
  en: { label: "English", native: "English",  en: "English",            rtl: false },
  ru: { label: "Русский", native: "Русский",  en: "Russian",            rtl: false },
  ar: { label: "العربية", native: "العربية",  en: "Arabic",             rtl: true  }
};

/**
 * 翻译目标语言（带地区码）→ 母语名。给 background 翻译 prompt 用。
 */
self.TRANSLATE_LANGUAGE_NAMES = {
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  ja: "日本語",
  ko: "한국어",
  en: "English"
};

/* =========================================================================
 *  X 字数权重
 *  weighted-character 规则：CJK / 假名 / 韩文 / 全宽 / 非 BMP（emoji 等）= 2，
 *  其他算 1。X 单条上限 280。
 * ========================================================================= */

self.twitterWeight = function (ch) {
  const code = ch.codePointAt(0);
  if (code === undefined) return 0;
  if (code > 0xffff) return 2;
  if (code >= 0x3400 && code <= 0x9fff) return 2;
  if (code >= 0xf900 && code <= 0xfaff) return 2;
  if (code >= 0x3040 && code <= 0x30ff) return 2;
  if (code >= 0xac00 && code <= 0xd7af) return 2;
  if (code >= 0xff00 && code <= 0xffef) return 2;
  if (code >= 0x3000 && code <= 0x303f) return 2;
  return 1;
};

self.twitterWeightedLength = function (text) {
  let total = 0;
  for (const ch of String(text || "")) total += self.twitterWeight(ch);
  return total;
};

self.truncateByTwitterWeight = function (text, maxWeight) {
  if (self.twitterWeightedLength(text) <= maxWeight) return text;
  let weight = 0;
  let out = "";
  for (const ch of text) {
    const w = self.twitterWeight(ch);
    if (weight + w > maxWeight - 1) break; // 留 1 给省略号
    weight += w;
    out += ch;
  }
  return out.trimEnd() + "…";
};

/* =========================================================================
 *  小工具
 * ========================================================================= */

/**
 * 宽松解析模型可能套了 markdown 围栏的 JSON 字符串。失败返回 null。
 */
self.parseJsonObjectLoose = function (raw) {
  if (!raw) return null;
  const stripped = String(raw).replace(/^```(?:json|text)?\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(stripped);
  } catch (_e) {
    return null;
  }
};

self.escapeHtml = function (str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
};
