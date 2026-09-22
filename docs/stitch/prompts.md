# Stitch 提示词包 · 书签管家改版

> **为什么提示词是英文**：Stitch 的原生交互语言是英文。实测中文提示词可用，但生成更慢，且偶发不响应。下面每段 `text` 代码块都可以**直接复制粘贴**；紧跟其后的中文是你自己看的说明，不用粘贴。

---

## 0. 前置步骤

### 0.1 建项目

1. 打开 <https://stitch.withgoogle.com> 并用 Google 账号登录。
2. 右上角头像 → **Settings** → 关闭 **Allow AI model training**（隐私）。
3. 项目类型按屏分开选——**侧边栏两屏用 App，全宽三屏用 Web**。360px 窄栏正是移动端的主场，Stitch 在这个区间明显更强；桌面全宽布局才需要 Web。

   | 屏 | 类型 |
   |---|---|
   | `popup-overview` / `popup-organize` | **App** |
   | `newtab-cards` / `newtab-list` / `options` | **Web** |

   类型很可能跟项目绑定，因此建议**分两个项目**做：一个「书签管家·侧边栏」（App），一个「书签管家·全宽页」（Web），DESIGN.md 各导入一次。不要把窄栏屏和全宽屏塞进同一个项目——类型冲突会让其中一边走样。

4. 模型档位：输入框右下角默认是 **Balanced**（偏速度），点开选最高质量那一档。窄栏首屏值得花额度。

### 0.2 导入设计系统

把 `.stitch/DESIGN.md` 的全部内容导入 Stitch 的 design system 面板（入口在新建项目后左侧或顶部的 **Design system / Theme**；不同版本位置会变，认「导入 DESIGN.md」这个动作即可）。

导入后**先核对三件事**，不对就手动改：

- 主色是 `#2563eb`，不是 Google 蓝
- 圆角档位是 7 / 10 / 14 / 18 / 999，没有 22px 这种值
- 有亮色与深色两套（若 Stitch 只吃一套，就把 `-dark` 那组当作深色主题的附加说明贴进提示词）

> 这一步是本流程最重要的环节。设计系统导入正确，后面每一屏都会自动贴合；导入错误，后面每一步都要靠提示词硬掰。

### 0.3 准备现状截图

打开下面 5 个快照文件（双击即可，无需服务器），各自截一张全窗口图：

| 快照 | 对应界面 | 建议截图宽度 |
|---|---|---|
| `snapshots/popup-overview.html` | 侧边栏 · 概览 | 把窗口拖到约 380px 宽，让内容自然呈现窄栏形态 |
| `snapshots/popup-organize.html` | 侧边栏 · 组织 | 同上 |
| `snapshots/newtab-cards.html` | 新标签页 · 卡片 | 全屏（≥1280px） |
| `snapshots/newtab-list.html` | 新标签页 · 列表 | 全屏（≥1280px） |
| `snapshots/options.html` | 设置页 | 全屏（≥1280px） |

截图时**把系统主题切到浅色**做一套；如果时间允许，再切深色做一套（深色稿用于验证「三档表面」是否成立）。

> 上传截图的作用是让 Stitch **看懂现有信息架构**，不是让它照抄。每个提示词里都会写明这一点。

---

## 1. 通用约束块

**每一屏都要粘贴这一段**，再接该屏的专属提示词。

```text
PROJECT CONTEXT
A Chrome/Edge Manifest V3 bookmark-manager browser extension.
Zero-build stack: plain HTML + plain CSS + vanilla JS. No frameworks, no Tailwind, no UI libraries.

The attached screenshot shows the CURRENT implementation — use it to understand the existing
information architecture, then REDESIGN it. Do not simply restyle it.

DESIGN SYSTEM
Use ONLY the tokens listed below. Do not invent colors, corner radii, spacing values, or shadows.

COLOR PALETTE (exact values; these already exist as CSS custom properties in the codebase)
Light: bg #f3f5f8 | panel #ffffff | sub #f3f5f8 | field #ffffff
       ink #101828 | ink-2 #344054 | muted #667085
       line #e7ebf0 | line-2 #dce1e8
       primary #2563eb | primary-soft #e9f1fe
       danger #be123c | warn #b45309 | ok #059669
Dark:  bg #0f1117 | panel #171b24 | sub #1b202b | field #1e2430
       ink #f2f4f8 | ink-2 #c3c9d4 | muted #8b93a3
       line #242a36 | line-2 #303845
       primary #5da2f5 | primary-soft #1a2436
       danger #fb7185 | warn #fbbf24 | ok #34d399
Surface hierarchy is critical: bg -> panel -> sub. Dark mode must keep all three levels
distinguishable — never one flat background colour.

HARD CONSTRAINTS
- Output semantic HTML + plain CSS driven by CSS custom properties (var(--...)).
  Do NOT output Tailwind class names or inline styles.
- Support BOTH light and dark themes, driven by `@media (prefers-color-scheme: dark)` so the
  interface follows the operating system automatically. Do not rely on a manual toggle
  attribute alone. Dark must NOT be a mechanical inversion: keep three visually distinct
  surface levels (bg -> panel -> sub) so cards never merge together.
- Corner radii: ONLY 7px, 10px, 14px, 18px, 999px.
  CSS variables are --radius-xs (7px), --radius-sm (10px), --radius (14px),
  --radius-lg (18px), --radius-pill (999px).
  IMPORTANT: there is no --radius-md — do not invent variables that are not listed here.
- Spacing: ONLY 4px, 8px, 12px, 16px, 24px. Never use 3px, 15px, 22px or other values.
- UI copy: English placeholders only. I will localize to Chinese myself.
  Do NOT attempt to render Chinese glyphs.

VISUAL DIRECTION
Quiet, dense, content-first utility UI. This gets opened dozens of times a day.
- No purple gradients, no glassmorphism, no neon glow, no decorative illustration.
- No Material Design, no Google brand blue (#4285F4).
- No marketing blocks: no hero imagery, no pricing cards, no subscription prompts,
  no analytics dashboards with charts.
- No oversized rounded "display cards" floating in generous whitespace.

COLOUR DISCIPLINE (critical — earlier attempts failed exactly here)
- Tag chips, category chips and count badges ALL use one identical neutral treatment:
  background sub (#f3f5f8 light / #1b202b dark) with text ink-2 (#344054 / #c3c9d4).
  Do NOT give each tag or category its own colour.
- Status colours are ONLY for real status: danger #be123c / #fb7185,
  warn #b45309 / #fbbf24, ok #059669 / #34d399. Never decorative.
- Absolutely NO violet, indigo, purple, magenta or pink anywhere in the UI.
  No Tailwind palette colours (nothing like #8b5cf6, #6366f1, #3b82f6, #10b981, #f59e0b).
- Every colour in your output must appear in the COLOR PALETTE list above.
  If you feel you need another colour, use ink-2 or muted instead.

SCOPE — WHAT TO DRAW
Draw ONE screen of the real, populated product, exactly as a user sees it with data.
Do NOT produce a design-system showcase, a state gallery, or annotated documentation.
Do NOT render metadata labels in the UI such as "Empty State", "Loading State",
"Error State", "Required States" — and do not add a section that enumerates states.
(Empty / loading / error are separate screens; we design them later.)

COMPONENTS — PER SCREEN, DO NOT CARRY OVER
Each screen has its own required components; follow the per-screen section below.
Do NOT copy components from one screen to another. Specifically:

- The multi-select checkbox, the drag handle and the bulk-action bar belong to the
  SIDE PANEL's screens (Organize and Hidden) ONLY.
- The new-tab screens (card view and list view) have NO multi-select checkbox,
  NO drag handle and NO bulk-action bar. Their per-item actions are hover-revealed
  icon buttons only.
- ARIA-style "selected" state for keyboard navigation is a highlight, not a checkbox.

Draw every component with realistic data — no empty placeholder blocks.

DENSITY AND READABILITY (feedback from the previous round: it came out too cramped)
- Title/body text at least 13px. Secondary meta text at least 11px. Never below 11px anywhere.
- Bookmark rows about 44px tall — generous, not cramped.
- At least 12px of vertical space between group cards.
- Row internals: 16px horizontal padding; 8px gap between title line and meta line.
- Prefer breathing room over fitting more rows. This is a redesign — readability wins over density.

ICONS
- Simple outline icons only, 1.5-2px stroke. No filled icons, no emoji.
- The "AI tag" row action uses a FOUR-POINTED SPARKLE: a FULL, ROUNDED four-pointed star
  with concave (inward-curving) sides — plump, symmetric, evenly balanced, in the spirit
  of Google Gemini's mark.
  It must NOT be a thin sharply-spiked star, and must NOT be a five-pointed star
  (a five-pointed star reads as rating/favourite and is wrong here).
- Only use these icon concepts: search, plus, gear, help(?), home, folder, eye, eye-off,
  tag, trash, pencil(edit), refresh, alert-triangle, archive, four-pointed-sparkle.
  Do not invent unrelated iconography.
```

---

## 2. 侧边栏 · 概览（`popup-overview.html`）

```text
Design the OVERVIEW tab of the bookmark manager's side panel.

CANVAS
360px wide. This is the Chrome side-panel minimum inner width. Design for a narrow column,
NOT a desktop layout. Nothing may require horizontal scrolling.

STRUCTURE (top to bottom)
1. Fixed top bar: a compact search field filling available width; to its right a version chip
   and three 34px icon buttons (add bookmark / settings / help).
2. A full-width tab strip with three equal-width tabs, each with an icon:
   Overview / Organize / Hidden.
3. Scrollable content:
   - A 2x2 grid of KPI cards: total bookmarks (visually dominant), tags, pending cleanup,
     recycle bin.
   - A large hero search field — the primary entry point on this tab.
   - Three quick-entry cards in one responsive row: Duplicate bookmarks, Empty folders,
     Recycle bin. Each shows an icon, a label and a count badge. When the count is 0 the card
     must read as "done/inactive" (muted), and must not look like a clickable button.
   - A "Popular tags" card: a wrapped list of pill-shaped tag chips, each with a count.
4. Fixed footer with a single primary button: Rescan.

REDESIGN GOAL
The current overview is too long and requires too much scrolling; duplicate/empty-folder/
recycle-bin entries are embedded as long lists. Make them compact cards that would switch the
view instead of embedding content. Target: the main actions are reachable within the first
screen at 360x720.

DENSITY
Body text around 13px, list rows around 40px. Prefer information density over whitespace.
```

**中文说明**：这一屏是改版的主战场。要点是「概览瘦身」——现在它把重复书签、空文件夹、回收站三个入口连同内容都塞在同一页里，滚动很长。提示词要求把它们压成卡片入口，并明确要求零计数卡片呈现为「已完成」的灰态（项目里已有 `.done` 态样式对应）。

---

## 3. 侧边栏 · 组织（`popup-organize.html`）

```text
Design the ORGANIZE tab of the same 360px side panel.

CANVAS
360px wide, narrow column, no horizontal scrolling.

STRUCTURE (top to bottom)
1. Same fixed top bar as the Overview tab, then a tab strip with EXACTLY THREE
   equal-width tabs, each with an icon: "Overview", "Organize", "Hidden".
   The "Organize" tab is the active one.
   Do NOT invent extra tabs — this product has no "Clean-up", "Vault", "Settings"
   or "Archive" tab. Three tabs only.
2. A segmented control with two options: Tags / Folders, plus a compact toolbar button
   ("Directory tree") on the same row.
3. A one-line hint under the segmented control explaining what this view does.
4. Scrollable content: a list of collapsible GROUPS.
   Each group header contains: a type icon, the group name, a count badge, and (on hover)
   group-level actions. The header is a click target for collapse/expand.
   Each group body is a list of BOOKMARK ROWS.

BOOKMARK ROW (the most important component)
A single row, about 44px tall, comfortable rather than cramped. Left to right:
  - a drag handle: a 24x24px grip (two columns of three dots), vertically centred, muted.
    It sits at ~35% opacity at rest and becomes fully opaque on row hover.
    It must NEVER be completely invisible, and must not be smaller than 24x24px —
    the current implementation hides it entirely until hover and it is almost impossible
    to discover, which makes reordering look broken. This is a bug to fix, not to copy.
  - a checkbox for multi-select
  - the bookmark title (13px, single line, ellipsised)
  - the host or URL as secondary muted text (11px)
  - a category chip + up to two tag chips (with "+N" overflow) — all neutral coloured
  - row actions on the right, only visible on hover or focus:
    hide (eye), AI tag (plump four-pointed sparkle, not a five-pointed star), edit (pencil)
The entire row is clickable to open the link.

ROW METRICS
16px horizontal padding, 8px between the title line and the meta line, 44px total height.
Do not shrink these to fit more rows — the previous attempt was too dense.

REDESIGN GOAL
Drag-and-drop is currently undiscoverable and row actions are cramped. Make the drag affordance
obvious without stealing space (e.g. a handle that appears on hover), and give the row a clear
visual hierarchy between title, meta line, and chips. Multi-select must remain obvious enough
that users discover the bulk-action bar.

INTERACTION NOTES (describe visually, do not implement)
- Hovering a row reveals its handle and actions.
- A row being dragged shows a lifted state; a valid drop target group header highlights.
- Selected rows remain clearly marked while scrolling.

REQUIRED ON THIS SCREEN
- At least 3 collapsible GROUPS, each with a name and a count badge, expanded,
  each holding 4-6 bookmark rows.
- Every row carries a drag handle, a multi-select checkbox, the title, a muted meta line,
  a category chip and up to two tag chips (plus a "+N" overflow chip).
- BULK-ACTION BAR: when one or more rows are selected, a pill-shaped bar appears pinned near
  the bottom showing the selected count plus actions (打标签 / 移动到 / 删除选中 / 取消).
  It floats above the list without covering the last row.

DENSITY
Rows about 44px. This is a dense management list, not a card gallery — do NOT turn rows into
cards.
```

**中文说明**：这是信息密度最高、也最值得重设计的一屏。关键是书签行——现在拖拽把手、勾选框、标题、URL、目录、分类 chip、标签 chip、三个 hover 按钮全挤在 40px 一行里，层级不清且拖拽不可发现。提示词要求重排序的视觉优先级，并明确禁止「把行变成卡片」（项目上一轮已踩过这个坑）。

---

## 共享头部 · 新标签页（第 4、5 屏都必须附上）

> 为什么单独抽出来：第 4、5 屏的头部完全相同，但**生成时是分两次调用**的。若只在第 4 节定义头部、第 5 节写「同上」，生成第 5 屏时 Stitch 看不到那段，就会自己编一个——实测正是这样丢掉了搜索引擎选择器。所以这个块必须在两次生成时**都拼进去**（`gen-screens.ps1` 已自动处理）。

```text
SHARED HEADER — the new-tab page's sticky header (identical for the card and list views).
It stays pinned while only the result area below scrolls.

1. TOP ROW: brand mark + "书签管家" + a version chip on the left. On the right: a bookmark
   count ("284 个书签"), a "来源" text link, an "打开管理面板" button, and a two-button
   view toggle (grid icon / list icon) with the current view active.

2. SEARCH BAR — one rounded 18px field. Left to right:
   - SEARCH-ENGINE PICKER BUTTON: a small square button showing the current engine's logo
     (Google / Bing / 百度 / DuckDuckGo) plus a chevron. Tapping it opens a menu listing
     those four engines with the active one checked.
     *** THIS IS REQUIRED. Do not replace it with a scope/category dropdown
     (no "全部书签 ∨"), and do not omit it. ***
   - the search input (placeholder: "搜索书签，回车搜索网页")
   - an inline "?" help dot
   - a folder-filter icon button
   - a result count chip (e.g. "12 个匹配"), hidden when no filter is active
   - a "清除筛选" button with an x icon, hidden when no filter is active
   - a clear (x) button for the input itself
   The whole bar must stay usable down to 360px.

3. TAG FILTER ROW: a horizontally wrapped strip of pill chips — "全部" first with the total
   count, then one chip per tag with its count. The active chip uses the primary colour.

LAYOUT RULE — CRITICAL
The result area below the header is a FLAT collection.
Do NOT group bookmarks by folder, by tag, or by anything else. Do NOT add group headers,
section titles, or per-section sorting labels such as "已按添加时间排序".
The folder filter and the tag chips are the ONLY ways to narrow the list.
```

---

## 3b. 侧边栏 · 隐藏（`popup-hidden.html`）

> 这一屏是补漏：侧边栏有三个 tab，初版只设计了概览与组织，隐藏页被漏掉了。

```text
Design the HIDDEN tab of the same 360px side panel — where the bookmarks a user has hidden
from their daily view are listed.

CANVAS
360px wide, narrow column, no horizontal scrolling.

STRUCTURE (top to bottom)
1. Same fixed top bar as the other tabs, then the tab strip with EXACTLY THREE tabs:
   "Overview", "Organize", "Hidden". The "Hidden" tab is the active one.
2. A slim toolbar row (no segmented control, no sub-views on this tab):
   an eye-off icon + the text "已隐藏 N 个书签" with N in bold.
3. A FLAT list of hidden bookmarks — NO grouping, no group headers, no section titles.
   Rows reuse the SAME bookmark-row component as the Organize tab, but in a hidden state:
   - the whole row is de-emphasised (about 55% opacity)
   - the title carries a strikethrough
   - a small neutral "已隐藏" chip marks the row
   - the eye-off button is PERMANENTLY VISIBLE (not hover-revealed), because un-hiding is
     the primary action on this screen
   - the other actions (edit, delete) remain hover-revealed
   - the row keeps its drag handle and multi-select checkbox for consistency with Organize
4. Empty state when nothing is hidden: an eye-off icon, the title "没有隐藏的书签",
   and the description "隐藏的书签会显示在这里".

WHY THIS SCREEN EXISTS
It is a safety net, not a workspace. Users come here to check what they hid and to bring
something back. So the un-hide affordance must be the most obvious thing on every row, and
the list as a whole should read as parked/secondary rather than active.

DENSITY
Rows about 44px, consistent with the Organize tab.
```

**中文说明**：这屏的设计难点是「隐藏态」的表达——既要让用户看出这些书签是"被搁置的"（降透明度 + 删除线），又不能让它们显得像禁用项而无法操作。关键是**取消隐藏的入口必须最显眼**（眼睛按钮常驻），因为这是用户来这屏的唯一目的。与组织页的区别是**没有分组**——隐藏是个扁平的暂存区。

---

## 4. 新标签页 · 卡片视图（`newtab-cards.html`）

```text
Design the CARD view of the bookmark manager's new-tab page.

CANVAS
Full width, designed for 1280px and up. Content column is centred with a max width of 1080px.

STRUCTURE (top to bottom)
1. The SHARED HEADER exactly as specified above (sticky; only the result area scrolls).
2. Scrollable bookmark grid: responsive auto-fill columns, minimum 280px per card, 16px gap.
   Each card contains: a 48x48 favicon tile (with a coloured letter fallback), the title
   (up to 2 lines), the host name, and tag chips.
   Hovering a card reveals four small action buttons (copy / hide / edit / delete) in a corner.
   Keep the grid FLAT — no folder grouping.

REDESIGN GOAL
Cards are for SCANNING, not for reading. Make the favicon, title and host form a clear
three-level hierarchy inside the card, and make action buttons unobtrusive but discoverable.
The card must degrade gracefully: a missing favicon shows a stable coloured letter tile derived
from the host, never a grey empty box.

STATES — DO NOT DRAW THEM ON THIS SCREEN
Do not add blocks labelled "Loading State", "Empty State" or "Error State".
Do not add a "states" or "lifecycle" section anywhere on this screen.
Design ONLY the populated result view — a grid full of real bookmark cards.
(The loading skeleton and the empty state are separate screens, handled later.)

DENSITY
Cards around 112px tall. Compared with the list view, cards trade density for recognisability —
that trade-off should be visible in the design.
```

**中文说明**：这一屏是「看」的界面。要点是卡片内部三级层级（图标 → 标题 → 域名）、hover 才出现的操作按钮，以及 favicon 缺失时的稳定兜底（项目已用域名哈希出色相，提示词要求保持这个行为）。

---

## 5. 新标签页 · 列表视图（`newtab-list.html`）

```text
Design the COMPACT LIST view of the bookmark manager's new-tab page.
It uses the SHARED HEADER exactly as specified above — the header is identical to the card
view's; only the result area below it changes.

RESULT AREA
A dense table-like list, one bookmark per line, about 28px tall.
Fixed column widths so that columns align across every row:
  favicon (16px) | title (flexible, ellipsised) | host (190px) | folder path (158px) |
  tags (150px) | hover actions
- ONE flat block: a single header row (标题 / 站点 / 所在文件夹 / 标签 / 操作) followed by all
  bookmarks in a continuous list.
  Do NOT group by folder, do NOT add group headers or section titles, and do NOT add
  per-section sorting labels. See the LAYOUT RULE in the shared header block.
- The whole block has ONE outer border and row separator lines — do NOT wrap each row in its
  own bordered card. That would collapse it into a single-column card grid and destroy the
  point of this view.
- Tag column shows at most 2 chips plus a "+N" overflow chip.
- The folder path column shows the last two path segments, with the full path on hover.
- Hovering a row reveals its actions; on touch devices actions must always be visible.

REDESIGN GOAL
This view exists for FINDING a bookmark, not admiring it. Maximise scanability: strong left
alignment, tabular numerals for counts, and muted styling for secondary columns so the eye can
run down the title column. Make the visual difference from the card view unmistakable.

NARROW WIDTH BEHAVIOUR
Describe how columns drop progressively as width shrinks (drop folder column, then compress
host/tags, then reflow to two lines) — do NOT simply wrap every cell.
```

**中文说明**：这屏是「找」的界面。提示词里特意写了「不要给每行套卡片边框」——项目上一轮明确记录过这个退化风险。同时要求描述窄屏时逐级收敛列而不是换行。

---

## 6. 设置页（`options.html`）

```text
Design the settings page of the bookmark manager.

CANVAS
Full width, designed for 1024px and up. Two-column layout: a 200px sticky anchor navigation
on the left, content on the right. Below 720px the navigation collapses into a dropdown.

STRUCTURE
1. A hero header: brand icon + "Settings" title, and a subtitle line showing the version and
   the reassurance that all data stays local.
2. Left anchor nav listing five groups, with the active group highlighted.
3. Five grouped sections, each a stack of cards:
   - AI tagging: provider select, base URL, API key field with a show/hide toggle,
     a "fetch models" row with a combobox, a "test connection" button, an inline status message.
   - Tags & rules: fixed tag pool management, and a multi-line rules textarea.
   - Browser & sync: a toggle plus explanatory text and a status summary.
   - New-tab appearance: view mode, theme choice, background colour, content width.
   - Danger zone: backup export/import and clear-recycle-bin, visually separated with a
     red left border.
4. Each section header shows: a coloured icon tile, the section title, a help dot, and a
   one-line status summary (e.g. "AI tagging - DeepSeek configured") so health is readable
   without expanding anything.

REDESIGN GOAL
The current page is a very long single column with six-plus stacked sections and no navigation.
Add clear orientation (anchor nav + active state) and make each section's health readable at a
glance. Reduce noise: changes apply immediately, so per-section "saved" messages should not
compete with the content.

CONSTRAINTS
This is a form-heavy utility page, not a landing page. No giant circular icons, no gradient
hero banners, no marketing tone. Cards may have generous padding here (this page is scanned,
not used at speed), but keep the same tokens as the side panel.
```

**中文说明**：设置页现状是「单列长页」——虽然有锚点导航，但分组卡片用了 22px 大圆角 + 彩色渐变图标 + 渐变 hero，视觉上更像营销页。提示词要求保留「状态摘要可一眼读到健康度」这个好设计，同时压掉过度装饰。

---

## 7. 组织页 · 文件夹视图（`popup-folders.html`）

```text
Design the FOLDERS view of the side panel's Organize tab — the other half of the
"标签 / 文件夹" segmented control.

CANVAS
360px wide, narrow column, no horizontal scrolling.

CONTEXT
Same Organize tab, but browsed by Chrome's real folder tree instead of by tag. The top bar,
the three-tab strip (概览 / 组织 / 隐藏, with 组织 active) and the segmented control are
identical to the Tags view — only the segmented control's active option changes to 文件夹.

STRUCTURE (top to bottom)
1. Shared top bar, then the tab strip.
2. Segmented control 标签 / 文件夹 with 文件夹 active. On the same row, a compact toolbar:
   "排序:手动", "目录树", and a primary "新建".
3. A slim breadcrumb bar: the current path (e.g. 书签栏 / 开发 / 前端) as clickable crumbs,
   with the folder's item count right-aligned.
4. A scoped search field: "搜索当前层的文件夹或书签…".
5. The folder's contents as a FLAT list — folders first, then bookmarks:
   - FOLDER ROW: folder icon, name, a count pill (visible / total), and a ⋮ menu button that
     appears on hover. An empty folder is visibly de-emphasised (muted text, hollow count).
   - BOOKMARK ROW: the same bookmark-row component as the Tags view.
6. Rows keep the drag handle and the multi-select checkbox.

EMPTY STATE
Nothing in this folder: an outline folder icon, "这个文件夹是空的", and the hint line
"把书签拖到这里，或点上方「新建」创建子文件夹".

DENSITY
Rows about 44px, consistent with the Tags view.
```

**中文说明**：这屏的难点是「同一页面的第二种浏览方式」——要让它一眼看出和组织页同源（同样的顶栏/分段控件/行组件），但信息结构不同（面包屑 + 文件夹树）。项目里拖拽在这屏是 1:1 对应文件系统的，所以拖拽提示要保留。

---

## 8. 新增书签抽屉（`popup-add-drawer.html`）

```text
Design the "新增书签" drawer that slides in from the right edge of the 360px side panel.

CANVAS
The side panel at 360px wide with the drawer open. The drawer covers 88% of the panel width
(capped at 440px), slides in from the right, with a dimmed translucent overlay behind it.

STRUCTURE (top to bottom)
1. DRAWER HEAD: a plus icon + title "新增书签", a small "?" help dot, and a close (✕) button
   on the right.
2. DRAWER BODY — a vertical form with three fields:
   - 网址（必填）: text input, placeholder "https://example.com".
     Directly beneath it, an inline warn row (small alert icon, warn-tinted) reading
     "该网址已存在，保存后会合并标签" — show it as an active state.
   - 标题（留空自动生成）: text input, placeholder "自动生成".
   - 标签（可多个，逗号分隔）: text input with placeholder "代码, 工作, 教程",
     with a small ghost button "AI 打标" INSIDE the field on the right edge.
     Beneath the field, a wrapped row of SUGGESTED tag chips — dashed outline, "+" prefix,
     muted — that a user can tap to append. Show four suggestions.
3. DRAWER FOOT: an inline status message on the left (rendered empty) and a primary
   "保存书签" button on the right.

BEHAVIOUR TO DEPICT
- Suggested chips are local rule suggestions: visually lighter than real tag chips.
- "AI 打标" is the only AI affordance inside the drawer.

DENSITY
Comfortable form spacing — this is the one place in the panel where airiness is appropriate.
```

---

## 9. 帮助抽屉（`popup-help-drawer.html`）

```text
Design the "操作指南" drawer that slides in from the right edge of the 360px side panel.

CANVAS
Side panel at 360px wide, drawer open, 88% width capped at 440px, dimmed overlay behind.

STRUCTURE (top to bottom)
1. DRAWER HEAD: title "操作指南" and a close (✕) button.
2. DRAWER BODY — grouped reference content:
   - GROUP "主要入口" — three items, each a bolded term then an em dash and one sentence:
     概览 / 组织 / 隐藏.
   - GROUP "通用技巧" — about eight short lines, e.g.
     "勾选列表项 → 底部出现「删除选中」批量栏（含全选 / 反选）",
     "点击书签行直接打开链接；Ctrl+点击 后台打开",
     "拖动书签行可排序 / 拖到其他分组（文件夹分组会合并过去）",
     "所有删除都会先进回收站（30 天内可恢复）".
   - GROUP "键盘快捷键" — a two-column table: the key combination on the left rendered as a
     kbd-style monospace chip, the description on the right. About nine rows:
     "/" 聚焦搜索框 · "Ctrl / ⌘ + K" 聚焦搜索框 · "j / k" 上下移动高亮行 ·
     "Enter" 打开高亮书签 · "Shift + Enter" 后台打开高亮书签 ·
     "Ctrl / ⌘ + ↑ / ↓" 在文件夹内移动书签 · "N / F2 / Delete" 组织页：新建 / 重命名 / 删除文件夹 ·
     "?" 打开本指南 · "Esc" 关闭抽屉 / 弹层.
3. DRAWER FOOT (hint strip): "数据全部保存在本地，不会上传 · GitHub 开源仓库" with the
   repository name styled as a link.

TYPOGRAPHY
This is dense reference text. Group titles read as small labels; body lines 13px with 1.6 line
height so the list stays scannable; kbd chips use the monospace stack and the sub surface.
```

---

## 10. 弹层族（`popup-dialogs.html`）

> 组件规格板：一屏画多个弹层变体，每块带小标题。允许出现变体标注（与主界面屏相反）。

```text
Design the extension's dialog family as a COMPONENT SHEET on a 360px-wide canvas, light theme.
Each dialog sits in its own block, stacked vertically, with a small caption under each block.

COMMON CONTAINER (shared by all five)
A translucent dark scrim over the panel; a centred card, max-width 320px, 14px radius, the
largest shadow, 18px padding. One shared style — do not invent a second modal look.

Draw these five, in order:

1. caption "危险操作确认"
   Title "确认删除？", body text explaining the consequence, and two right-aligned buttons:
   a ghost "取消" and a danger "确认删除". Above the buttons, a warn strip with an
   alert-triangle icon reading "此操作不可撤销".

2. caption "多选项确认"
   The same card with FOUR actions in the footer: two ghost secondary buttons on the left,
   then ghost "取消" and a danger primary on the right. Show that four buttons still wrap
   cleanly at 320px.

3. caption "输入弹层"
   Title "重命名标签", a one-line muted explanation, a single text input, then 取消 / 确定.
   Show a visible focus ring on the input.

4. caption "标签管理"
   Title "管理标签（固定池）", a muted explanation line, then a scrollable list of tag rows —
   each row is the tag name plus a rename (pencil) and a remove (trash) icon button — and a
   single "关闭" button at the bottom. Show about six tags so the list clearly scrolls.

5. caption "按文件夹筛选"
   A WIDER card (max-width 440px): title "按文件夹筛选", a live summary line
   "当前目录：开发 · 12 个可见书签", a scrollable indented folder tree whose rows show a
   folder icon, the name and a count, with the active row highlighted, and two buttons:
   ghost "全部文件夹" and primary "完成".

RULES
- All five share the same card, scrim, radius, shadow and button styles.
- At most one primary button per dialog; danger only for destructive actions.
- Buttons never wrap to two lines of text.
```

---

## 11. 反馈与提示族（`popup-feedback.html`）

> 组件规格板。这屏对应项目里 60+ 处 toast 调用、进度条、常驻错误条与内联反馈。

```text
Design the extension's feedback and notification components as a COMPONENT SHEET on a
360px-wide canvas, light theme. Each variant sits in its own labelled block, stacked vertically.

1. caption "Toast · 四个级别"
   A dark floating bar pinned near the bottom of the panel: width 86% of 360px, 12px radius,
   and a 4px coloured bar on the LEFT edge encoding the level. Draw all four with their real copy:
   - ok (green):     "已删除书签 ✓"
   - warn (amber):   "回收站恢复中，请稍候"
   - danger (red):   "删除失败：书签未能从浏览器移除，请重试"
   - info (blue):    "AI 打标已完成，部分书签保留了原有标签"

2. caption "Toast · 带撤销操作"
   The ok toast "已删除书签 ✓" with an inline text button "撤销" right-aligned. The action must
   be clearly tappable and visually distinct from the message text.

3. caption "Toast · 轻量提示"
   A tighter, smaller variant for low-interruption confirmations: "已复制链接 ✓" —
   reduced padding, smaller text, no level bar, dismisses quickly.

4. caption "批量操作进度"
   A strip sitting above the footer: label on the left "AI 打标中… 42/128", a 5px rounded
   progress track with a primary-coloured fill, and a small ghost "终止" button on the right.

5. caption "常驻错误条 · 可续打"
   A bar above the footer with a danger top border: alert-triangle icon, bold title
   "批量打标未完成", muted detail "已成功 42 个，3 个失败，可继续重试", and a small primary
   button "继续打标" on the right. This one PERSISTS until dismissed — it is not a toast, so
   give it a solid surface and a clear boundary.

6. caption "表单内联反馈"
   Two states shown side by side under a sample field: an ok line "已保存" and an error line
   "接口地址无效，请检查后重试" — 12px, each with a small level icon.

7. caption "输入建议"
   Under a sample URL field: a warn-tinted inline row with a small alert icon reading
   "该网址已存在，保存后会合并标签".

LAYOUT NOTE
Every variant is 360px wide or narrower and must read clearly at that width. Use only the
design-system palette; the four toast levels map to ok / warn / danger / primary.
```

**中文说明**：这屏是用户特别要求补的。项目里的反馈通道有明确分工——**toast 管即时轻反馈**（可带撤销）、**常驻错误条管"未完成且可续做"**（批量打标失败时保留已完成批次）、**进度条管长任务**、**内联反馈管表单**。设计时要让这四条通道**视觉上可区分**，否则用户分不清"这条消息会不会自己消失"。

---

## 12. 状态族（`popup-states.html`）

> 组件规格板。这三态是我在前 6 屏提示词里明确禁止画的东西，现在单独补。

```text
Design the three list states used across the extension as a COMPONENT SHEET on a 360px-wide
canvas, light theme. Three labelled blocks stacked vertically.

1. caption "空状态"
   Vertically centred in a 360x320 area: a soft circular holder with an outline icon inside,
   a 14px title, a 12px muted description, and an optional primary action button.
   Show it twice with different icons and copy to prove the pattern generalises:
   - eye-off icon, "没有隐藏的书签", "隐藏的书签会显示在这里"
   - search icon, "没有匹配的书签", "换个关键词，或清空筛选条件", plus a primary "清除筛选"

2. caption "加载态"
   Two variants stacked:
   - a centred spinner with a status line "正在扫描书签…"
   - a skeleton list of 5 placeholder rows mimicking the bookmark-row layout — a small
     square for the icon, a wide bar for the title, a shorter bar for the meta line — using
     the sub surface colour with a subtle shimmer.

3. caption "错误态"
   A card with a danger left border: alert-triangle icon, bold title "扫描失败", a monospace
   detail line holding the technical message, and two buttons: ghost "复制详情" and primary "重试".

RULES
- All three live inside the content area below the fixed top bar and tab strip, so they must
  fill the available height gracefully rather than floating in the middle of the screen.
- No coloured illustration, no emoji — same outline icon set as everywhere else.
```

---

## 13. AI 打标流程（`popup-ai-flow.html`）

> 状态序列图。对应项目里 AI 批量打标的完整状态机：前置拦截 → 进行中 → 完成 → 部分失败续打 + 隐私拦截。

```text
Design the AI tagging flow as a STORYBOARD of five states of the same 360px side panel.
Show the five blocks stacked vertically, each with a caption. Keep the top bar, tab strip and
bookmark list IDENTICAL across all five so the reader sees one continuous flow — only the
feedback layer and the tag chips change.

1. caption "未配置 · 前置拦截"
   The panel with a warn toast at the bottom:
   "还没有配置 AI 服务：在设置页填好接口地址、API Key 和模型名即可开始".
   The bulk-action bar is still visible. There is NO progress bar.

2. caption "进行中"
   A progress strip above the footer: "AI 打标中… 42/128" with a filled primary track and a
   small ghost "终止" button. In the list below, the rows already processed show their new tag
   chips while the untouched rows show none — so progress is legible from the content itself,
   not only from the bar.

3. caption "完成"
   The panel with an ok toast "AI 已为 86 个书签打标 ✓". The rows below now show their tag chips.

4. caption "部分失败 · 可续打"
   The PERSISTENT error bar above the footer (not a toast): alert-triangle icon, bold title
   "批量打标未完成", muted detail "已成功 42 个，3 个失败，可继续重试", and a primary
   "继续打标" button. The successfully tagged rows KEEP their new chips — the whole point is
   that finished work is not lost.

5. caption "隐私拦截"
   A warn toast: "这些书签都不适合发给 AI（仅支持普通网页；登录、银行等敏感站点已自动保护）",
   making clear that nothing was sent.

RULES
Feedback layers must be visually distinguishable at a glance: a toast floats and will vanish;
the persistent error bar has a solid surface and a danger border and will not.
```

---

## 14. 生成策略

1. **先只做 `popup-organize`**。它是信息密度最高、最能暴露 Stitch 水平的一屏。用 `generate_variants` 一次出 3 个方向（保守微调 / 中度重构 / 激进重排）。
2. 把 3 个变体截图发回来，按 `review-checklist.md` 打分。
3. **只有第 1 步通过门槛，才继续其余 4 屏**，并把选定的方向作为后续各屏的基准（在每屏提示词末尾追加一句 `Follow the same visual direction as the approved Organize screen.`）。
4. 全部 5 屏定稿后，再进入代码移植阶段。

## 15. 配额提醒

- Stitch 免费，但有额度上限，且不同来源口径不一（详见方案 2.5 节）。
- **`redesign`（从 URL 提取样式）额度明显更紧张**（约每日 15 次），本流程不需要它——上传截图即可，不要浪费在 URL 提取上。
- 每屏 3 个变体 × 5 屏 ≈ 15 次生成，通常够用。如果额度吃紧，优先保证 `popup-organize` 和 `popup-overview` 两屏。
