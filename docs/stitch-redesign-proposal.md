# 用 Google Stitch 重做「书签管家」界面 · 调研与实施方案

> 版本：v1.0（调研稿）
> 日期：2026-09-21
> 范围：`popup.html`（侧边栏）、`newtab.html`（新标签页）、`options.html`（设置页）的样式 / 交互 / 布局
> 前置约束：**保持零构建、MV3、原生 JS、`tests/ui-redesign.test.js` 全绿**
> 关联文档：[`docs/ui-redesign-proposal.md`](./ui-redesign-proposal.md)（上一轮手工改造，已落地）、[`DESIGN.md`](../DESIGN.md)

---

## 一、结论先行

**Stitch 适合本项目的哪一环？**

适合：**视觉与布局方向的探索和收敛**，尤其是窄栏侧边栏与卡片/列表两种浏览形态。
不适合：**直接替换现有代码**。本项目有 361 行 UI 结构断言、零构建约束、纯中文文案和重度自定义交互（拖拽排序、FLIP 落位、乐观更新、焦点陷阱栈），Stitch 的输出无法直接满足。

**推荐路线：以 `DESIGN.md` 为唯一桥接物的「设计参考稿 → 受约束移植」流程（第五节路线 B）。**

三条关键判断：

1. **匹配度意外地好**。Chrome 侧边栏内宽存在硬下限（约 320–360px，浏览器级约束、扩展无法突破；本项目另在 `popup.css:40` 自定 `min-width: 340px`），正好落在 Stitch 最擅长的窄屏区间；而 Stitch 的代码输出是「语义 HTML + 带变量的结构化 CSS + Grid/Flexbox」，与项目现有的 `tokens.css` 变量体系天然同构——比 React 项目接 Stitch 的摩擦小得多。
2. **真正的瓶颈不是 Stitch，是回归防线**。`tests/ui-redesign.test.js` 把 P0–P2 的组件结构、选择器名、脚本加载顺序、图标引用方式全部固化成断言。任何"整页替换"都会立刻红。因此 Stitch 产物必须定位为**设计意图来源**，而非可粘贴的代码。
3. **中文是已知缺口**。Stitch 对中文提示词可用，但生成界面内的文案默认输出英文，且历史上多次尝试切换中文未稳定成功。本项目是纯中文 UI——这个缺口可以绕过：**只让 Stitch 定布局与视觉，文案沿用现有 HTML 中的中文字符串**，反而比让它写中文更干净。

---

## 二、Stitch 能力速查（2026-09 现状）

### 2.1 产品形态

Stitch 于 2026-03-18 重构为 **AI 原生无限画布**（Stitch 2.0），2026-05-19 的 I/O 更新加入实时流式生成与 steering、语音设计、代码库导入、导出 Antigravity / AI Studio、Netlify 一键发布。

| 阶段 | 时间 | 关键变化 |
|---|---|---|
| 初版（Galileo AI 衍生） | 2025-05 | 文生 UI、HTML/CSS 导出、Copy to Figma |
| Vibe Design 重构 | 2026-03-18 | 无限画布、Design Agent、多屏（≤5）、交互原型、**DESIGN.md**、URL 设计系统提取 |
| DESIGN.md 开源 | 2026-04-21 | 规范以 Apache 2.0 开放，可跨工具使用，附 CLI lint |
| 实时设计 | 2026-05-19 | 流式生成 + 中途 steering、语音模式、代码库导入、Antigravity/Netlify 导出 |

### 2.2 三种接入界面

| 接入方式 | 形态 | 对本项目的适用性 |
|---|---|---|
| **网页画布** `stitch.withgoogle.com` | 人工操作，无限画布 + 对话迭代 | ✅ 主力。用于视觉探索、变体对比、截稿评审 |
| **MCP server** `npx -y @google/stitch-mcp@latest` | 供 coding agent 调用 | ⚠️ 可选。用于把设计稿拉进编辑器做对照实现 |
| **Agent Skills** [`google-labs-code/stitch-skills`](https://github.com/google-labs-code/stitch-skills) | 官方技能包，编排整套流程 | ⚠️ 部分可用。`extract-static-html` / `extract-design-md` 对取素材有用 |

### 2.3 官方 skills 清单（对本项目有用的部分）

| 技能 | 作用 | 本项目的用途 |
|---|---|---|
| `stitch::code-to-design` | 前端代码 → Stitch 设计（HTML 提取 + 设计系统 + 上传） | 把现有三页导入 Stitch 作为改版起点 |
| `stitch::extract-static-html` | 从**运行中**的 web app 提取自包含静态 HTML（内联 CSS 与图片） | ⭐ 解决 `chrome-extension://` 无法被 Stitch 抓取的问题 |
| `stitch::extract-design-md` | 从源码扫描并提取 `DESIGN.md` | ⭐ 从 `css/tokens.css` 自动生成设计系统文件 |
| `stitch::upload-to-stitch` | 上传本地资源（图片/HTML）到 Stitch 项目 | 上传页面快照 |
| `stitch::manage-design-system` | 上传 `DESIGN.md` 并把主题应用到全部屏幕 | 保证多屏一致 |
| `stitch::generate-design` | 文/图生成、编辑、生成变体 | 生成改版候选稿 |

> 构建类技能（`react-components`、`react-native`、`shadcn-ui`、`remotion` 等）与本项目无关，可直接跳过。

### 2.4 官方 MCP 工具（社区整理，以官方文档为准）

项目管理 `create_project` / `list_projects` / `get_project`；屏幕 `list_screens` / `get_screen`；生成 `generate_screen_from_text` / `edit_screens` / `generate_variants`；取回 `get_screen_code`（原始 HTML）/ `get_screen_image`（PNG）。另有按 `projectId`+`screenId`（**纯数字，无 `projects/` 前缀**）取用的约定。

### 2.5 配额与成本

口径随版本变化，以下为 2026 年多方来源的交集，**以 Stitch 设置页显示的实际用量为准**：

| 口径 | 额度 | 来源 |
|---|---|---|
| 早期 Standard / Experimental | 350 / 50 次每月 | 2025 年多篇评测 |
| 2026-03 扩容 | 550 次每月（350 标准 + 200 Pro） | 多个评测站 |
| 2026-04 起（按日） | 400 design credits + **15 redesign credits** 每日，UTC 零点重置 | banani.co |

要点：**完全免费、无付费档、无信用卡**。`redesign`（从 URL 复制样式）额度显著更少（约每日 15 次），要省着用。业界普遍预期 2026 Q4 转付费后免费额度会缩水。

### 2.6 已知缺陷（会直接影响本项目）

| 缺陷 | 影响 | 应对 |
|---|---|---|
| 生成接口认证不稳（API key 不支持生成，需 OAuth） | MCP 路线可能卡住 | 优先用网页画布，MCP 仅作增强 |
| `list_screens` 在浏览器中未打开该项目时返回空 | MCP 自动化脚本会误判 | 先手工打开一次项目 |
| 界面文案默认英文，中文切换不稳定 | 纯中文项目需二次本地化 | 只取布局/视觉，文案沿用现有中文串 |
| 数据密集型桌面界面（密集表格、嵌套侧栏）表现弱 | `options.html` 与 `popup` 列表视图会偏generic | 这类界面以"局部参考"方式使用，不整页照搬 |
| 复杂交互（拖拽、动画、自定义视觉）需手工实现 | 拖拽排序、FLIP 落位无法生成 | 交互继续由 `js/ui.js` 承担，Stitch 只管静态视觉 |
| 提示词越模糊输出越 generic（易出紫色渐变 / Google 味） | 视觉不贴项目气质 | 用第八节的「令牌白名单 + 禁止清单」约束块 |
| Google Labs 实验品，可能下线或转付费 | 流程不可作为长期唯一依赖 | 所有产物（DESIGN.md、快照、截图）留档在仓库内 |

---

## 三、本项目与 Stitch 的匹配度分析

### 3.1 契合点

| 项目现状 | Stitch 对应能力 | 判断 |
|---|---|---|
| 侧边栏窄栏（约 340–480px） | Stitch 强于 mobile-first 窄屏布局 | ✅ 正中强项 |
| `tokens.css` 单一变量源 + 亮/暗双主题 | `DESIGN.md` 导入/导出、主题应用到全屏 | ✅ 可无损桥接 |
| 零构建、单文件 CSS | Stitch 输出 HTML/CSS + CSS 变量 + Grid/Flex | ✅ 摩擦小 |
| `newtab` 已有卡片/列表双视图 | `generate_variants` 生成并排变体 | ✅ 适合做形态对比 |
| 三页共享一套组件（`.search-box`、行、卡片、chip） | 多屏 + 统一设计系统 | ✅ 适合一致性收敛 |

### 3.2 冲突点（必须设计对策）

| 冲突 | 说明 | 对策 |
|---|---|---|
| **361 行结构断言** | 组件类名、脚本顺序、图标引用被 `tests/ui-redesign.test.js` 固化 | Stitch 产物一律**不进仓库代码路径**，只放 `docs/stitch/` |
| **禁止 Tailwind / 框架** | 项目零构建，无 `package.json` 运行时依赖 | 只接受"纯 HTML/CSS 参考"，禁止采纳 Tailwind className |
| **文案必须中文** | Stitch 输出英文占位 | 移植时用现有中文串替换，Stitch 稿只作布局度量 |
| **拖拽 / FLIP / 乐观更新 / 焦点陷阱** | Stitch 不生成这类交互 | 交互层完全保留，只让 Stitch 影响静态层 |
| **根目录 `DESIGN.md` 已被占用** | 现有 `DESIGN.md` 是**工程决策文档**（Architecture/Security/Trust Boundaries），与 Stitch 的 `DESIGN.md`（设计系统规范）**同名不同物** | Stitch 用 `.stitch/DESIGN.md`，绝不覆盖根文件（见第六节） |
| **双主题** | DESIGN.md 规范的 `colors` 是扁平 token 组，**无内置 light/dark 机制** | 用 `-l` / `-d` 后缀命名，正好对齐 `--c-*-l` / `--c-*-d` |

### 3.3 已有跨页复用资产（改版起点，不要重造）

实测三页 HTML/CSS 的类名分布：

| 资产 | 证据 | 复用程度 |
|---|---|---|
| 弹层体系 `.modal` / `.modal-card` / `.modal-title` / `.modal-msg` / `.modal-actions` | `popup.html` 3 处、`newtab.html` 2 处、`options.html` 1 处，类名完全一致 | ✅ 样式在共享的 `popup.css`，真跨页复用 |
| 图标 `icons/sprite.svg#i-*`（34 个 `<symbol>`） | 由测试断言强制 | ✅ 唯一来源；但 `options.html` 另有 14 个内联 `<path>` 图形绕过它 |
| 交互原语 `js/ui.js`（329 行） | 三页均加载且早于页面自身脚本 | ✅ focusTrap / tooltip / toast / 快捷键；**但不含 modal / drawer / tabs / skeleton 原语** |
| 内联反馈 `.settings-msg`（`role="alert"`） | `options.html` 10 处、`popup.html` 1 处 | ✅ 表单内错误单轨 |
| 搜索框 `.search-box` / `.search-box.lg` | `popup.html:17`、`newtab.html:89` | ⚠️ **仅这两处统一**；popup 内另有 `.search-hero`（概览页）、`.org-search`（组织页），实际**共 4 套形态** |

→ 改版时这些是**硬约束**：Stitch 参考稿若提出另一套弹层或搜索框形态，必须映射回既有类名，不得引入平行实现。

> 修正：上一轮 P2 的「统一搜索框两档尺寸」只覆盖了 popup 顶栏与 newtab 之间，popup 内部仍留有 `.search-hero` / `.org-search` 两套。这是本轮可直接收益的清理点。

### 3.4 设计系统实况：token 已建立，但逃逸严重

这是本方案最重要的事实基础。`tokens.css` 定义 **146 个变量**，结构良好（色值只在 `--c-*` 出现一次），但组件层的实际消费情况是：

| 现象 | 实测证据 | 后果 |
|---|---|---|
| **5 个间距 token 零引用** | `--space-1/2/3/4/6`（tokens.css:312-316）组件层无一处使用 | 间距全靠字面量，无节奏 |
| **18 个 token 定义后从未被引用** | 7 个 `--c-slate-*`、`--primary-2`、`--accent`、`--pink`、`--grad-brand`、`--space-*`、`--overlay-bg`、`--focus-ring` | 死值，误导后续维护 |
| **圆角 20 档字面量 vs token 5 档** | 2/3/4/5/6/7/8/9/10/12/13/14/18/22px…（`.opt-card` 22px、`.nt-card` 12px） | 视觉不统一 |
| **字号 19 档全部字面量，无 token** | 10.5px–44px | 字体阶梯根本不存在 |
| **动效 12+ 档字面量 vs token 3 个** | `--dur-fast` 仅被引用 7 次，`--dur` **仅 1 次** | 动效不一致 |
| **品牌蓝阴影 18+ 处硬编码，11 档 α** | `rgba(37,99,235, .12/.14/.15/.18/.25/.28/.3/.32/.35/.4/.45)` | 同类效果 11 种强度 |
| **`--overlay-bg` 定义了却被绕过** | 三处遮罩手写 `rgba(15,13,40,.5)` / `rgba(20,16,60,.35)` / `rgba(15,23,42,.5)` | token 形同虚设 |
| **`--focus-ring` 定义了却手写 30+ 处** | 重复 `outline: 2px solid var(--primary)` | 同上 |
| **两套半透明表达法** | `popup.css` 零 `color-mix()`、全用 `rgba()` 字面量；`newtab.css` 用 12 处 `color-mix()` | 同一设计语言两套写法 |
| **主题能力不对称** | 只有 newtab 能显式切主题（`data-nt-theme`）；popup / options 只能跟随系统 | 设置页「页面配色」只作用于新标签页 |

**两处可确认为缺陷的硬编码**：

- `popup.css:2830` —— 设置页画布 `linear-gradient(160deg, #eef3fa, #f6f9fc, #ecf9fb)` 为硬编码浅色，**暗色模式下仍是浅色**，与深色 `.opt-card` 并置。
- `popup.css:601` —— `.dead-dot.unknown` 硬编码 `#cbd2dc`，暗色下不跟随主题。

**这正是 Stitch / DESIGN.md 桥接的核心价值**：DESIGN.md 规范把 `typography`、`rounded`、`spacing`、`components` 列为一等章节，官方 CLI 的 `lint` 会校验 token 引用完整性与结构合规。把设计系统写成 DESIGN.md，等于**给上述逃逸项建立一份可机器校验的清单**——这是纯人工走查抓不到的。

**与 Stitch 解耦的顺手修复**：`popup.css:2830`（暗色画布）与 `popup.css:601`（状态点）是两处**确凿的显示缺陷**，不依赖 Stitch 即可修复，建议纳入 P0；`--space-*` 全死、`--overlay-bg` / `--focus-ring` 被绕过、品牌蓝阴影 11 档 α、圆角与字号阶梯缺失，这些收敛工作也可在 Stitch 产物落地前独立完成——它们本身就是本轮改版的收益。

---

## 四、不可动摇的约束（Invariants）

移植任何 Stitch 产物时必须同时满足以下契约（全部来自现有测试，改版不得使其变红）：

| # | 约束 | 来源断言 |
|---|---|---|
| 1 | 三页先加载 `css/tokens.css`，再加载 `css/popup.css`（newtab 再加载 `newtab.css`） | 加载顺序断言 |
| 2 | 语义变量**只允许**在 `tokens.css` 定义，`popup.css` / `newtab.css` 不得重复定义 `--bg`…`--shadow-lg` | 调色板单一来源 |
| 3 | `@media (prefers-color-scheme: dark)` 内**只允许出现 `:root`** 选择器，禁止组件暗色补丁 | 暗色零补丁 |
| 4 | `:root[data-nt-theme='light'/'dark']` 必须存在，且位于系统深色媒体查询**之后** | 显式主题优先级 |
| 5 | 图标唯一来源 `icons/sprite.svg`，引用形如 `sprite.svg#i-*`；`popup.html` 禁止内嵌 `<symbol>` | 图标单一来源 |
| 6 | 脚本加载顺序精确：`lib.js → ui.js → analyzer.js → popup.js`（newtab 另有 `newtab-search-engine.js`） | 脚本顺序断言 |
| 7 | `js/ui.js` 必须提供 `focusTrap` / `releaseTrap` / `onEscape` / `initTooltip` / `toast` / `registerShortcut` / `shortcutHtml` | 交互原语断言 |
| 8 | 禁止 `title` 属性提示，统一 `data-tip` | tooltip 单轨 |
| 9 | 危险操作（备份/恢复/清空回收站）只在 `options` 页底部，`popup` 不得出现 | 危险区收敛 |
| 10 | 版本号统一 `'v' + chrome.runtime.getManifest().version` | 版本号断言 |
| 11 | 既有 P2 结构（`entry-card`、`bulk-bar.pill`、`drag-handle`、`nt-row-*`、`optNav`、`danger-zone` 等）保留 | P2 结构与信息架构 |
| 12 | 无障碍：`aria-activedescendant` + `role="listbox"/"option"`、`aria-selected`、`focus-visible` | a11y 断言 |

> 结论：**第六节的移植规则第 1 条就是「Stitch 输出的 CSS 必须先把色值翻译回语义变量，再决定是否采纳」**。任何在组件里写死 hex 的产物一律退回。

---

## 五、接入架构：三条路线

| 维度 | 路线 A · 纯视觉探索 | **路线 B · DESIGN.md 桥接（推荐）** | 路线 C · MCP 自动生成 |
|---|---|---|---|
| 做什么 | 截图/快照喂 Stitch，只取视觉稿 | 生成 `.stitch/DESIGN.md`，双向同步设计系统，再生成参考稿 | coding agent 经 MCP 直接生成页面 |
| 涉及文件 | 无（产物在 `docs/stitch/`） | `.stitch/DESIGN.md` + `docs/stitch/` | 会触碰 `*.html` / `*.css` |
| 测试风险 | 零 | 零 | **高**（易破坏 12 条不变式） |
| 中文处理 | 手工 | 手工 | 手工 + 返工 |
| 产出价值 | 方向选择 | 设计系统可复用、可 lint、可演进 | 短期代码量 |
| 适用 | 起步、单屏验证 | **主线** | 仅限新增页面/全新模块 |

**推荐组合：路线 A 起步验证（第 1 天）→ 路线 B 作为主线流程 → 路线 C 暂缓**，直到 Stitch 产物能被证明稳定通过现有测试为止。

### 5.1 为什么不让 Stitch 直接写代码

Stitch 生成的是**单文件大 HTML**（社区反馈"everything chunked in one file"）。本项目是三个独立页面 + 共享 `popup.css`（**3601 行**、有明确分区约定）+ 精确脚本顺序 + 361 行结构断言。把单文件 HTML 拆回这个架构，工作量大于人工按参考稿实现，且极易引入暗色补丁与重复令牌——正是上一轮 P0 刚清理掉的问题。

---

## 六、DESIGN.md 桥接方案

### 6.1 命名冲突处理（重要）

| 文件 | 用途 | 处置 |
|---|---|---|
| `/DESIGN.md`（已存在） | 工程决策文档：架构、安全边界、信任边界、已接受风险 | **保留不动** |
| `/.stitch/DESIGN.md`（新建） | Stitch / AI agent 读取的设计系统规范 | 新建，纳入 git |

Stitch 官方 skills 的示例路径就是 `.stitch/DESIGN.md`，与根 `DESIGN.md` 并存不冲突。

### 6.2 规范要点

`DESIGN.md` 由 **YAML frontmatter（机器可读令牌）** + **Markdown 正文（设计意图）** 两层组成。正文 8 个章节须按此顺序，可省略但不可乱序：

`## Overview` → `## Colors` → `## Typography` → `## Layout` → `## Elevation & Depth` → `## Shapes` → `## Components` → `## Do's and Don'ts`

令牌类型：Color（任意 CSS 颜色）、Dimension（数值+单位）、Token Reference（`{colors.primary}`）、Typography（对象）。省略章节须登记到 `omitted` 字段以免 lint 报警。

**规范没有内置多主题机制**——`colors` 是扁平 token 组。因此双主题靠命名约定表达，而项目现有命名正好可用：

```yaml
---
version: alpha
name: 书签管家 Bookmark Manager
description: Chrome/Edge MV3 书签管理扩展设计系统。窄栏侧边栏优先，亮/暗双主题，零构建原生 CSS。
colors:
  # 语义色 · 亮色（对应 css/tokens.css 的 --c-*-l）
  bg-l: "#f3f5f8"
  panel-l: "#ffffff"
  ink-l: "#101828"
  ink-2-l: "#344054"
  muted-l: "#667085"
  line-l: "#e7ebf0"
  primary-l: "#2563eb"
  primary-soft-l: "#e9f1fe"
  danger-l: "#be123c"
  warn-l: "#b45309"
  ok-l: "#059669"
  # 语义色 · 深色（对应 --c-*-d）
  bg-d: "#0f1117"
  panel-d: "#171b24"
  ink-d: "#f2f4f8"
  muted-d: "#8b93a3"
  line-d: "#242a36"
  primary-d: "#5da2f5"
  primary-soft-d: "#1a2436"
  danger-d: "#fb7185"
  field-d: "#1e2430"
  toast-bg-d: "rgba(10, 12, 18, 0.96)"
typography:
  body:
    # 基准取 popup.css:33（popup 为 14px；newtab 未设字号，继承浏览器默认 16px）
    fontFamily: "-apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif"
    fontSize: 14px
    lineHeight: 1.5
  mono:
    # popup.css:1752
    fontFamily: "ui-monospace, 'SF Mono', Consolas, monospace"
  heading:
    fontFamily: "{typography.body.fontFamily}"
    fontSize: 16px
    fontWeight: 600
rounded:
  xs: 7px
  sm: 10px
  md: 14px
  lg: 18px
  pill: 999px
spacing:
  s1: 4px
  s2: 8px
  s3: 12px
  s4: 16px
  s6: 24px
components:
  button-primary:
    backgroundColor: "{colors.primary-l}"
    rounded: "{rounded.sm}"
    color: "#ffffff"
  field:
    backgroundColor: "{colors.panel-l}"
    rounded: "{rounded.sm}"
omitted:
  - section: Elevation & Depth
    reason: "阴影仅 3 档（sm/default/lg），已在 Layout 中随表面层级一并说明"
---
```

> 上表的色值与圆角/间距**逐条对应 `css/tokens.css`**。生成时请以该文件为唯一事实来源，不要凭记忆填写。

**桥接过程中的第一个实际发现（字体漂移）**：`tokens.css` 把颜色、圆角、间距、层级、动效都令牌化了，**唯独字体族与字号没有**，于是组件层各写一份且已经不一致：

| 位置 | 字体栈 | 基准字号 |
|---|---|---|
| `css/popup.css:33` | `-apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif` | 14px |
| `css/newtab.css:10-11` | `-apple-system, **BlinkMacSystemFont**, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif`（无 `system-ui`） | 未设（继承 16px） |

`DESIGN.md` 的 `typography` 是规范中的一等章节，一旦建立就会把这类漂移暴露出来。建议借本轮一并收敛：在 `tokens.css` 新增 `--font-sans` / `--font-mono` / `--text-base`，两页改为消费变量。

### 6.3 生成与校验流程

```bash
# 1) 从现有源码提取初稿（官方 skill）
#    提示词：Scan css/ and *.html and extract the design system into .stitch/DESIGN.md
#    或手工按 6.2 编写

# 2) 规范校验（官方 CLI，检查令牌引用完整性 + WCAG 对比度 + 结构合规）
npx @google/design.md lint .stitch/DESIGN.md

# 3) 改动前后差异（令牌级）
npx @google/design.md diff .stitch/DESIGN.md .stitch/DESIGN.md.bak
```

建议把 lint 接进 CI（与现有 `npm test` 并列），这样**设计系统的一致性也变成可验证项**，而不是靠人工走查。

### 6.4 tokens.css 与 DESIGN.md 的双向关系

```
css/tokens.css  ──(提取)──>  .stitch/DESIGN.md  ──(上传)──>  Stitch 项目主题
      ▲                                                              │
      └──────────(人工/AI 移植，受第四节约束)──── 参考稿 + 变体 ◄──────┘
```

约定：**`tokens.css` 永远是运行时事实来源**；`.stitch/DESIGN.md` 是它在设计工具侧的投影。二者不一致时以 `tokens.css` 为准，并回写 `DESIGN.md`。

---

## 七、标准工作流

### P0 · 准备（0.5 天）

1. 建 `.stitch/` 目录，按 6.2 生成 `.stitch/DESIGN.md`，跑通 `lint`。
2. 建 `docs/stitch/` 存放所有产物（快照、截图、导出稿、评审记录），并加入 `.gitignore` 白名单（保留 markdown，忽略大图）。
3. 在 Stitch 设置页关闭「Allow AI model training」（隐私）。
4. 申请 Stitch API Key 备用（`stitch.withgoogle.com/settings`）。

### P1 · 取素材（0.5 天）

扩展页面是 `chrome-extension://` 协议，**Stitch 无法直接访问**。三条取材路径：

| 路径 | 做法 | 适用 |
|---|---|---|
| **静态快照**（推荐） | 加载扩展 → 打开页面 → 用 `stitch::extract-static-html` 提取自包含 HTML（内联 CSS/图片） | 需要像素级现状参考 |
| **截图上传** | 三页 × 亮/暗 × 关键状态各截一张，作为 Pro 模式图像输入 | 快速起步 |
| **公开 URL** | 把快照发布到 GitHub Pages / Netlify 预览，用 `redesign` 提取设计语言 | 想复用"从 URL 提取"能力（额度紧张，慎用） |

截图清单建议（每页亮/暗各一套）：

- `popup`：概览 Tab、整理 Tab（含拖拽把手与投放高亮）、隐藏 Tab、批量栏出现态、新增抽屉、确认弹层、空状态、帮助抽屉
- `newtab`：卡片视图、列表视图、文件夹筛选弹层、骨架屏、空状态
- `options`：锚点导航 + 分组卡（AI 分类 / 同步 / 备份 / 外观）、危险区、窄屏折叠态

### P2 · 生成（1–2 天）

- 单屏出发，先做 **`popup` 整理 Tab**（信息密度最高、最需要重设计）。
- 用 `generate_variants` 一次出 3 个方向（保守微调 / 中度重构 / 激进重排），并排对比。
- 复用第八节的约束块，把「360px、令牌白名单、禁止清单」写进每一条提示词。
- 同步做 `newtab` 卡片/列表形态的变体对比。

### P3 · 评审（0.5 天）

评审只看四件事，逐条打分：

1. **是否越界**：有没有出现白名单外的颜色/圆角/间距？有没有 Tailwind 类名或紫色渐变？
2. **窄栏适配**：360px 下是否横向溢出？触控目标 ≥ 32px？
3. **双主题**：深色稿是否只是反色，还是真的做了层级重排（`panel`/`surface-sub`/`field-bg` 三档）？
4. **信息架构**：是否真的减少了层级（而不是把现有结构换皮）？

产出：选定 1 个方向 + 一份「采纳/放弃」逐项清单，存入 `docs/stitch/`。

### P4 · 移植（2–4 天，按页灰度）

严格顺序：**`newtab`（结构最独立）→ `options`（半独立）→ `popup`（依赖最重）**。

每页移植规则见第九节。每完成一页立刻跑：

```bash
npm test          # 含 tests/ui-redesign.test.js
npm run lint
npm run format
```

### P5 · 验收（0.5 天）

- 双主题人工走查清单：亮/暗 × 三页 × 各弹层与空状态。
- 视觉回归：移植前对每页截「基线图」，移植后逐张比对。
- 键盘全流程：不碰鼠标完成"搜索 → 打开 → 编辑标签 → 删除 → 撤销"。
- 更新 `DESIGN.md` 的「UI Design System」与「UI Redesign Follow-up」段落记录本轮决策。

---

## 八、提示词模板

### 8.1 通用约束块（每次生成都要粘贴）

```text
[项目] Chrome/Edge MV3 浏览器扩展「书签管家」，零构建原生 HTML/CSS/JS，纯中文界面。

[本屏规格]
画布宽度：360px（Chrome 侧边栏内宽下限约 320–360px，浏览器级硬约束，扩展无法突破；
         本项目另在 popup.css 自定 min-width: 340px。务必按窄栏设计，不要按 1280px 桌面布局）
纵向：首屏约 720px 内可完成主任务

[设计令牌白名单 —— 只能使用下列值，不得引入其他颜色/圆角/间距]
浅色：bg #f3f5f8 / panel #ffffff / ink #101828 / ink-2 #344054 / muted #667085
      line #e7ebf0 / primary #2563eb / primary-soft #e9f1fe
      danger #be123c / warn #b45309 / ok #059669
深色：bg #0f1117 / panel #171b24 / ink #f2f4f8 / muted #8b93a3
      line #242a36 / primary #5da2f5 / primary-soft #1a2436 / field #1e2430
圆角：7 / 10 / 14 / 18 / 999 px
间距：4 / 8 / 12 / 16 / 24 px
字体：系统 UI 字体栈（-apple-system / Segoe UI / PingFang SC）

[必须]
- 同时给出亮色与深色两版
- 深色不是简单反色：须体现 panel / surface-sub / field-bg 三层表面差异
- 空状态、加载骨架、错误态各一

[禁止]
- 禁止 Tailwind、React 或任何 UI 库；只要语义 HTML + 原生 CSS
- 禁止 Material Design 与 Google 品牌色（#4285F4 等）
- 禁止紫色渐变、玻璃拟态、霓虹光晕等通用 AI 风格
- 禁止出现图表、营销 hero、定价卡、订阅引导等非本产品模块
- 文案请用英文占位，我会统一替换为中文；不要尝试生成中文字形
```

### 8.2 popup · 整理 Tab（首屏目标）

```text
设计书签管理器的「整理」视图（窄栏 360px）：
- 顶部：紧凑搜索框（含范围切换 chip：全部/标题/标签/网址），右侧齿轮与帮助图标按钮
- 中部：按分组归类的书签行列表。每行含 favicon、标题（单行省略）、标签 chip（≤2 个 + "+n"）、
  行尾按需显示的图标按钮（打开/编辑/删除）；行高约 40px，整块只有一条外框线
- 分组标题：可折叠，含计数胶囊；拖动书签经过时显示投放高亮
- 底部：随选中项浮出的批量操作 pill（圆角 999px、居中、含已选计数与操作按钮）
要求：信息密度优先，不要卡片化；每一行都必须能在 360px 内不横向滚动。
```

### 8.3 newtab · 浏览视图

```text
设计新标签页的书签浏览界面（全宽 ≥1280px）：
- 顶部吸顶区：大号搜索框（圆角 18px）+ 标签筛选条（可换行）+ 文件夹筛选入口 + 视图切换（卡片/列表）
- 卡片视图：响应式网格，卡片圆角 14px，含 favicon、标题两行、站点域名、标签 chip（≤2 个）
- 列表视图：单行五列（favicon / 标题 / 站点 / 目录 / 标签），行高 28px，固定列宽保证跨行对齐
- 状态：骨架屏、空状态（插画图标 + 标题 + 引导按钮）
要求：卡片负责"看"、列表负责"找"，两者视觉语言一致但密度明显不同。
```

### 8.4 options · 设置页

```text
设计设置页（全宽 ≥1024px）：
- 左侧固定锚点导航（AI 分类 / 同步 / 备份 / 外观 / 关于），点击平滑滚动定位
- 右侧分组卡片：每张卡片头部为 图标 + 标题 + 状态摘要（如 "AI 分类 · 已配置 DeepSeek"）
- 表单控件：输入框、下拉、开关、测试连接按钮、内联错误提示
- 页面底部：危险操作卡片（备份导出/恢复/清空回收站），红色左边框标识
要求：不用展开即可看到配置健康度；窄屏（<720px）时左侧导航自动收起为顶部下拉。
```

---

## 九、移植规则（Stitch 产物 → 零构建代码）

从 Stitch 参考稿落地到项目代码时，按以下顺序执行：

1. **先翻译颜色，再判断采纳**。Stitch 输出的 hex 必须映射回语义变量（`--bg` / `--panel` / `--ink` / `--line` / `--primary` / `--surface-sub` / `--field-bg` …）。若某个颜色在白名单里找不到对应语义变量，说明它是新增设计意图——须先在 `tokens.css` 的色阶里加值，再在三个主题映射块（`:root`、深色媒体查询、`data-nt-theme` 两态）中同步赋值，**绝不在组件里写死 hex**。
2. **只改 `css/*.css` 与既有类的属性值**，不新增顶层组件类名，除非同步更新 `tests/ui-redesign.test.js`（新增断言而非删除）。
3. **不采纳**：Tailwind className、`<style>` 内联块、单文件大 HTML 结构、任何 `<script>` 逻辑、Stitch 生成的图标库引用（一律换成 `icons/sprite.svg#i-*`）。
4. **交互零迁移**。`js/ui.js` 的 focusTrap / tooltip / toast / 快捷键注册表，以及拖拽、FLIP、乐观更新，全部保留原实现；Stitch 只影响静态层。
5. **文案取项目现有中文串**，不采用 Stitch 的英文占位。
6. **新增状态必须先归位**。空状态 / 骨架 / 错误态若新增样式，落入 `popup.css` 对应分区（base → 布局壳 → 原子件 → 复合组件 → 页面特例 → utilities），禁止文件尾追加。
7. **每页移植后**立即 `npm test && npm run lint`；`tests/ui-redesign.test.js` 出现红即回退该页。

---

## 十、验收与测试

### 10.1 现有防线（必须全绿）

`tests/ui-redesign.test.js`（361 行）覆盖第四节全部 12 条不变式；此外 `tests/popup-performance.test.js`、`tests/newtab-search.test.js`、`tests/ui.test.js` 等亦须通过。

### 10.2 建议新增的断言

| 新增测试 | 断言内容 |
|---|---|
| `tests/design-md.test.js` | `.stitch/DESIGN.md` frontmatter 中的颜色集合与 `tokens.css` 的 `--c-*` 色阶**双向一致**（防止设计系统与代码漂移） |
| 同上 | 8 个章节按规范顺序出现；省略章节已登记 `omitted` |
| `tests/design-md.test.js` | `.stitch/DESIGN.md` 不含 Tailwind 类名 / 白名单外色值 |
| CI | 追加 `npx @google/design.md lint .stitch/DESIGN.md` 步骤 |

最后一条是本方案最值得沉淀的收益：**设计系统一致性从"人工走查"变成"CI 可验证"**。

---

## 十一、成本、风险与不做的事

### 11.1 工作量估算

| 阶段 | 内容 | 预估 |
|---|---|---|
| P0 准备 | `.stitch/DESIGN.md` + lint 接入 + 目录约定 | 0.5 d |
| P1 取素材 | 三页 × 亮/暗 × 关键状态快照 | 0.5 d |
| P2 生成 | popup 整理 Tab + newtab 双形态变体 | 1–2 d |
| P3 评审 | 选方向 + 采纳清单 | 0.5 d |
| P4 移植 | newtab → options → popup 灰度 | 2–4 d |
| P5 验收 | 走查 + 回归 + 文档 | 0.5 d |
| **合计** | | **5–8 d** |

现金成本：**0 元**（Stitch 免费；注意 `redesign` 额度约每日 15 次）。

### 11.2 风险

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| Stitch 产物 generic、带 Google 味，不可用 | 中 | 浪费 1–2 d | 第 1 天做单屏最小验证（walking skeleton）再决定是否继续 |
| 生成能力认证不稳 / 产品变动 | 中 | MCP 路线受阻 | 主力走网页画布；产物全部留档在仓库 |
| 移植时引入暗色补丁或重复令牌 | 中高 | 破坏 P0 成果 | 移植规则第 1、7 条 + 现有测试拦截 |
| 数据密集界面（options、列表视图）产出偏差大 | 高 | 需大量返工 | 这两处只做局部参考，不整页照搬 |
| 中文缺口导致二次本地化成本 | 高 | 增加工时 | 只取布局与视觉，文案沿用现有中文串 |
| 越改越像"另一个产品"，丢失现有信息架构优势 | 中 | 体验倒退 | P3 评审第 4 条：只采纳真正减少层级的改动 |

### 11.3 非目标（本轮不做）

- 不引入任何构建工具、框架、Tailwind 或第三方 UI 库。
- 不让 Stitch 产物直接进入 `*.html` / `*.css` 代码路径。
- 不改数据层、同步协议、AI 打标逻辑（`lib.js` / `background.js` 不动）。
- 不重绘品牌图标（`icons/icon*.png`）。
- 不做多语言。
- 不使用 Stitch 的 Antigravity / AI Studio / Netlify 发布链路（与 MV3 扩展分发无关）。

---

## 十二、最小验证（建议的第一步）

在投入 P1–P5 之前，先用半天验证可行性：

1. 加载扩展，打开侧边栏「整理」Tab，截一张亮色图。
2. 用 8.1 约束块 + 8.2 提示词，在 Stitch 生成 3 个变体。
3. 按 P3 的四条标准打分。

**决策门槛**：若 3 个变体中至少有 1 个能在不引入白名单外颜色、且保持 360px 无横向滚动的前提下，给出比现状更好的信息层级，则继续 P1–P5；否则把 Stitch 降级为"灵感来源"（路线 A），不进入移植阶段。
