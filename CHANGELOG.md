# 更新日志

所有显著变更将记录于此文件。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added
- **无障碍与暗色模式**（专业评审落地）
  - 暗色模式：`prefers-color-scheme: dark` 完整适配（跟随系统主题）
  - WCAG AA 对比度修正：`--muted` 由 #9299ac 加深至 #6b7384（≈4.6:1）
  - 键盘可访问性：`/` 聚焦搜索、`Ctrl/Cmd+K` 聚焦搜索、`?` 打开指南、`Esc` 关闭抽屉/退出方案、`j/k` 上下移动高亮行、`Enter` 打开高亮书签（Shift+Enter 后台）
  - 抽屉焦点陷阱（Tab 循环）+ 关闭后恢复焦点
  - 全部按钮/输入 `:focus-visible` 焦点环
- **SVG 图标系统**：内联 `<symbol>` sprite（lucide 风格描边）替代跨平台渲染不一致的 emoji（顶栏 / 页签 / 按钮 / 空状态 / 错误页）
- **书签备份 / 恢复**：概览页新增卡片，一键导出全部书签为 JSON（含回收站记录），导入支持「预览统计 → 确认 → 恢复」（顶级同名文件夹自动复用，不覆盖现有）
- **拖拽排序**：书签行可同组拖拽重排；拖到分组标题可跨组移动（exact/domain → 域名文件夹，category → 分类文件夹）
- **AI 分类分批 + 重试**：按 50 条/批调用，429 限流指数退避重试，带实时进度条
- **批量栏增强**：新增「全选」「反选」；50 项以上删除触发危险操作二次确认（醒目警示条）
- **行为开关**：可在操作指南中关闭「点击图标自动弹保存抽屉」（存 bmAutoSaveDisabled）
- **方案预览防跳动**：plan 勾选 / 改分类改为局部更新计数与徽标，不再整页重渲染
- **折叠状态记忆**：分组折叠状态写入 sessionStorage，切换页签不丢失
- **撤销窗口延长**：可撤销删除 Toast 由 6s 延长至 10s
- **空状态文案优化**：由营销化改为可执行导向（如「重复书签已清理干净」）
- **错误日志**：AI 分类 / 拖拽 / 备份恢复失败写入本地 `bmErrorLog`（最近 50 条）
- **storage 版本号**：新增 `bmStorageVersion` 与 `migrateStorage()` 迁移钩子
- **工程化**：ESLint + Prettier 配置、vitest 单元测试（tests/lib.test.js，覆盖 urlKey / eTLD+1 / 25 类分类规则 / LLM 容错解析 / 敏感检测 / PROVIDERS）
- UI 体验改版（简洁直观 · 交互友好 · 功能完善）
  - 概览改「行动清单」：4 个核心 KPI + 带数字徽标的待办清单（有待办项自动排前），移除顶栏重复统计
  - 页签分组导航：整理 / 分类 / 安全 三组
  - 自定义确认弹层（替换原生 confirm，支持 ESC/Enter/点外部取消）
  - 删除操作 toast 内嵌「撤销」按钮，一键恢复原位置
  - 书签编辑：行内 ✏️ 按钮可改标题 / URL / 归属分类（新增抽屉升级为双模式）
  - 搜索命中高亮（标题/网址 <mark>）+ 搜索结果可批量操作
  - 批量栏新增「移动到」：勾选项批量移入分类文件夹（自动创建）
  - 各页签顶部「本页能做什么」说明条（敏感/失效/回收站已与提示合并为单条）
- 智能分类升级：v2 专业细分版（10 类 → 25 类）
  - 新增：AI / 人工智能、音乐 / 音频、学术 / 论文、游戏、动漫 / 二次元、汽车 / 交通、房产 / 家居、求职 / 职场、生活 / 工具 等
  - 关键词全面扩充（约 700 个，域名级/品牌级优先），消解泛词冲突（mail.qq.com→邮箱 / y.qq.com→音乐 / v.qq.com→视频 / weread.qq.com→阅读）
  - 修复误判：裸 `ar` / `meitu` / `word` 等泛词导致的 scholar / meituan / wordpress 归类错误
  - 新增 52 条分类规则冒烟测试（mock 验证全部通过）
- 回收站：删除的书签先进回收站，保留 30 天可恢复，到期自动永久删除
  - 后台 `chrome.alarms` 每日定时清理 + 打开面板时惰性清理（双保险）
  - 恢复优先放回原文件夹，原文件夹已删则回退书签栏
  - 新增「回收站」页签：恢复 / 永久删除 / 清空回收站
  - 概览 KPI 与向导新增回收站入口
  - 仅保护「书签管家」内的删除操作（去重 / 同域名 / 批量 / 单个）
- 扩展图标：紫粉渐变圆形图标（16 / 32 / 48 / 128 PNG），与品牌色一致
- 项目纳入版本控制（git init + `.gitignore`）
- README.md / CHANGELOG.md / LICENSE（MIT）项目文档

### Fixed
- `lib.js` 末尾 `(window)` 在 Service Worker 上下文报错的问题（改为兼容 `globalThis`），background 现可 `importScripts` 复用工具库
- 回收站入站时同批重复 id 未去重的问题

### Changed
- `lib.js` 收敛 LLM 服务商预设为单一来源 `BM.PROVIDERS`（popup.js / options.js 共享，消除重复定义）
- 分类规则相关：`parseAiCategories` 导出至 `BM` 便于单元测试
- `manifest.json` 注册 `icons` 字段与 `action.default_icon`，满足 Chrome Web Store 上架要求
- 默认分支使用 `main`（非 `master`）
- 删除类操作提示文案更新：「删除后 30 天内可在回收站恢复」

### Known tech debt
- background.js 与 lib.js 的回收站清理逻辑仍为双轨（MV3 已移除 importScripts）；ES Module 化需将 lib 体系改造为 ESM，暂以「常量对齐 + 注释互引」保证一致性，列为技术债

## [1.1.0] - 2026-08

### Added
- 精确重复检测与一键去重（每组保留首个）
- 同域名聚类（eTLD+1）与一键整理
- 智能归类：本地规则引擎（10 大分类、关键字匹配）
- AI 分类：OpenAI 兼容 LLM 客户端
  - 内置预设：OpenAI / DeepSeek / Grok / Groq / Gemini / Ollama / 自定义
  - 隐私保护：跳过 high 级敏感书签
  - 容错解析：支持代码围栏、JSON 容错、id 白名单
- 敏感书签检测：登录 / 银行 / 加密钱包 / 成人 / 医疗 / 政务 / 邮箱（仅本地）
- 空文件夹检测与清理（递归）
- 失效链接扫描（HEAD 请求，`mode: 'no-cors'`，UI 已标注 CORS 限制）
- 智能新增书签：URL 输入自动本地推荐分类，可点 AI 推荐
- 侧边栏主界面 7 个页签：概览 / 精确重复 / 同域名 / 智能归类 / 敏感 / 空文件夹 / 失效链接
- 统一方案引擎：删除 / 移动均走「预览 → 确认 → 执行」
- 报告导出（HTML 格式）
- 独立设置页（options.html）：侧边栏失焦不关闭，配置修改即时保存

### Privacy
- API Key 仅存本地（`chrome.storage.local`）
- AI 分类跳过高敏感级书签
- 一切数据处理在本地完成

### Architecture
- 分层：`lib.js`（工具 / 规则 / AI 客户端）→ `analyzer.js`（分析引擎）→ `popup.js` / `options.js`（UI）
- 设计系统：紫粉渐变 + 圆角（`css/popup.css`）
- 全局命名空间：`window.BM` / `window.BMAnalyzer`（script 顺序加载）

[Unreleased]: https://github.com/cfdywds/chrome-bookmark-manager/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/cfdywds/chrome-bookmark-manager/releases/tag/v1.1.0
