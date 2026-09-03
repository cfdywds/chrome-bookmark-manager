# Security Policy

## Reporting a Vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private security advisory form for this repository and include reproduction steps, affected version, and impact. Once the repository is public, maintainers must enable private vulnerability reporting in the repository security settings before accepting external reports.

## Supported Versions

Only the latest release is supported with security fixes.

## Security Boundaries

- Bookmark titles, URLs, folders, tags, imported backups, and release notes are untrusted input.
- New, edited, imported, and opened bookmarks are limited to HTTP(S) URLs.
- LLM requests require a user-granted, origin-specific optional host permission. Remote HTTP endpoints are rejected; HTTP is limited to local Ollama endpoints.
- LLM requests are locally blocked only for parsed login endpoints, non-empty credential parameters in URL queries/fragments, and financial/wallet service signals. Remaining requests strip URL queries and fragments.
- Backups do not contain API keys or LLM configuration.
- 标签原生同步只包含规范化 URL 键的标签、固定标签池和自定义标签规则。标签和规则文字可能反映浏览偏好；LLM profile、API Key、端点、模型、可选主机权限、自动 AI 设置、隐藏状态和回收站绝不进入同步数据。
- 同步数据以文件夹和分片标题写入 Chrome 书签的内部目录，并依赖同一 Google 账号的「书签」同步。数据不依赖扩展 ID；不同本地解压安装可以读取同一目录。
- 内部目录 `书签管家同步数据（请勿修改）` 是协议保留名称。插件会忽略它，用户不应在书签管理器或移动端修改、移动或删除它；手动操作可能造成同步数据丢失或延迟。
- 本地解压扩展不会随 Chrome 自动安装或更新。Chrome Web Store 发布可以提供扩展安装与更新分发，但不改变标签数据的同步边界。

## Known Limitations

AI privacy protection is heuristic and cannot guarantee that a bookmark title or path contains no private data. It is an outbound-LLM safeguard, not encryption, hiding, or browser-sync isolation. Review AI batches before confirming them, and do not use an untrusted LLM endpoint.
