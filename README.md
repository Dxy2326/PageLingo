# PageLingo

> 多站点网页翻译助手：自动翻译 X / Twitter、GitHub 和常见英文网页，并保留 X 上的一键 AI 回复草稿。**不自动发推**。

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen.svg)](manifest.json)
![Version](https://img.shields.io/badge/version-1.0.0-orange.svg)

---

## ✨ 特性

### 📖 多站点自动翻译
- 打开 X / Twitter，外文推文下方自动出现中文译文，**无需点任何按钮**
- 打开 GitHub，README、Issue、PR、Release、Discussion 等正文自动翻译，并使用技术翻译风格
- 打开常见英文网页，正文区域自动翻译，避开导航、按钮、代码块和输入框
- 默认走 **Google 免费翻译**，开箱即用
- 也支持 LLM 翻译：DeepSeek / OpenAI / Claude / Gemini / OpenRouter / Groq / 自定义
- 失败自动降级 Google，从不让你看到空白
- 译文支持折叠 / 复制 / 重译，已翻过的内容缓存

### 💬 AI 回复
- 每条推文操作栏出现「**AI 回**」按钮，点开生成 3 条不同角度的候选
- **自动跟随原推语言**：英文推文 → 英文回，日文推文 → 日文回，中文推文 → 中文回
- 非中文回复**自动附中文译注**，让你看懂自己写出去的话
- **12 个内置人设**（Crypto 老炮 / Builder / 段子手 / 阴阳怪气 / 文艺青年 / 直球反对派 等）
- **4 档语气调节**（中立 / 友好 / 调侃 / 反对），与人设正交组合
- **情绪适配**：模型先识别原推情绪（吐槽 / 兴奋 / 求助 / 炫耀 / 感伤 / 中立），针对性接话
- **引文上下文**：被引用的推文自动作为背景塞进 prompt
- **去 AI 味 prompt**：禁止"这是一个很好的观点"、"期待更多讨论"、emoji 堆砌

### ⚡ 性能 / 可控性
- 同一条 API Key **翻译和回复共用**（只填一次，各自挑模型）
- 普通网页按可见区域懒加载翻译，批量请求减少抖动
- 站点规则独立在 `site-profiles.js`，后续加站点不需要改扫描主逻辑
- service worker 启动时 **TLS 预连**；hover「AI 回」按钮 200ms 时自动唤醒
- 生成中点按钮可**取消**
- 实时显示 X 字数权重计数器（中文 ×2、其他 ×1）
- 快捷键：`Alt+R` 切换 AI 回面板 · `Alt+T` 折叠译文 · `Esc` 关闭

### 🛡️ 安全
- **永远不会自动发推**。「填入回复框」只是写到 contenteditable，跟你手动粘贴一样
- API Key 只存在浏览器 `chrome.storage.sync`（同步到你登录的 Chrome 账户），不发到任何第三方
- 不读 / 不存 X 账号密码
- 网页翻译脚本只读取当前页面可见文本，并把待翻译文本发给你选择的翻译供应商

---

## 🚀 安装

1. 下载源码：
   ```bash
   git clone https://github.com/Shanks100/PageLingo.git
   ```
2. Chrome / Edge 打开 `chrome://extensions/`，开启「开发者模式」
3. 点「加载已解压的扩展程序」，选择 `PageLingo` 目录
4. 打开 [https://x.com](https://x.com)、GitHub 或常见英文网页，正文会自动出现译文

---

## 🔧 使用

### 默认配置（免 Key 即用）
- 翻译：Google 免费翻译，无需配置
- 回复：需要在「凭据」标签里填一个 LLM 的 API Key

### 弹窗布局
4 个标签：
- **📖 翻译**：开关 / 翻译供应商 / 目标语言
- **💬 回复**：选回复用的 LLM
- **🔑 凭据**：每个 LLM 只填一次 Key / 模型 / Base URL
- **🎭 人设**：12 个内置人设，可增删改

### 模型自动获取
凭据 tab 里填好 Key 后点「⟳ 刷新」，自动从 API 拉最新模型列表。

---

## 🔌 支持的 API

| 服务 | 协议 | 翻译 | 回复 | 默认 base |
|---|---|---|---|---|
| Google 免费翻译 | translate_a | ✅ | ❌ | — |
| DeepSeek | OpenAI 兼容 | ✅ | ✅ | `https://api.deepseek.com` |
| OpenAI | OpenAI | ✅ | ✅ | `https://api.openai.com/v1` |
| Anthropic Claude | Messages API | ✅ | ✅ | `https://api.anthropic.com/v1` |
| Gemini (Google AI) | OpenAI 兼容 | ✅ | ✅ | `https://generativelanguage.googleapis.com/v1beta/openai` |
| OpenRouter | OpenAI 兼容 | ✅ | ✅ | `https://openrouter.ai/api/v1` |
| Groq | OpenAI 兼容 | ✅ | ✅ | `https://api.groq.com/openai/v1` |
| 自定义（含本地 ollama） | OpenAI 兼容 | ✅ | ✅ | 你自己填 |

---

## 📁 文件结构

```
PageLingo/
├── manifest.json        # MV3 清单
├── service-worker.js    # 后台：翻译 + 回复 + 模型列表
├── x-content.js         # X 专用：扫推文 / 译文块 / AI 回按钮 / 填编辑器 / 快捷键
├── web-translator.js    # 通用网页：正文扫描 / 批量翻译 / 译文渲染
├── site-profiles.js     # 非 X 站点适配配置
├── popup.html/js/css    # 4 标签弹窗
├── shared-utils.js      # content + 后台共享纯函数（语言检测、字数权重等）
├── personas.js          # 12 个内置人设
├── providers.js         # 供应商定义（协议形状 + 默认模型）
├── secrets.example.js   # secrets.js 模板（默认空）
├── icons/               # 16/32/48/128 PNG
├── docs/                # 扩展文档
├── tools/               # 开发辅助（图标生成等）
└── README.md
```

### 扩展新网站

非 X 网站走 `site-profiles.js` 的声明式配置。新增网站时优先加站点 profile，只有需要新翻译风格时才改 `service-worker.js` 的 prompt。详细说明见 [docs/SITE_PROFILES.md](docs/SITE_PROFILES.md)。

---

## 🐛 已知问题

- X 页面结构若大改，可能需要调整 `x-content.js` 里的 `[data-testid]` 选择器
- 普通网页结构差异很大，少数网站可能需要新增站点 profile 才能获得最佳效果
- 部分 LLM 安全策略较严，遇到敏感推文可能返回空译文（已识别拒答模式并跳过）
- 浏览器扩展中的 API Key 无法做到真正保密，**别把带 Key 的 secrets.js 提交到任何远程仓库**

---

## 📄 License

MIT © 2026
