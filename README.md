# PageLingo

PageLingo 是一个 Chrome / Edge 扩展，用来在浏览网页时直接显示译文。

它针对三个场景做了优化：X / Twitter 的推文流、GitHub 的技术讨论和 README，以及常见英文网页正文。X 场景还保留了 AI 回复草稿能力，但不会自动发送任何内容。

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen.svg)](manifest.json)
![Version](https://img.shields.io/badge/version-1.1.0-orange.svg)

## 功能概览

### 网页翻译

- 自动翻译 X / Twitter 外文推文、长文和引用内容
- 自动翻译 GitHub README、Issue、PR、Release、Discussion 等正文
- 新安装默认关闭翻译，只在用户允许的网站处理正文
- 默认允许 X / Twitter 和 GitHub，其他网站可从扩展弹窗加入允许列表
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

## 安装使用

### 方式一：下载发布包

1. 打开仓库的 `Releases` 页面
2. 下载最新版本的 `PageLingo-*.zip`
3. 解压 ZIP
4. 打开 Chrome / Edge 的扩展管理页：`chrome://extensions/`
5. 开启「开发者模式」
6. 点击「加载已解压的扩展程序」
7. 选择解压后的 `PageLingo` 目录
8. 打开 X、GitHub 或英文网页开始使用

### 方式二：下载源码 ZIP

1. 打开仓库页面，点击 `Code` → `Download ZIP`
2. 解压 ZIP
3. 打开 Chrome / Edge 的扩展管理页：`chrome://extensions/`
4. 开启「开发者模式」
5. 点击「加载已解压的扩展程序」
6. 选择解压后的 `PageLingo` 项目目录
7. 打开 X、GitHub 或英文网页开始使用

## 开发安装

```bash
git clone https://github.com/Dxy2326/PageLingo.git
```

1. 打开 Chrome / Edge 的扩展管理页：`chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `PageLingo` 项目目录
5. 打开 X、GitHub 或英文网页开始使用

## 打包与验证

维护者可以在项目根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\package-extension.ps1
```

脚本会先运行测试、检查必需文件和 JavaScript 语法，再生成 `dist/PageLingo-<version>.zip`。

发布包会自动排除 `.git`、`dist`、`node_modules`、编辑器目录和本机 `secrets.js`。

## 配置

扩展弹窗里有 4 个页面：

| 页面 | 用途 |
|---|---|
| 翻译 | 开关、允许的网站、翻译供应商、目标语言 |
| 回复 | X 回复使用的模型供应商 |
| 凭据 | API Key、模型名、Base URL |
| 人设 | X 回复的人设管理 |

新安装默认关闭翻译。开启后，Google 免费翻译不需要 API Key；选择 LLM 时必须配置对应 Key，失败不会自动转发给 Google。

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

当前版本仍会请求较宽的网站访问权限，以便静态内容脚本支持通用网页。浏览器可能因此显示权限警告，但扩展新安装时不会翻译；只有同时开启翻译并允许当前网站后，正文才会发送给所选供应商。

API Key 存在本机的 `chrome.storage.local` 中，不通过浏览器同步。远程 API Base URL 必须使用 HTTPS；仅 localhost 允许 HTTP。

更完整的数据说明见 [PRIVACY.md](PRIVACY.md)。

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
- 翻译缓存只保留在当前后台进程内，浏览器重启后会清空
- 浏览器扩展里的 API Key 无法做到绝对保密，请只使用可控额度的 Key

## License

MIT © 2026
