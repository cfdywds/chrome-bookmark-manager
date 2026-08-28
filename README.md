# 书签管家 · Bookmark Manager

Chrome / Edge Manifest V3 书签管理扩展。用标签整理书签，清理重复和空文件夹，并提供隐藏、回收站、备份与可选的 AI 打标。

## 功能

- 多标签、标签池、搜索和新标签页书签浏览；归一化同址书签自动保持标签一致。
- 精确重复检测、空文件夹清理、拖拽排序和批量操作。
- 隐藏书签、30 天回收站、JSON 备份与恢复、HTML 报告导出；恢复默认合并相同 URL，也可保留副本。单书签最多 6 个标签，已有标签优先。
- 可选的 OpenAI 兼容 LLM 打标，以及本地规则建议。
- AI 隐私保护：本地识别登录入口、访问凭据参数与金融/钱包服务；命中项不会发送给 LLM。

## 安装

需要 Chrome 或 Microsoft Edge 114 及以上版本。

```bash
git clone https://github.com/cfdywds/chrome-bookmark-manager.git
```

1. 打开 `chrome://extensions/`（Edge 为 `edge://extensions/`）。
2. 开启「开发者模式」，选择「加载已解压的扩展程序」。
3. 选择本项目根目录，随后在工具栏点击「书签管家」打开侧边栏。

当前以解压扩展方式分发，尚未上架 Chrome Web Store。

## AI 打标

在设置页选择服务商，填写 Base URL、API Key 和模型名后测试连接，再在「标签」页批量打标。支持 OpenAI、DeepSeek、Grok、Groq、Gemini、Ollama 和自定义 OpenAI 兼容服务。

API Key 仅保存于本机。AI 请求会跳过命中本地隐私保护规则的书签，只发送其余书签的标题、URL 域名和路径，不发送 URL query 或 fragment；首次使用某个服务时，需要授予该 API 域名的网络权限。该规则用于控制 AI 外发，不提供加密、隐藏或浏览器同步隔离。

## 隐私

- 书签、标签、隐藏状态、回收站和域名分组默认保存在本机。
- 备份不包含 LLM 配置或 API Key。
- 检查更新只访问 GitHub Releases API，不会发送书签数据。
- 书签由 Chrome 原生同步；启用「标签云同步」后，标签数据可通过 Chrome 同步到同一配置文件的其他设备。同步仅包含规范化 URL 键和标签名，不包含书签标题或页面内容。

完整安全边界与漏洞报告方式见 [SECURITY.md](./SECURITY.md)。

## 开发

扩展没有运行时构建步骤。修改后在扩展管理页点击「重新加载」即可；开发与 CI 使用 Node.js 20。

```bash
npm install
npm test
npm run lint
```

贡献规范见 [CONTRIBUTING.md](./CONTRIBUTING.md)，设计与安全决策见 [DESIGN.md](./DESIGN.md)。

## 发布

当前首发版本为 `v1.0.0`。后续版本使用带注释的 `vX.Y.Z` tag；发布前运行：

```bash
npm run check-version
npm run release -- 1.0.1 --push
```

发布脚本会校验版本一致性、单测、ESLint 和远端 tag。推送 tag 后，在 GitHub Releases 页面创建对应 Release；扩展会用该 Release 检查更新。详细变更见 [CHANGELOG.md](./CHANGELOG.md)。

## 许可证

[MIT License](./LICENSE)
