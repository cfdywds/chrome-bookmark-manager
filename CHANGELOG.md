# 更新日志

所有显著变更将记录于此文件。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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
