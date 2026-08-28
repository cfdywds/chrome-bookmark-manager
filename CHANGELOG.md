# 更新日志

所有显著变更将记录于此文件。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Changed

- 书签备份恢复默认合并完整 URL 相同的书签并合并标签；预览中可选择保留副本。单书签最多保留 6 个标签，已有标签优先。
- 手动新增发现同 URL 书签时可直接编辑已有书签标签，或显式保留副本。
- 同一网址（无视协议、www、末尾斜杠和普通锚点，但保留非默认端口）的书签标签保持一致：AI 批量打标按网址去重后回填到同址全部书签；手动编辑、批量打标也会把标签并集同步到同址书签；新增「统一同址标签」一键收敛历史不一致。
- 将“敏感书签”独立列表调整为 AI 隐私保护：仅在登录入口、访问凭据参数、金融/钱包服务等明确高风险场景阻止 AI 外发。

## [1.0.0] - 2026-08-27

### Added

- 首次公开发布：Chrome / Edge Manifest V3 书签管理扩展。
- 多标签、标签池、书签隐藏、回收站、重复与空文件夹清理。
- 新标签页书签浏览、搜索、拖拽排序和批量管理。
- 可选的 OpenAI 兼容 LLM 打标，以及本地规则建议。
- 书签与扩展数据备份、恢复和 HTML 报告导出。

### Security

- 备份不导出 LLM 配置或 API Key。
- 新增、编辑、导入和打开书签时仅接受 HTTP(S) URL。
- LLM 仅处理非高敏感书签，且 URL query 与 fragment 不会发送。
- LLM 域名采用用户按需授予的可选网络权限。

[Unreleased]: https://github.com/cfdywds/chrome-bookmark-manager/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/cfdywds/chrome-bookmark-manager/releases/tag/v1.0.0
