# PageLingo

PageLingo 是一个 Chrome / Edge 扩展，用来在浏览网页时直接显示译文。

它针对三个场景做了优化：X / Twitter 的推文流、GitHub 的技术讨论和 README，以及常见英文网页正文。X 场景还保留了 AI 回复草稿能力，但不会自动发送任何内容。

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen.svg)](manifest.json)
![Version](https://img.shields.io/badge/version-1.0.0-orange.svg)

## 功能概览

### 网页翻译

- 自动翻译 X / Twitter 外文推文、长文和引用内容
- 自动翻译 GitHub README、Issue、PR、Release、Discussion 等正文
- 自动翻译常见英文网页的正文区域
- 避开代码块、输入框、按钮、导航栏和隐藏内容
- 支持折叠译文、复制译文、重新翻译
- 默认使用 Google 免费翻译，也可切换到 LLM 翻译

### GitHub 优化

GitHub 内容会使用单独的技术翻译风格：

- 保留代码、命令、路径、包名、函数名、变量名、commit hash
- 尽量保留 Markdown 结构、列表和引用语义
- 常见开发术语按中文开发者习惯处理
- 避免把 API、SDK、CLI、JSON、YAML、HTTP 等硬翻成生硬中文

### X AI 回复

- 在推文操作栏加入「AI 回」按钮
- 生成 3 条回复候选，只写入草稿，不自动发送
- 自动跟随原推语言
- 非中文回复附带中文译注
- 支持内置人设、语气调节、引用推文上下文
- 支持取消生成

## 安装

```bash
git clone https://github.com/Dxy2326/PageLingo.git
```

1. 打开 Chrome / Edge 的扩展管理页：`chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `PageLingo` 项目目录
5. 打开 X、GitHub 或英文网页开始使用

## 配置

扩展弹窗里有 4 个页面：

| 页面 | 用途 |
|---|---|
| 翻译 | 开关、翻译供应商、目标语言 |
| 回复 | X 回复使用的模型供应商 |
| 凭据 | API Key、模型名、Base URL |
| 人设 | X 回复的人设管理 |

翻译默认走 Google 免费翻译，不需要 API Key。

如果要使用 LLM 翻译或 AI 回复，需要在「凭据」里配置对应供应商。

## 支持的供应商

| 服务 | 协议 | 翻译 | 回复 |
|---|---|---|---|
| Google 免费翻译 | translate_a | 支持 | 不支持 |
| DeepSeek | OpenAI 兼容 | 支持 | 支持 |
| OpenAI | OpenAI | 支持 | 支持 |
| Anthropic Claude | Messages API | 支持 | 支持 |
| Gemini | OpenAI 兼容 | 支持 | 支持 |
| OpenRouter | OpenAI 兼容 | 支持 | 支持 |
| Groq | OpenAI 兼容 | 支持 | 支持 |
| 自定义供应商 | OpenAI 兼容 | 支持 | 支持 |

## 权限说明

PageLingo 需要在网页中读取可见文本，才能把正文发送给翻译接口并把译文插回页面。

当前版本会请求较宽的网站访问权限，以支持通用网页翻译。浏览器可能因此在扩展管理页显示权限警告。后续可以改成「默认只启用 X / GitHub，其他网站按需授权」的模式来减少权限提示。

API Key 存在浏览器的 `chrome.storage.sync` 中。不要把包含真实 Key 的文件提交到仓库。

## 项目结构

```text
PageLingo/
├── manifest.json              # Chrome 扩展清单
├── service-worker.js          # 后台翻译、回复、模型列表
├── shared-utils.js            # 共享工具函数
├── x-content.js               # X / Twitter 专用内容脚本
├── web-translator.js          # 通用网页翻译脚本
├── site-profiles.js           # 非 X 网站适配规则
├── popup.html                 # 扩展弹窗
├── popup.css
├── popup.js
├── providers.js               # 供应商配置
├── personas.js                # X 回复人设
├── icons/                     # 扩展图标
├── docs/                      # 维护文档
└── tools/                     # 开发工具
```

## 扩展新网站

非 X 网站的正文选择器在 `site-profiles.js` 中维护。

新增网站时，优先添加一个新的 site profile，而不是修改扫描主逻辑。

如果网站需要新的翻译语气，再在 `service-worker.js` 中增加对应的 `promptProfile`。

详细说明见 [docs/SITE_PROFILES.md](docs/SITE_PROFILES.md)。

## 已知限制

- 不同网站 DOM 差异很大，通用网页翻译不可能一次覆盖所有页面
- X 页面结构变化时，可能需要更新 `x-content.js` 的选择器
- Google 免费翻译适合轻量使用，复杂技术内容建议配置 LLM 翻译
- 浏览器扩展里的 API Key 无法做到绝对保密，请只使用可控额度的 Key

## License

MIT © 2026
