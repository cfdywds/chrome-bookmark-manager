# 更新日志

所有显著变更将记录于此文件。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 新增 `css/tokens.css`：popup / newtab / options 三页共用的唯一设计 token 来源（语义色、尺寸、层级、动效）。
- 新增 `js/ui.js`：共享 UI 原语（弹层焦点陷阱、统一 tooltip、分级 toast、快捷键注册表）。
- 新增 `icons/sprite.svg`：图标雪碧图单一来源；三个页面与脚本改为 `<use href="icons/sprite.svg#i-*">` 外链引用。
- 侧边栏新增搜索范围筛选（全部 / 标题 / 标签 / 网址 chips）、拖拽把手与投放高亮、概览快捷入口卡片。
- 「组织」页新增副标题提示，并在首次进入时给出一次性拖拽引导。
- 新标签页新增紧凑列表视图、文件夹筛选、卡片标签 chip 与键盘导航（j/k、方向键、Enter、Shift+Enter、e、Delete）。
- 新标签页文件夹筛选增加目录树层级、加载态和当前目录摘要；列表视图重新整理 favicon、主信息、标签状态与操作区。
- 设置页新增左侧锚点导航、分组状态摘要与「危险操作」集中区。
- 侧边栏顶栏新增版本号（读 manifest），与 newtab / options 统一为 `v<version>` 格式。

### Changed

- 备份、恢复和清空回收站统一迁移到 options 页底部的「危险操作」区；popup 只保留回收站查看、单项恢复和单项处理。
- newtab 文件夹下拉改显示可见书签数量，文件夹结构缓存签名覆盖根节点与子目录顺序，并统一复用共享 toast。
- newtab 隐藏和删除改为即时更新列表，删除后的回收站确认与标签清理异步收尾；成功提示改为轻量 compact 样式。
- options 删除 AI 配置改用带焦点陷阱的统一确认弹层。
- 清理 popup 中未使用的旧行动清单、向导、说明条和组织页工具条 CSS。

- 调色板集中到 `css/tokens.css`：删除 `css/popup.css` / `css/newtab.css` 中的重复变量与暗色硬编码补丁，`--danger` 等语义色全站统一。
- 弹层与抽屉统一使用 `UI.focusTrap` 并归还焦点，Esc 关闭逻辑收拢到 `UI.onEscape` 处理器栈。
- 交互控件提示从 `title` 迁移到 `data-tip`，由统一 tooltip（延迟 150ms、自动翻转、Esc 关闭）渲染。
- 批量操作栏改为悬浮 pill 形态；设置页保存反馈统一为全局 toast。
- 书签卡片的 favicon 兜底改为域名首字母 + 按域名哈希的底色，缺图标时不再显示灰块。
- 新标签页网格改用 `role="listbox"` + `role="option"` / `aria-selected` 语义，键盘高亮可被屏幕阅读器播报（替换语义不符的 `aria-current`）。
- 新标签页支持从搜索框按 `↓` 进入结果列表（焦点交给可聚焦的网格），`输入关键词 → ↓ → Enter` 全程无需鼠标。
- 侧边栏 toast 渲染统一委托给 `js/ui.js`（与设置页同一实现），保留本地实现作为无 UI 时的兜底。
- 新标签页卡片 / 行链接的完整标题提示由原生 `title` 迁移到统一 `data-tip`。

### Fixed

- 修复输入弹层内按 Tab 触发 `ReferenceError` 的问题（原焦点循环逻辑作用域错误，现统一走 `UI.focusTrap`）。
- 修复 `js/ui.js` 的 `initTooltip()` 重复调用会重复绑定全局监听、导致 Esc 被连续消费两次的问题（现为幂等）。
- 修复焦点陷阱只在容器内监听 keydown、焦点被点击或脚本移出弹层后 Tab 不再被拦回的问题（改挂 `document` 捕获阶段，且仅最上层陷阱生效）。
- 修复 tooltip 在 150ms 延迟窗口内移出后仍会补弹的问题（`scheduleTip` 立即接管 `tipOwner`）。
- 补齐 `.toast-out` 淡出样式：此前 `js/ui.js` 会加该类但无对应规则，统一 toast 会硬切消失。
- 修复文件夹筛选下拉只比较 id 与根计数、重命名文件夹后仍显示旧标题 / 旧计数的问题。
- 移除设置页两处非错误内联 `settings-msg` 噪音（「正在保存…」「设置已就绪 · 修改即时生效」），反馈统一走全局 toast。
- 修复书签行拖拽把手丢失 `draggable="true"`、导致书签排序 / 跨组移动无法启动的问题（文件夹把手不受影响）。
- 修复弹层打开时按 Esc 会同时关闭弹层并触发「退出文件夹」等页面级动作的问题：页面级 Esc 让位给 `UI` 陷阱，tooltip 不再消费 Esc。
- 修复键盘导航把 `#content` 的 `role="tabpanel"` 运行时改写成 `listbox` 的问题；列表容器改为可聚焦宿主并接管焦点，`aria-activedescendant` 才真正可被读屏消费。
- 移除 `help-dot` 的 CSS `::after` 气泡，提示只由 `js/ui.js` 渲染，消除 hover 时的双层气泡。
- 概览快捷入口卡片计数为 0 时不再渲染为可聚焦的伪按钮（改为 `aria-disabled`）。
- 提示卡边框的硬编码 `#cfe3f9` 提升为 `--hint-line` token，暗色主题下不再残留浅蓝描边。
- 侧边栏分组名与搜索高亮词的 `title` 提示迁移到 `data-tip`。
- 弹层 / 抽屉打开时页面级快捷键（`j/k`、`Enter`、`Delete` 等）一律让位给弹层，避免键盘高亮与焦点被偷回遮罩后的列表。
- `--hint-line` 补齐 newtab 两个显式主题块，系统主题与显式主题相反时不再用错描边色。
- 保存反馈在共享原语缺失时退回内联提示，不再静默丢反馈。
- 文件夹筛选下拉签名补上父级并按树对象缓存，跨层移动后不再显示旧层级，同时避免每次输入防抖都做 O(n) 拼接。
- 隐藏书签视图不再向 `role="tabpanel"` 的 `#content` 写入 listbox / `aria-activedescendant`。
- 新标签页 `↓` 进入列表改用 `preventScroll`，网格在视口外时不再滚动整屏；移除与 HTML 重复的 `role="listbox"` JS 声明。
- 清理 `help-dot` 气泡删除后残留的死 CSS（`.opt-card-title .help-dot::after` 等）。
- 修复 toast 动作按钮（「撤销」「继续打标」）无法鼠标点击的问题：`#toasts` 是 `pointer-events: none` 穿透层，按钮此前未显式收回点击。

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
- 标签原生同步不包含书签标题、API Key、LLM 配置或回收站，并且不依赖扩展 ID；隐藏状态随标签一起按规范化 URL 同步。

[Unreleased]: https://github.com/cfdywds/chrome-bookmark-manager/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/cfdywds/chrome-bookmark-manager/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/cfdywds/chrome-bookmark-manager/releases/tag/v1.0.0
