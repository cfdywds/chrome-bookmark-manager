# 书签管家 · Bookmark Manager

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Manifest](https://img.shields.io/badge/Manifest-V3-blue.svg)](./manifest.json)
[![Chrome](https://img.shields.io/badge/Chrome-114%2B-blue.svg)](https://developer.chrome.com/docs/extensions/reference/manifest)
[![Node](https://img.shields.io/badge/Node-20-blue.svg)](https://nodejs.org/)

Chrome / Edge Manifest V3 书签管理扩展。用标签组织书签，清理重复与空文件夹，支持隐藏、回收站、备份和可选的 AI 打标。数据默认保存在本机。

## 特性

- **标签**：多标签、固定标签池、域名规则；相同规范化 URL 的书签保持标签一致。
- **检索**：侧边栏全局搜索，新标签页提供卡片与列表两种视图，支持键盘导航。
- **整理**：精确重复检测、空文件夹清理、拖拽排序、批量操作与删除撤销。
- **恢复**：独立隐藏视图与 30 天回收站。
- **迁移**：紧凑 V4 JSON 备份与恢复。
- **AI 打标**：本地规则优先，可选 OpenAI 兼容接口补充标签。

## 安装

需要 Chrome 或 Microsoft Edge 114 及以上版本，本地加载不需要商店开发者账号。

1. `git clone https://github.com/cfdywds/chrome-bookmark-manager.git`
2. 打开 `chrome://extensions/`（Edge 为 `edge://extensions/`），开启右上角的「开发者模式」。
3. 选择「加载已解压的扩展程序」，指向项目根目录，然后在工具栏点击「书签管家」打开侧边栏。

更新版本时替换为新版项目目录，并在扩展卡片上点击「重新加载」。本地解压扩展不会由浏览器自动更新，内部同步数据会保留。

## 标签同步

标签、隐藏状态、固定标签池和自定义标签规则会写入 Chrome 原生书签中的内部目录，随「书签」同步到同一 Google 账号下的其他设备。不需要固定扩展 ID、私钥或商店账号，各设备加载的扩展 ID 可以不同。

同步不包含书签标题、API Key、LLM 配置和回收站。Chrome 与 Edge 不要混为同一同步组，也不要手工改动该内部目录。排查、更新与回退步骤见[本地同步说明](./docs/release/chrome-web-store.md#本地同步)。

## 数据与隐私

- 书签、标签、隐藏状态、回收站和自定义规则默认保存在本机。
- 备份为紧凑 V4 JSON，仅当前版本导出的文件可恢复；相同完整 URL 的书签默认合并并合并标签，确认框可选择保留副本。备份不包含 API Key、模型和端点配置。
- 启用 AI 打标后，请求只包含书签标题、URL 的域名与路径，不含 query 与 fragment；命中登录入口、凭据参数及金融 / 钱包规则的书签不会外发。API Key 仅保存于本机。

完整安全边界与漏洞报告方式见 [SECURITY.md](./SECURITY.md)。

## AI 打标

在设置页选择服务商，填入 Base URL 和 API Key，获取模型列表并测试连接后，即可在「组织」页批量打标。支持 OpenAI、DeepSeek、Grok、Groq、Gemini、Ollama 和自定义 OpenAI 兼容服务。批量任务失败时已完成批次会保留，可从提示中「继续打标」只重试未写入的书签。

打标按域名规则 → 平台预设 → 标题 / 路径规则 → 主题关键词 → AI 补充的顺序执行，标签始终受固定标签池约束。规则在设置页按行配置，格式为 `关键词=标签1,标签2`；域名规则只匹配 hostname，其首个标签同时作为概览分类。首次使用某个服务时需要授予对应 API 域名的网络权限。

默认关闭的「后台静默使用 AI 补充标签」仅在浏览器新增书签且本地规则无法判断用途时请求 LLM，Chrome 原生批量导入不会触发。

## 开发

扩展没有运行时构建步骤，修改后在扩展管理页点击「重新加载」即可。开发与 CI 使用 Node.js 20。

```bash
npm install
npm test
npm run lint
```

设计与安全决策见 [DESIGN.md](./DESIGN.md)，贡献规范见 [CONTRIBUTING.md](./CONTRIBUTING.md)。维护 Chrome Web Store 版本时，`npm run release -- <version> --push` 会校验版本一致性、单测与 ESLint 后推送 tag，流程见[发布与回退说明](./docs/release/chrome-web-store.md#chrome-web-store-发布可选)。

## 许可证

[MIT License](./LICENSE)
