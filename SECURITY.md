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
- 标签云同步只包含规范化 URL 键的标签、固定标签池和自定义标签规则。标签和规则文字可能反映浏览偏好；LLM profile、API Key、端点、模型、可选主机权限和自动 AI 设置绝不进入同步 payload。
- Chrome Sync 按扩展 ID 隔离。生产设备必须安装同一个 Chrome Web Store 条目，解压开发版本不应被视作生产同步身份。
- 开发公钥仅可存在于本地开发 manifest 副本；扩展私钥、API Key 和个人备份不得提交到 Git。

## Known Limitations

AI privacy protection is heuristic and cannot guarantee that a bookmark title or path contains no private data. It is an outbound-LLM safeguard, not encryption, hiding, or browser-sync isolation. Review AI batches before confirming them, and do not use an untrusted LLM endpoint.
