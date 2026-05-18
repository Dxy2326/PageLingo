/* global chrome */

const DEFAULT_TRANSLATE = { enabled: true, providerId: "google", targetLanguage: "zh-CN" };
const DEFAULT_REPLY = { providerId: "deepseek", lastPersonaId: "crypto-og" };

const CUSTOM_MODEL_VALUE = "__custom__";

/* ---- 元素 ---- */
const tabButtons = Array.from(document.querySelectorAll(".tab"));
const panels = Array.from(document.querySelectorAll(".panel"));

// 翻译
const translateEnabledInput = document.querySelector("#translateEnabled");
const translateProviderSelect = document.querySelector("#translateProviderId");
const translateProviderHint = document.querySelector("#translateProviderHint");
const translateTargetLanguageSelect = document.querySelector("#translateTargetLanguage");
const saveTranslateBtn = document.querySelector("#saveTranslate");
const testTranslateBtn = document.querySelector("#testTranslate");
const translateStatus = document.querySelector("#translateStatus");

// 回复
const replyProviderSelect = document.querySelector("#replyProviderId");
const replyProviderHint = document.querySelector("#replyProviderHint");
const saveReplyBtn = document.querySelector("#saveReply");
const testReplyBtn = document.querySelector("#testReply");
const replyStatus = document.querySelector("#replyStatus");

// 凭据
const credentialProviderSelect = document.querySelector("#credentialProviderId");
const credentialStatusBadge = document.querySelector("#credentialStatusBadge");
const apiKeyField = document.querySelector("#apiKeyField");
const apiKeyInput = document.querySelector("#apiKey");
const keyHelpLink = document.querySelector("#keyHelp");
const modelField = document.querySelector("#modelField");
const modelSelect = document.querySelector("#modelSelect");
const modelInput = document.querySelector("#modelInput");
const customModelField = document.querySelector("#customModelField");
const refreshModelsBtn = document.querySelector("#refreshModels");
const baseUrlField = document.querySelector("#baseUrlField");
const baseUrlInput = document.querySelector("#baseUrl");
const saveCredentialsBtn = document.querySelector("#saveCredentials");
const credentialStatus = document.querySelector("#credentialStatus");

// 人设
const personaListEl = document.querySelector("#personaList");
const personaEditor = document.querySelector("#personaEditor");
const personaNameInput = document.querySelector("#personaName");
const personaPromptInput = document.querySelector("#personaPrompt");
const addPersonaBtn = document.querySelector("#addPersona");
const savePersonaBtn = document.querySelector("#savePersona");
const cancelPersonaBtn = document.querySelector("#cancelPersona");
const resetPersonasBtn = document.querySelector("#resetPersonas");
const personaStatus = document.querySelector("#personaStatus");

/* ---- 状态 ---- */
let providerConfigs = {};
let translate = { ...DEFAULT_TRANSLATE };
let reply = { ...DEFAULT_REPLY };
let personas = [];
let editingPersonaId = null;

let currentCredentialProviderId = "deepseek";
const modelsByProvider = {};
let loadModelsToken = 0;

init();

async function init() {
  setupTabs();

  // 渲染各个 select
  fillTranslateProviderSelect();
  fillReplyProviderSelect();
  fillCredentialProviderSelect();

  // 读存储
  const stored = await chrome.storage.sync.get([
    "translate", "reply", "providerConfigs", "personas"
  ]);
  translate = { ...DEFAULT_TRANSLATE, ...(stored.translate || {}) };
  reply = { ...DEFAULT_REPLY, ...(stored.reply || {}) };
  providerConfigs = stored.providerConfigs || {};
  personas = stored.personas && stored.personas.length > 0
    ? stored.personas
    : (Array.isArray(self.DEFAULT_PERSONAS) ? [...self.DEFAULT_PERSONAS] : []);

  // 同步 UI
  translateEnabledInput.checked = !!translate.enabled;
  translateProviderSelect.value = translate.providerId;
  translateTargetLanguageSelect.value = translate.targetLanguage;
  updateTranslateProviderHint();

  replyProviderSelect.value = reply.providerId;
  updateReplyProviderHint();

  // 凭据面板默认指向回复用的供应商，方便用户填好就能用
  currentCredentialProviderId = reply.providerId !== "google" ? reply.providerId : "deepseek";
  credentialProviderSelect.value = currentCredentialProviderId;
  fillCredentialForm(currentCredentialProviderId);

  renderPersonas();

  // 事件
  bindEvents();
}

function setupTabs() {
  for (const btn of tabButtons) {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      tabButtons.forEach((b) => b.classList.toggle("is-active", b === btn));
      panels.forEach((p) => p.classList.toggle("is-active", p.dataset.panel === tab));
    });
  }
}

function bindEvents() {
  // 翻译
  translateEnabledInput.addEventListener("change", () => saveTranslateSettings(true));
  translateProviderSelect.addEventListener("change", () => {
    translate.providerId = translateProviderSelect.value;
    updateTranslateProviderHint();
    saveTranslateSettings();
  });
  translateTargetLanguageSelect.addEventListener("change", () => saveTranslateSettings());
  saveTranslateBtn.addEventListener("click", () => saveTranslateSettings(true));
  testTranslateBtn.addEventListener("click", testTranslate);

  // 回复
  replyProviderSelect.addEventListener("change", () => {
    reply.providerId = replyProviderSelect.value;
    updateReplyProviderHint();
    saveReplySettings();
  });
  saveReplyBtn.addEventListener("click", () => saveReplySettings(true));
  testReplyBtn.addEventListener("click", testReply);

  // 凭据
  credentialProviderSelect.addEventListener("change", onCredentialProviderChange);
  apiKeyInput.addEventListener("input", onCredentialFormInput);
  baseUrlInput.addEventListener("input", onCredentialFormInput);
  modelSelect.addEventListener("change", onModelSelectChange);
  modelInput.addEventListener("input", onCredentialFormInput);
  refreshModelsBtn.addEventListener("click", () => loadModels(true));
  saveCredentialsBtn.addEventListener("click", saveCredentials);

  // 人设
  addPersonaBtn.addEventListener("click", () => openPersonaEditor(null));
  savePersonaBtn.addEventListener("click", savePersona);
  cancelPersonaBtn.addEventListener("click", closePersonaEditor);
  resetPersonasBtn.addEventListener("click", resetPersonas);
}

/* =========================================================================
 *  填充供应商下拉
 * ========================================================================= */
function fillTranslateProviderSelect() {
  translateProviderSelect.innerHTML = "";
  for (const p of self.PROVIDERS.filter((x) => x.canTranslate)) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    translateProviderSelect.appendChild(opt);
  }
}

function fillReplyProviderSelect() {
  replyProviderSelect.innerHTML = "";
  for (const p of self.PROVIDERS.filter((x) => x.canReply)) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    replyProviderSelect.appendChild(opt);
  }
}

function fillCredentialProviderSelect() {
  credentialProviderSelect.innerHTML = "";
  for (const p of self.PROVIDERS) {
    if (p.api === "google-translate") continue; // Google 翻译不需要凭据
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    credentialProviderSelect.appendChild(opt);
  }
}

function updateTranslateProviderHint() {
  const provider = self.getProvider(translate.providerId);
  if (!provider) { translateProviderHint.textContent = ""; return; }
  if (provider.api === "google-translate") {
    translateProviderHint.textContent = "Google 免费翻译，无需 API Key，开箱即用。";
  } else {
    const cfg = providerConfigs[provider.id] || {};
    if (!cfg.apiKey) {
      translateProviderHint.textContent = `还没填 ${provider.name} 的 API Key，到「供应商」标签里配置。当前会自动降级到 Google 免费翻译。`;
    } else {
      translateProviderHint.textContent = `当前模型：${cfg.model || provider.defaultModel}`;
    }
  }
}

function updateReplyProviderHint() {
  const provider = self.getProvider(reply.providerId);
  if (!provider) { replyProviderHint.textContent = ""; return; }
  const cfg = providerConfigs[provider.id] || {};
  if (!cfg.apiKey) {
    replyProviderHint.textContent = `还没填 ${provider.name} 的 API Key，到「供应商」标签里配置。`;
  } else {
    replyProviderHint.textContent = `当前模型：${cfg.model || provider.defaultModel}`;
  }
}

/* =========================================================================
 *  保存
 * ========================================================================= */
async function saveTranslateSettings(showToast = false) {
  translate = {
    enabled: translateEnabledInput.checked,
    providerId: translateProviderSelect.value,
    targetLanguage: translateTargetLanguageSelect.value
  };
  await chrome.storage.sync.set({ translate });
  if (showToast) showStatus(translateStatus, "已保存", "success", true);
}

async function saveReplySettings(showToast = false) {
  reply = { ...reply, providerId: replyProviderSelect.value };
  await chrome.storage.sync.set({ reply });
  if (showToast) showStatus(replyStatus, "已保存", "success", true);
}

async function testTranslate() {
  await saveTranslateSettings(false);
  showStatus(translateStatus, "测试中…", "neutral");
  try {
    const response = await chrome.runtime.sendMessage({ type: "testTranslate" });
    if (!response?.ok) throw new Error(response?.error || "失败");
    const tag = `${response.provider} / ${response.model}`;
    showStatus(translateStatus, `可用：${tag}  示例：${truncate(response.sample, 40)}`, "success");
  } catch (error) {
    showStatus(translateStatus, `不可用：${error.message}`, "error");
  }
}

async function testReply() {
  await saveReplySettings(false);
  showStatus(replyStatus, "测试中…", "neutral");
  try {
    const response = await chrome.runtime.sendMessage({ type: "testReply" });
    if (!response?.ok) throw new Error(response?.error || "失败");
    const tag = `${response.provider} / ${response.model}`;
    showStatus(replyStatus, `可用：${tag}  示例：${truncate(response.sample, 40)}`, "success");
  } catch (error) {
    showStatus(replyStatus, `不可用：${error.message}`, "error");
  }
}

/* =========================================================================
 *  凭据面板
 * ========================================================================= */
function fillCredentialForm(providerId) {
  const provider = self.getProvider(providerId);
  if (!provider) return;
  const cfg = providerConfigs[providerId] || {};

  apiKeyInput.value = cfg.apiKey || "";
  apiKeyInput.placeholder = provider.keyPlaceholder || "API Key";
  baseUrlInput.value = cfg.baseUrl || provider.baseUrl || "";
  baseUrlInput.placeholder = provider.baseUrl || "https://...";

  // 模型下拉
  const cachedModels = modelsByProvider[providerId] || provider.models || [];
  const currentModel = cfg.model || provider.defaultModel || "";
  renderModelSelect(cachedModels, currentModel);
  modelInput.value = currentModel;

  // Key 帮助链接
  if (provider.keyHelp) {
    keyHelpLink.href = provider.keyHelp;
    keyHelpLink.hidden = false;
  } else {
    keyHelpLink.hidden = true;
  }

  refreshModelsBtn.disabled = !provider.needKey ? false : !cfg.apiKey;

  // 凭据状态徽标
  updateCredentialBadge(provider, cfg);

  // Key 已填的话，自动拉一次模型列表（不强制）
  if (provider.needKey && cfg.apiKey && !modelsByProvider[providerId]) {
    loadModels(false);
  }
}

/**
 * 在凭据 tab 标题旁显示一个小徽标，让用户一眼知道当前选中的供应商是否已配置好。
 *  - 不需要 Key 的（Google 翻译）：灰色「免 Key」
 *  - 已填 Key：绿色「已配置」
 *  - 未填：红色「未配置」
 */
function updateCredentialBadge(provider, cfg) {
  if (!credentialStatusBadge) return;
  credentialStatusBadge.classList.remove("is-ok", "is-empty", "is-google");
  if (!provider.needKey) {
    credentialStatusBadge.textContent = "免 Key";
    credentialStatusBadge.classList.add("is-google");
  } else if (cfg.apiKey) {
    credentialStatusBadge.textContent = "已配置";
    credentialStatusBadge.classList.add("is-ok");
  } else {
    credentialStatusBadge.textContent = "未配置";
    credentialStatusBadge.classList.add("is-empty");
  }
  credentialStatusBadge.hidden = false;
}

function onCredentialProviderChange() {
  // 切之前先把当前表单回写
  flushCredentialForm();
  currentCredentialProviderId = credentialProviderSelect.value;
  fillCredentialForm(currentCredentialProviderId);
}

function onCredentialFormInput() {
  flushCredentialForm();
  refreshModelsBtn.disabled = !apiKeyInput.value.trim();
  // 输入 Key 时实时刷新徽标
  const provider = self.getProvider(currentCredentialProviderId);
  const cfg = providerConfigs[currentCredentialProviderId] || {};
  if (provider) updateCredentialBadge(provider, cfg);
}

function flushCredentialForm() {
  const provider = self.getProvider(currentCredentialProviderId);
  if (!provider) return;
  providerConfigs[currentCredentialProviderId] = {
    apiKey: apiKeyInput.value.trim(),
    model: modelInput.value.trim() || provider.defaultModel || "",
    baseUrl: baseUrlInput.value.trim() || provider.baseUrl || ""
  };
}

function onModelSelectChange() {
  const value = modelSelect.value;
  if (value === CUSTOM_MODEL_VALUE) {
    customModelField.hidden = false;
    modelInput.focus();
    modelInput.value = "";
  } else {
    customModelField.hidden = true;
    modelInput.value = value;
  }
  flushCredentialForm();
}

function renderModelSelect(models, currentValue) {
  modelSelect.innerHTML = "";

  if (models.length === 0) {
    const opt = document.createElement("option");
    opt.value = currentValue || "";
    opt.textContent = currentValue || "（尚未获取列表）";
    modelSelect.appendChild(opt);
  } else {
    if (currentValue && !models.includes(currentValue)) {
      const opt = document.createElement("option");
      opt.value = currentValue;
      opt.textContent = `${currentValue}（当前）`;
      modelSelect.appendChild(opt);
    }
    for (const id of models) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id;
      modelSelect.appendChild(opt);
    }
  }

  // 末尾加一个"自定义"项
  const customOpt = document.createElement("option");
  customOpt.value = CUSTOM_MODEL_VALUE;
  customOpt.textContent = "✎ 自定义模型名…";
  modelSelect.appendChild(customOpt);

  modelSelect.value = currentValue || "";
  customModelField.hidden = true;
}

async function loadModels(forced) {
  const provider = self.getProvider(currentCredentialProviderId);
  if (!provider || provider.api === "google-translate") return;

  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    if (forced) showStatus(credentialStatus, "请先填入 API Key", "error");
    return;
  }

  if (!forced && modelsByProvider[provider.id]?.length) {
    renderModelSelect(modelsByProvider[provider.id], modelInput.value);
    return;
  }

  const myToken = ++loadModelsToken;
  refreshModelsBtn.disabled = true;
  showStatus(credentialStatus, "正在获取模型列表…", "neutral");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "listModels",
      providerId: provider.id,
      apiKey,
      baseUrl: baseUrlInput.value.trim()
    });

    if (myToken !== loadModelsToken || provider.id !== currentCredentialProviderId) return;
    if (!response?.ok) throw new Error(response?.error || "获取失败");

    const sorted = sortModels(response.models || [], provider.id);
    modelsByProvider[provider.id] = sorted;
    renderModelSelect(sorted, modelInput.value);

    if (sorted.length === 0) {
      showStatus(credentialStatus, "未获取到模型", "error");
    } else {
      showStatus(credentialStatus, `共 ${sorted.length} 个模型`, "success", true);
    }
  } catch (error) {
    if (myToken === loadModelsToken) {
      showStatus(credentialStatus, `获取失败：${error.message}`, "error");
    }
  } finally {
    if (myToken === loadModelsToken) {
      refreshModelsBtn.disabled = !apiKeyInput.value.trim();
    }
  }
}

function sortModels(models, providerId) {
  const priorityKeywords = {
    deepseek: ["v4", "chat"],
    openai: ["gpt", "mini"],
    anthropic: ["sonnet", "opus", "haiku"],
    gemini: ["flash", "pro"],
    openrouter: ["claude", "gpt", "gemini"],
    groq: ["llama", "mixtral"],
    custom: []
  };
  const keys = priorityKeywords[providerId] || [];
  return [...models].sort((a, b) => {
    const ai = keys.findIndex((k) => a.toLowerCase().includes(k));
    const bi = keys.findIndex((k) => b.toLowerCase().includes(k));
    const aRank = ai === -1 ? keys.length : ai;
    const bRank = bi === -1 ? keys.length : bi;
    if (aRank !== bRank) return aRank - bRank;
    return b.localeCompare(a);
  });
}

async function saveCredentials() {
  flushCredentialForm();
  await chrome.storage.sync.set({ providerConfigs });
  // 凭据变了，hint 也要刷新
  updateTranslateProviderHint();
  updateReplyProviderHint();
  showStatus(credentialStatus, "已保存", "success", true);
}

/* =========================================================================
 *  人设
 * ========================================================================= */
function renderPersonas() {
  personaListEl.innerHTML = "";
  if (personas.length === 0) {
    personaListEl.innerHTML = '<li class="empty">还没有人设，点「+ 新建」开始。</li>';
    return;
  }
  personas.forEach((persona) => {
    const li = document.createElement("li");
    li.className = "persona-item";
    li.innerHTML = `
      <div class="persona-info">
        <div class="persona-name"></div>
        <div class="persona-prompt"></div>
      </div>
      <div class="persona-actions">
        <button type="button" class="ghost small edit">编辑</button>
        <button type="button" class="ghost small delete">删除</button>
      </div>
    `;
    li.querySelector(".persona-name").textContent = persona.name;
    li.querySelector(".persona-prompt").textContent = truncate(persona.prompt, 80);
    li.querySelector(".edit").addEventListener("click", () => openPersonaEditor(persona.id));
    li.querySelector(".delete").addEventListener("click", () => deletePersona(persona.id));
    personaListEl.appendChild(li);
  });
}

function openPersonaEditor(id) {
  editingPersonaId = id;
  if (id) {
    const p = personas.find((x) => x.id === id);
    personaNameInput.value = p?.name || "";
    personaPromptInput.value = p?.prompt || "";
  } else {
    personaNameInput.value = "";
    personaPromptInput.value = "";
  }
  personaEditor.hidden = false;
  personaNameInput.focus();
}

function closePersonaEditor() {
  editingPersonaId = null;
  personaEditor.hidden = true;
}

async function savePersona() {
  const name = personaNameInput.value.trim();
  const prompt = personaPromptInput.value.trim();
  if (!name) { showStatus(personaStatus, "人设名称不能为空", "error"); return; }
  if (!prompt) { showStatus(personaStatus, "提示词不能为空", "error"); return; }

  if (editingPersonaId) {
    personas = personas.map((p) => (p.id === editingPersonaId ? { ...p, name, prompt } : p));
  } else {
    personas.push({ id: `custom-${Date.now()}`, name, prompt });
  }
  await chrome.storage.sync.set({ personas });
  closePersonaEditor();
  renderPersonas();
  showStatus(personaStatus, "人设已保存", "success", true);
}

async function deletePersona(id) {
  if (!confirm("确定删除这个人设？")) return;
  personas = personas.filter((p) => p.id !== id);
  await chrome.storage.sync.set({ personas });
  renderPersonas();
}

async function resetPersonas() {
  if (!confirm("恢复为 5 个内置人设？当前自定义人设会被替换。")) return;
  const fallback = Array.isArray(self.DEFAULT_PERSONAS) ? self.DEFAULT_PERSONAS : [];
  personas = [...fallback];
  await chrome.storage.sync.set({ personas });
  renderPersonas();
  showStatus(personaStatus, "已恢复默认人设", "success", true);
}

/* =========================================================================
 *  小工具
 * ========================================================================= */
const statusTimers = new WeakMap();

function showStatus(el, msg, type, autoClear = false) {
  if (!el) return;
  const old = statusTimers.get(el);
  if (old) { clearTimeout(old); statusTimers.delete(el); }

  el.textContent = msg;
  el.classList.remove("is-success", "is-error");
  if (type === "success") el.classList.add("is-success");
  else if (type === "error") el.classList.add("is-error");

  if (autoClear) {
    const t = setTimeout(() => {
      el.textContent = "";
      el.classList.remove("is-success", "is-error");
      statusTimers.delete(el);
    }, 1800);
    statusTimers.set(el, t);
  }
}

function truncate(text, max) {
  if (!text) return "";
  const s = String(text);
  return s.length > max ? s.slice(0, max) + "…" : s;
}
