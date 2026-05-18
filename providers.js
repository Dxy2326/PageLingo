/**
 * 合并版供应商配置。
 * 翻译和回复共用同一份 providerConfigs（同一个供应商只填一次 Key），
 * 但翻译和回复可以各自挑不同的供应商和模型。
 *
 * 字段：
 *  - id：内部 ID
 *  - name：UI 显示名
 *  - api：协议形状："openai"（OpenAI 兼容 /chat/completions）/ "anthropic" / "google-translate"
 *  - baseUrl：默认 base
 *  - defaultModel：默认模型
 *  - models：建议模型清单（仅作下拉建议，用户可自定义）
 *  - supportsJsonMode：是否支持 response_format json_object
 *  - canTranslate / canReply：是否能用于翻译 / 回复
 *  - needKey：是否必须填 Key
 *  - keyPlaceholder / keyHelp
 */
self.PROVIDERS = [
  {
    id: "google",
    name: "Google 免费翻译",
    api: "google-translate",
    baseUrl: "",
    defaultModel: "",
    models: [],
    supportsJsonMode: false,
    canTranslate: true,
    canReply: false,
    needKey: false,
    keyPlaceholder: "",
    keyHelp: ""
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    api: "openai",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    supportsJsonMode: true,
    canTranslate: true,
    canReply: true,
    needKey: true,
    keyPlaceholder: "sk-...",
    keyHelp: "https://platform.deepseek.com/api_keys"
  },
  {
    id: "openai",
    name: "OpenAI",
    api: "openai",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
    supportsJsonMode: true,
    canTranslate: true,
    canReply: true,
    needKey: true,
    keyPlaceholder: "sk-...",
    keyHelp: "https://platform.openai.com/api-keys"
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    api: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-3-5-haiku-latest",
    models: ["claude-3-5-haiku-latest", "claude-3-5-sonnet-latest", "claude-sonnet-4-5"],
    supportsJsonMode: false,
    canTranslate: true,
    canReply: true,
    needKey: true,
    keyPlaceholder: "sk-ant-...",
    keyHelp: "https://console.anthropic.com/settings/keys"
  },
  {
    id: "gemini",
    name: "Gemini (Google AI)",
    api: "openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.0-flash",
    models: ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash"],
    supportsJsonMode: true,
    canTranslate: true,
    canReply: true,
    needKey: true,
    keyPlaceholder: "AIza...",
    keyHelp: "https://aistudio.google.com/app/apikey"
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    api: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "anthropic/claude-3.5-haiku",
    models: [
      "anthropic/claude-3.5-haiku",
      "anthropic/claude-3.5-sonnet",
      "openai/gpt-4o-mini",
      "google/gemini-2.0-flash-001",
      "deepseek/deepseek-chat"
    ],
    supportsJsonMode: true,
    canTranslate: true,
    canReply: true,
    needKey: true,
    keyPlaceholder: "sk-or-...",
    keyHelp: "https://openrouter.ai/keys"
  },
  {
    id: "groq",
    name: "Groq",
    api: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
    supportsJsonMode: true,
    canTranslate: true,
    canReply: true,
    needKey: true,
    keyPlaceholder: "gsk_...",
    keyHelp: "https://console.groq.com/keys"
  },
  {
    id: "custom",
    name: "自定义（OpenAI 兼容）",
    api: "openai",
    baseUrl: "",
    defaultModel: "",
    models: [],
    supportsJsonMode: true,
    canTranslate: true,
    canReply: true,
    needKey: true,
    keyPlaceholder: "你的 API Key",
    keyHelp: ""
  }
];

self.getProvider = function (id) {
  return self.PROVIDERS.find((p) => p.id === id) || self.PROVIDERS[0];
};

self.getTranslateProviders = function () {
  return self.PROVIDERS.filter((p) => p.canTranslate);
};

self.getReplyProviders = function () {
  return self.PROVIDERS.filter((p) => p.canReply);
};
