# 更新日志

所有显著变更将记录于此文件。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [1.0.1] - 2026-09-03

### Changed

- 重组 README 的功能概览、快速开始、同步、隐私和开发发布说明，并补全 Edge 的扩展更新地址。
- 在侧边栏和新标签页加入 GitHub 开源仓库入口，补充窄屏与无障碍支持。
- 降低新标签页书签操作遮罩的不透明度，使卡片内容在悬浮操作时更清晰。

## [1.0.0] - 2026-09-03

### Added

- 首次公开发布：Chrome / Edge Manifest V3 书签管理扩展，支持本地解压加载。
- 多标签、标签池、书签隐藏、回收站、重复与空文件夹清理。
- 新标签页书签浏览、搜索、拖拽排序和批量管理。
- 可选的 OpenAI 兼容 LLM 打标、本地规则建议与规则批量应用。
- 紧凑 V4 JSON 备份与恢复；恢复默认合并完整 URL 相同的书签，且可选择保留副本。
- 可选的标签原生同步：标签、固定标签池和自定义规则通过 Chrome 书签同步在同一 Google 账号的 Chrome 设备间同步。

### Changed

- 同一规范化 URL 的书签共享标签；批量打标、手动修改和规则应用会保持同址书签一致。
- AI 打标采用确定性本地规则优先策略，并支持失败后继续处理未完成项目。
- 域名分组并入自定义域名规则；规则标签受固定标签池约束。
- 移除无实际用途的 HTML 分析报告导出和旧固定扩展 ID 本地构建流程。

### Security

- 备份不导出 LLM 配置或 API Key。
- 新增、编辑、导入和打开书签时仅接受 HTTP(S) URL。
- LLM 仅处理非高敏感书签，且 URL query 与 fragment 不会发送。
- LLM 域名采用用户按需授予的可选网络权限。
- 标签原生同步不包含书签标题、API Key、LLM 配置、隐藏状态或回收站，并且不依赖扩展 ID。

[Unreleased]: https://github.com/cfdywds/chrome-bookmark-manager/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/cfdywds/chrome-bookmark-manager/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/cfdywds/chrome-bookmark-manager/releases/tag/v1.0.0
