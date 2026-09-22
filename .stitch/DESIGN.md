---
version: alpha
name: 书签管家 Bookmark Manager
description: Chrome / Edge MV3 书签管理扩展的设计系统。窄栏侧边栏优先，亮 / 暗双主题，零构建原生 CSS。
colors:
  # 命名约定：无后缀 = 亮色（默认），-dark = 深色覆盖。
  # 对应 css/tokens.css 的 --c-*-l（亮色）与 --c-*-d（深色）。
  # ---- 表面层级（三档：bg → panel → sub）----
  bg: "#f3f5f8"
  bg-dark: "#0f1117"
  panel: "#ffffff"
  panel-dark: "#171b24"
  sub: "#f3f5f8"
  sub-dark: "#1b202b"
  sub-hover: "#e7ebf0"
  sub-hover-dark: "#202633"
  field: "#ffffff"
  field-dark: "#1e2430"
  fav: "#f3f5f8"
  fav-dark: "#242a36"
  # ---- 文本 ----
  ink: "#101828"
  ink-dark: "#f2f4f8"
  ink-2: "#344054"
  ink-2-dark: "#c3c9d4"
  muted: "#667085"
  muted-dark: "#8b93a3"
  # ---- 边线 ----
  line: "#e7ebf0"
  line-dark: "#242a36"
  line-2: "#dce1e8"
  line-2-dark: "#303845"
  # ---- 品牌主色 ----
  primary: "#2563eb"
  primary-dark: "#5da2f5"
  primary-soft: "#e9f1fe"
  primary-soft-dark: "#1a2436"
  # 主按钮实底：亮色为纯 primary，深色模式下项目实际使用
  # linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)，此处取深端作为合规基准
  action: "#2563eb"
  action-dark: "#1d4ed8"
  # ---- 状态色 ----
  danger: "#be123c"
  danger-dark: "#fb7185"
  danger-soft: "#ffe7ec"
  danger-soft-dark: "#3a2229"
  warn: "#92400e"
  warn-dark: "#fbbf24"
  warn-soft: "#fdf1d7"
  warn-soft-dark: "#332a14"
  ok: "#059669"
  ok-dark: "#34d399"
  ok-strong: "#047857"
  ok-strong-dark: "#6ee7b7"
  ok-soft: "#d5f5e7"
  ok-soft-dark: "#12332a"
  # ---- 检索高亮 ----
  mark: "#fde68a"
  mark-dark: "#7a5d10"
  # ---- toast 浮层（亮 / 暗两套主题下都是深底浅字，故同值）----
  toast-ink: "#ffffff"
  toast-muted: "#94a3b8"
  # ---- 实底前景 ----
  # on-solid：语义纯色实底上的文字（亮色底深→白字；深色底浅→深墨字）
  on-solid: "#ffffff"
  on-solid-dark: "#0f1117"
  # on-grad：动作渐变实底上的文字（两套主题的渐变都是深蓝，恒为白色）
  on-grad: "#ffffff"
  on-grad-dark: "#ffffff"
typography:
  body:
    fontFamily: "-apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif"
    fontSize: 14px
    lineHeight: 1.5
  mono:
    fontFamily: "ui-monospace, 'SF Mono', Consolas, monospace"
  title:
    fontFamily: "{typography.body.fontFamily}"
    fontSize: 13px
    fontWeight: 600
  meta:
    fontFamily: "{typography.body.fontFamily}"
    fontSize: 11px
    fontWeight: 400
  section-heading:
    fontFamily: "{typography.body.fontFamily}"
    fontSize: 16px
    fontWeight: 600
  display:
    fontFamily: "{typography.body.fontFamily}"
    fontSize: 22px
    fontWeight: 700
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
  page:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
  page-dark:
    backgroundColor: "{colors.bg-dark}"
    textColor: "{colors.ink-dark}"
  card:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "{spacing.s3}"
  card-dark:
    backgroundColor: "{colors.panel-dark}"
    textColor: "{colors.ink-dark}"
  group-head:
    backgroundColor: "{colors.sub}"
    textColor: "{colors.ink-2}"
  group-head-dark:
    backgroundColor: "{colors.sub-dark}"
    textColor: "{colors.ink-2-dark}"
  field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: 38px
  field-dark:
    backgroundColor: "{colors.field-dark}"
    textColor: "{colors.ink-dark}"
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  button-primary-dark:
    backgroundColor: "{colors.action-dark}"
    textColor: "#ffffff"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.sm}"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
  button-danger-dark:
    backgroundColor: "{colors.danger-dark}"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.sm}"
    size: 34px
  chip:
    backgroundColor: "{colors.sub}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.pill}"
    height: 22px
  chip-dark:
    backgroundColor: "{colors.sub-dark}"
    textColor: "{colors.ink-2-dark}"
  chip-active:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
  chip-hover:
    backgroundColor: "{colors.sub-hover}"
  chip-hover-dark:
    backgroundColor: "{colors.sub-hover-dark}"
  bookmark-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: 40px
  bookmark-meta:
    textColor: "{colors.muted}"
  bookmark-meta-dark:
    textColor: "{colors.muted-dark}"
  divider:
    backgroundColor: "{colors.line}"
  divider-dark:
    backgroundColor: "{colors.line-dark}"
  divider-strong:
    backgroundColor: "{colors.line-2}"
  divider-strong-dark:
    backgroundColor: "{colors.line-2-dark}"
  link:
    textColor: "{colors.primary}"
  link-dark:
    textColor: "{colors.primary-dark}"
  selection:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary}"
  selection-dark:
    backgroundColor: "{colors.primary-soft-dark}"
    textColor: "{colors.primary-dark}"
  badge-ok:
    backgroundColor: "{colors.ok-soft}"
    textColor: "{colors.ok-strong}"
    rounded: "{rounded.pill}"
  badge-ok-dark:
    backgroundColor: "{colors.ok-soft-dark}"
    textColor: "{colors.ok-strong-dark}"
  badge-warn:
    backgroundColor: "{colors.warn-soft}"
    textColor: "{colors.warn}"
    rounded: "{rounded.pill}"
  badge-warn-dark:
    backgroundColor: "{colors.warn-soft-dark}"
    textColor: "{colors.warn-dark}"
  badge-danger:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
    rounded: "{rounded.pill}"
  badge-danger-dark:
    backgroundColor: "{colors.danger-soft-dark}"
    textColor: "{colors.danger-dark}"
  status-dot-ok:
    backgroundColor: "{colors.ok}"
  status-dot-ok-dark:
    backgroundColor: "{colors.ok-dark}"
  status-dot-danger:
    backgroundColor: "{colors.danger}"
  status-dot-danger-dark:
    backgroundColor: "{colors.danger-dark}"
  favicon:
    backgroundColor: "{colors.fav}"
  favicon-dark:
    backgroundColor: "{colors.fav-dark}"
  search-highlight:
    backgroundColor: "{colors.mark}"
  search-highlight-dark:
    backgroundColor: "{colors.mark-dark}"
  modal:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.md}"
    width: 320px
  drawer:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.lg}"
    width: 440px
  toast:
    backgroundColor: "rgba(27, 30, 44, 0.97)"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
---

# 书签管家 · 设计系统

本文件是 **AI 设计工具与编码代理读取的设计系统规范**，遵循 [DESIGN.md 开放规范](https://github.com/google-labs-code/design.md)。

> **与仓库根 `DESIGN.md` 的区别**：根目录的 `DESIGN.md` 是工程决策文档（架构、安全边界、信任边界、已接受风险）；本文件只描述**视觉身份**。两者同名不同物，请勿合并。
>
> **运行时代码中的事实来源仍然是 `css/tokens.css`**。本文件是它在设计工具侧的投影；两者不一致时以 `tokens.css` 为准，并回写本文件。
>
> **命名映射**：本文件用「无后缀 = 亮色，`-dark` = 深色」；`tokens.css` 用 `--c-*-l` / `--c-*-d`。例如本文件的 `primary` / `primary-dark` 对应 `--c-primary-l` / `--c-primary-d`，运行时语义变量为 `--primary`。

## Overview

书签管家是一个零构建的 Chrome / Edge MV3 扩展，用标签整理书签、清理重复与空文件夹，并提供隐藏、回收站、备份与可选 AI 打标。

四个界面形态，尺寸与用途完全不同，**必须分别设计**：

| 界面 | 文件 | 画布尺寸 | 设计基调 |
|---|---|---|---|
| 侧边栏管理面板 | `popup.html` | **360px 窄栏**（Chrome 侧边栏内宽下限；项目自定 `min-width: 340px`） | 密集工具型：信息密度优先，13px 主字号，行高紧凑 |
| 新标签页 · 卡片 | `newtab.html` | **全宽 ≥1280px** | 展示型：大搜索框 + 卡片网格，负责「看」 |
| 新标签页 · 列表 | `newtab.html` | 全宽 ≥1280px | 检索型：单行 28px、固定列宽，负责「找」 |
| 设置页 | `options.html` | **全宽 ≥1024px**（≥720px 起左侧 200px 锚点导航） | 说明型：分组卡片 + 状态摘要，大留白 |

**核心设计意图**：安静、克制、以内容为主。这是每天被打开数十次的工具界面，不是营销页面——**装饰性动效、渐变氛围、大插图都是减分项**。

## Colors

颜色一律通过**语义角色**引用，禁止在组件里写死色值。

| 角色 | 亮色 | 深色 | 用途 |
|---|---|---|---|
| `bg` | `#f3f5f8` | `#0f1117` | 页面底色（最底层） |
| `panel` | `#ffffff` | `#171b24` | 卡片、分组、弹层表面 |
| `sub` | `#f3f5f8` | `#1b202b` | 次级表面：分组头、chip、内嵌区块 |
| `field` | `#ffffff` | `#1e2430` | 输入框 / 下拉 / 文本域底色 |
| `ink` | `#101828` | `#f2f4f8` | 主文本 |
| `ink-2` | `#344054` | `#c3c9d4` | 次级文本 |
| `muted` | `#667085` | `#8b93a3` | 弱化文本。亮色下对 `#ffffff` 对比度 ≈ 4.8:1，**已达 WCAG AA** |
| `line` | `#e7ebf0` | `#242a36` | 分隔线、外框 |
| `line-2` | `#dce1e8` | `#303845` | 更重的边线（输入框、分段控件外框） |
| `primary` | `#2563eb` | `#5da2f5` | 品牌主色：主按钮、选中态、链接、焦点环 |
| `primary-soft` | `#e9f1fe` | `#1a2436` | 主色弱化底：选中行、导航激活背景 |
| `danger` | `#be123c` | `#fb7185` | 删除、不可逆操作、错误 |
| `warn` | `#92400e` | `#fbbf24` | 警告、待处理 |
| `ok` | `#059669` | `#34d399` | 成功、已完成 |
| `fav` | `#f3f5f8` | `#242a36` | favicon 底衬（图标未加载时的兜底块） |
| `mark` | `#fde68a` | `#7a5d10` | 搜索命中高亮 |

**三档表面的层级关系**是最重要的视觉规则：`bg` → `panel` → `sub`。深色模式不能机械反色，必须保持三档可辨，否则卡片会糊成一片。

**对比度**：正文对背景 ≥ 4.5:1；大字号与图标 ≥ 3:1。新增颜色前先核算，不要靠肉眼判断。

### 对比度校验结论（官方 CLI 实测）

`designmd lint` 对本文件的输出已逐条核实，结论如下。

**误报 —— 透明底无法参与计算**。`button-ghost`、`icon-button`、`bookmark-row` 的 `backgroundColor` 是 `transparent`，linter 按纯黑代入故报低对比度；它们实际落在 `bg` / `panel` 上，对比度充足：

| 组合 | 实测 |
|---|---|
| `ink-2` `#344054` on `panel` `#ffffff` | 10.5:1 ✅ |
| `ink` `#101828` on `panel` `#ffffff` | 17.7:1 ✅ |

**曾经的待修问题（2 处，已在 UI 移植 P0 修正）**：

| 位置 | 组合 | 修正前 | 现状 |
|---|---|---|---|
| 深色模式主按钮 | 白字 on 渐变左端 | **3.68:1** ✗（`#3b82f6`） | 三个深色渐变起点统一加深为 `#2563eb`，白字 **4.5:1** ✅ |
| 警告徽标 | `warn` on `warn-soft` `#fdf1d7` | **4.48:1** ✗（`#b45309`） | `--c-warn-l` 调深到 `#92400e`，实测 **6.3:1** ✅ |

> 这两条是**用官方 linter 才发现**的——人工走查几乎不可能注意到 4.48 与 4.50 的差距。这正是把设计系统写成可校验文件的直接收益。

## Typography

单一无衬线字体栈，中文优先落到 PingFang SC / Microsoft YaHei：

```
-apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif
```

等宽栈（仅用于错误详情、代码片段）：`ui-monospace, 'SF Mono', Consolas, monospace`

| 层级 | 字号 | 字重 | 用途 |
|---|---|---|---|
| display | 22px | 700 | 设置页 hero 标题 |
| section-heading | 16px | 600 | 分组标题、弹层标题 |
| body | 14px | 400 | 正文、输入框（`popup` 基准） |
| title | 13px | 600 | 书签标题、按钮文字 |
| meta | 11px | 400 | 统计数字、路径、辅助说明 |

> **令牌化现状（P0 建立，P1 / P2 起消费）**：`tokens.css` 新增 `--font-sans` / `--font-mono` 两个字体族令牌，以及 `--fs-meta`(11) / `--fs-title`(13) / `--fs-body`(14) / `--fs-section`(16) / `--fs-display`(22) 五档字号阶梯；`popup.css` 与 `newtab.css` 的字体栈已收敛到 `var(--font-sans)`，基准字号统一 `var(--fs-body)`。`newtab.css` 与选项页分区（P2）已消费字号阶梯；其余分区仍有字面量字号，在后续分区移植时逐屏收敛。

## Layout

### 画布与断点

- **侧边栏**：360px 为设计基准。极窄降级：≤340px 隐藏版本号；≤380px 搜索范围 chip 横向滚动、图标按钮压到 32px；≤430px 隐藏次要列。
- **新标签页**：内容区宽度上限由用户设置控制（5 档：1080 / 1440 / 1720 / 2560 / auto，默认 1080px）。
- **设置页**：≥720px 为 `200px` 锚点导航 + 内容区双栏；<720px 导航收为顶部下拉。

### 间距

基准 4px 阶梯：`4 / 8 / 12 / 16 / 24`。

> **现状（UI 移植 P1 起）**：`newtab.css` 的卡片、行、chip、按钮已消费 `--space-*`；`popup.css` 的选项页分区（P2）也已收敛；其余分区仍以字面量间距为主，在后续分区移植时收敛。

### 层级（z-index）

`sticky 30` → `overlay 60` → `drawer 80` → `tooltip 90` → `modal 100` → `toast 200`。

### 动效

- 时长：快 `120ms`（状态反馈）、标准 `200ms`（位移 / 展开）
- 缓动：`cubic-bezier(.2, .8, .2, 1)`
- 必须响应 `prefers-reduced-motion`

> **现状（UI 移植 P1 起）**：`newtab.css` 的卡片、chip、按钮已改用 `--dur-fast` / `--dur` / `--ease`；`popup.css` 仍有多档时长字面量，P3 收敛。

## Elevation & Depth

阴影只有三档，语义固定：

| 档位 | 亮色取值 | 用途 |
|---|---|---|
| sm | `0 1px 2px rgba(15, 23, 42, 0.06)` | 卡片静置 |
| 默认 | `0 6px 20px rgba(15, 23, 42, 0.09)` | 卡片悬浮、弹层 |
| lg | `0 16px 48px rgba(15, 23, 42, 0.16)` | 抽屉、模态 |

吸顶搜索框另有带蓝调的 `sticky` 变体（`0 8px 24px rgba(15, 23, 42, 0.14)`）。深色模式一律改为纯黑并提高不透明度（如 `0 6px 20px rgba(0, 0, 0, 0.45)`）。

**不要用阴影表达层级之外的信息**（如状态、优先级）；那应该用颜色或文案。

## Shapes

圆角五档，语义固定：

| 档位 | 值 | 用途 |
|---|---|---|
| `xs` | 7px | 小方块、提示气泡、导航链接 |
| `sm` | 10px | 按钮、输入框、书签行、菜单 |
| `md` | 14px | 卡片、分组、弹层 |
| `lg` | 18px | 大搜索框、抽屉面板、设置页导航容器 |
| `pill` | 999px | chip、标签、徽标、批量操作栏 |

> **现状（UI 移植 P1 / P2 起）**：`newtab.css` 与 `popup.css` 的选项页分区已收敛到令牌档位（仅图标级小方块保留 4px）；其余分区与弹层族仍有约 20 档圆角字面量，P3 / P4 收敛。

## Components

- **button-primary**：主色实底 + 白字，圆角 `sm`。一屏最多一个主按钮。
- **button-ghost**：透明底 + `line` 边，用于次要动作（取消、全选、反选）。
- **button-danger**：危险色实底 + 白字，**仅用于不可逆操作**。
- **icon-button**：34×34，透明底，hover 出现 `bg` 底衬。必须带 `data-tip` 与 `aria-label`。
- **field**：`field` 底 + `line-2` 边 + 圆角 `sm`；聚焦时边框转 `primary` 并加 3px 半透明光环。
- **card**：`panel` 底 + 圆角 `md` + 阴影 `sm`；hover 升到默认阴影（**不做位移放大**）。
- **group**：书签分组容器，`panel` 底 + 圆角 `md`；分组头用 `sub` 底区分。
- **chip**：胶囊形，`sub` 底 + `ink-2` 字；激活态转 `primary` 实底 + 白字。
- **bookmark-row**：单行承载标题（单行省略）+ 标签 chip（≤2 个 + 余数）+ 所在目录。次要操作按钮默认 `opacity: 0`，hover 或键盘聚焦时显形；**触屏设备必须常驻**（`@media (hover: none)`）。
- **modal**：居中卡片，`max-width: 320px`，圆角 `md`，阴影 `lg`；必须带焦点陷阱与 Esc 关闭。
- **drawer**：右侧滑入，宽 `88%` / 上限 `440px`，圆角只留左侧 `lg`。
- **toast**：深色浮层 + 左侧 4px 级别色条（`ok` / `warn` / `danger`），圆角 `sm`。

**状态完备性**：每个列表型组件都必须定义 **空状态 / 加载态 / 错误态** 三种形态。

## Do's and Don'ts

### Do

- 只消费语义颜色角色。需要新颜色时，先在 `tokens.css` 的色阶里加值，再在**四个**主题映射块（默认亮色、系统深色媒体查询、`data-nt-theme=light`、`data-nt-theme=dark`）同步赋值。
- 深色模式按 `bg` / `panel` / `sub` 三档重新分配层级，而不是机械反色。
- 用 `4px` 倍数的间距，用五档圆角中的一档。
- 为每个交互元素提供 `:focus-visible` 样式与 `data-tip` 提示。
- 保持信息密度：这是工具界面，一屏能做的事越多越好。

### Don't

- ❌ 不要引入 Tailwind、React 或任何 UI 库——项目是零构建原生 HTML/CSS/JS。
- ❌ 不要使用 Material Design 或 Google 品牌色（`#4285F4` 等）。
- ❌ 不要用紫色渐变、玻璃拟态、霓虹光晕等通用 AI 视觉风格。
- ❌ 不要出现营销区块：hero 大图、定价卡、订阅引导、图表看板——这不是本产品的模块。
- ❌ 不要在组件里写死 hex / rgba，也不要新增令牌之外的圆角与时长。
- ❌ 不要用 `title` 属性做提示（统一走 `data-tip`）。
- ❌ 不要把卡片做成大圆角大留白的「展示卡」——侧边栏是密集列表场景。
