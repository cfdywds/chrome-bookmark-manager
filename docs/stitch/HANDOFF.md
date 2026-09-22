# 书签管家 · UI 移植任务交接说明

> **一句话**：把 13 屏已定稿的设计稿移植进 `css/*.css`，保持零构建架构与 `npm test` 全绿。

---

## 0. 新会话从这里开始

如果你是被要求执行这个任务的 AI，按顺序做：

1. 读本文件（你在读）
2. 读 `docs/stitch-redesign-proposal.md` —— 调研与实施方案（含移植规则全文、风险表）
3. 读 `.stitch/DESIGN.md` —— 设计系统（token 的权威来源）
4. 浏览器打开 `docs/stitch/output/organize-v5-cn.html` 看一屏设计稿长什么样
5. **先不要动代码**，把 `## 5. 移植规则` 和 `## 7. 已知的坑` 读完再开始

---

## 1. 任务目标

上一轮已经把界面重新设计完并**通过人工验收**，设计稿冻结。现在的任务是把设计稿的视觉决策**翻译成项目现有 CSS 的改动**。

**关键前提：这是改样式，不是改结构。**

- 不引入任何构建工具、框架、Tailwind、第三方 UI 库
- 不改数据层：`js/lib.js`、`js/background.js`、同步协议、AI 打标逻辑全部不动
- 不重写 DOM 结构（设计稿与项目结构本就同源）
- 交互层（拖拽、FLIP 落位、乐观更新、焦点陷阱栈、快捷键注册表）全部保留原实现

---

## 2. 项目背景与硬约束

**项目**：Chrome / Edge Manifest V3 书签管理扩展，**零构建**（纯 HTML + CSS + 原生 JS）。
**工作目录**：`D:\navy_code\chrome-bookmark-manager`

| 文件 | 作用 |
|---|---|
| `popup.html` + `js/popup.js`（4891 行）+ `css/popup.css`（3752 行） | 侧边栏管理面板 |
| `newtab.html` + `js/newtab.js`（1496 行）+ `css/newtab.css`（1567 行） | 新标签页 |
| `options.html` + `js/options.js`（1670 行） | 设置页 |
| `css/tokens.css`（372 行） | **设计令牌唯一来源**，三页共用 |
| `js/ui.js`（329 行） | 共享交互原语（focusTrap / tooltip / toast / 快捷键） |
| `icons/sprite.svg` | 唯一图标来源（34 个 symbol） |
| `icons/engines/*.svg` | 搜索引擎 logo（google / bing / baidu / duckduckgo） |

**必须遵守的 12 条不变式**（全部由 `tests/ui-redesign.test.js` 的 361 行断言强制，详见方案文档第四节）：

1. 三页先加载 `tokens.css`，再加载 `popup.css`
2. 语义变量只能在 `tokens.css` 定义
3. `@media (prefers-color-scheme: dark)` 内只允许 `:root` 选择器
4. `:root[data-nt-theme='light'/'dark']` 必须在系统深色查询之后
5. 图标唯一来源 `icons/sprite.svg#i-*`，`popup.html` 禁止内嵌 `<symbol>`
6. 脚本加载顺序精确
7. `js/ui.js` 必须导出 7 个原语（focusTrap / releaseTrap / onEscape / initTooltip / toast / registerShortcut / shortcutHtml）
8. 禁止 `title` 属性提示，统一 `data-tip`
9. 危险操作只在 options 页底部
10. 版本号统一 `'v' + chrome.runtime.getManifest().version`
11. 既有 P2 结构类名保留（`entry-card` / `bulk-bar.pill` / `drag-handle` / `nt-row-*` / `optNav` / `danger-zone`）
12. 无障碍：`aria-activedescendant` + `role="listbox"/"option"`、`aria-selected`、`focus-visible`

**每次改完立刻跑**：

```bash
npm test          # vitest，含 ui-redesign.test.js
npm run lint
npm run format
```

---

## 3. 已完成的工作（不要重做）

- ✅ 调研 Stitch 能力边界，产出方案：`docs/stitch-redesign-proposal.md`
- ✅ 生成 5 个改版前现状快照：`docs/stitch/snapshots/`
- ✅ 从 `tokens.css` 提取设计系统，产出 `.stitch/DESIGN.md`，**已通过官方 `designmd lint` 0 error**
- ✅ 用 Stitch 生成 13 屏设计稿，逐屏合规检查（色值白名单 / 字号下限 / 圆角 / 提示词泄漏 / 系统主题）
- ✅ 全部本地化为中文（文案取自项目现有中文字符串，零翻译损耗）
- ✅ 按人工评审反馈做了两轮修正
- ✅ **人工验收通过，设计稿冻结**

---

## 4. 设计稿在哪

`docs/stitch/output/*-cn.html` —— 带 `-cn` 后缀的是中文版（**用这些**），无后缀的是英文原版（仅作对比）。

| # | 文件 | 内容 | 对应项目文件 |
|---|---|---|---|
| 1 | `overview-v1-cn.html` | 侧边栏 · 概览 | `popup.css` 06 概览分区 |
| 2 | `organize-v5-cn.html` | 侧边栏 · 组织（标签视图） | `popup.css` 07 组织分区 |
| 3 | `folders-v1-cn.html` | 侧边栏 · 组织（文件夹视图） | `popup.css` 07 组织分区 |
| 4 | `hidden-v1-cn.html` | 侧边栏 · 隐藏 | `popup.css` 04 复合 + 07 |
| 5 | `add-drawer-v1-cn.html` | 新增书签抽屉 | `popup.css` 04（`.drawer`） |
| 6 | `help-drawer-v1-cn.html` | 帮助抽屉 | `popup.css` 04（`.drawer`） |
| 7 | `dialogs-v1-cn.html` | 弹层族（5 变体） | `popup.css` 04（`.modal`） |
| 8 | `feedback-v1-cn.html` | 反馈族（toast 四级 / 进度 / 常驻条 / 内联） | `popup.css` 04 + `newtab.css` + `js/ui.js` |
| 9 | `states-v1-cn.html` | 状态族（空 / 加载 / 错误） | `popup.css` 05 分区 |
| 10 | `ai-flow-v1-cn.html` | AI 打标 5 状态流程 | `popup.css` 04 + 07 |
| 11 | `nt-cards-v1-cn.html` | 新标签页 · 卡片视图 | `newtab.css` |
| 12 | `nt-list-v1-cn.html` | 新标签页 · 列表视图 | `newtab.css` |
| 13 | `options-v1-cn.html` | 设置页 | `popup.css` 08 选项分区 |

> 注意：第 7、8、9、10 屏是**组件规格板**（一屏画多个变体），不是页面。移植时对应到**组件级 CSS 规则**，而不是页面布局。

**`popup.css` 的既有分区**（文件头有目录注释，新增样式必须落在对应分区，禁止文件尾追加）：

```
01 base/reset           21
02 布局壳               44
03 原子件               304
04 复合组件             662
05 空 / 加载 / 错误态    1687
06 概览页               1848
07 组织页               2241
08 选项页               2916
09 键盘 / 拖拽 / 动效    3539（文件共 3752 行）
```

---

## 5. 移植规则

全文见 `docs/stitch-redesign-proposal.md` 第九节。核心六条：

1. **先翻译颜色，再判断采纳**。设计稿的 hex 必须映射回语义变量（`--bg` / `--panel` / `--ink` / `--line` / `--primary` / `--surface-sub` / `--field-bg` …）。找不到对应语义变量的颜色，要**先在 `tokens.css` 的色阶里加值**，再在**四个**主题映射块（默认亮色、系统深色媒体查询、`data-nt-theme=light`、`data-nt-theme=dark`）同步赋值。**绝不在组件里写死 hex**。
2. **只改 `css/*.css` 与既有类的属性值**，不新增顶层组件类名，除非同步在 `tests/ui-redesign.test.js` 里**新增**断言（不删旧断言）。
3. **不采纳**：Tailwind className、`<style>` 内联块、单文件大 HTML 结构、任何 `<script>` 逻辑、设计稿里的图标引用（一律换成 `icons/sprite.svg#i-*` 或 `icons/engines/*.svg`）。
4. **交互零迁移**。`js/ui.js` 的 focusTrap / tooltip / toast / 快捷键注册表，以及拖拽、FLIP、乐观更新，全部保留原实现；设计稿只影响静态层。
5. **文案取项目现有中文串**，不要用设计稿里的英文（设计稿已本地化，但以 `popup.html` / `newtab.html` / `options.html` 现有串为准）。
6. **新增状态必须先归位**。新增样式要落在对应分区，禁止文件尾追加。

---

## 6. 分阶段计划与验收

顺序固定 **newtab → options → popup**（结构独立性由高到低，便于逐步验证）。

| 阶段 | 内容 | 预估 | 验收标准 |
|---|---|---|---|
| P0 | tokens 对齐：把设计稿用到的新值补进 `tokens.css`，四个主题映射块同步 | 0.5d | `npm test` 绿；双主题下无视觉回归 |
| P1 | newtab 两视图（卡片 + 列表） | 1d | 两视图内容宽度一致（1080px）；引擎 logo 用 `icons/engines/*.svg`；列表视图列宽在中文路径下不截断 |
| P2 | options 设置页 | 0.5d | 锚点导航可用；五个分组状态摘要可读；危险区在底部 |
| P3 | popup 四屏 + 两抽屉 + 弹层族 | 1.5d | 360px 无横向滚动；行操作按钮 hover 悬浮；标题占满整行 |
| P4 | 反馈族 / 状态族 / AI 流程 | 0.5d | toast 四级视觉可区分；常驻错误条与 toast 明显不同 |
| P5 | 双主题走查 + 回归 | 0.5d | 亮/暗 × 全部界面 × 各弹层与状态；`npm test` 全绿 |

**每阶段结束必须**：`npm test && npm run lint` 全绿，否则回退该阶段。

**回归基线**：`tests/ui-redesign.test.js`（361 行）是主要防线，另有 `tests/popup-performance.test.js`、`tests/newtab-search.test.js`、`tests/ui.test.js`。

> 已知 flaky：全量跑 `tests/native-bookmark-sync.test.js` 偶尔因并发时序失败，**单独重跑可通过**。判断回归时请单独跑一次确认，不要误判为自己引入的。

---

## 7. 已知的坑

### 7.1 设计稿引用了不存在的 token

Stitch 会自己发明变量名。已在设计稿里发现两处，移植时**必须映射到真实变量**：

| 设计稿里的 | 问题 | 改用 |
|---|---|---|
| `var(--radius-md)` | 项目只有 `--radius-xs/sm/--radius/lg/pill`，**没有 `--radius-md`** | `var(--radius)`（14px） |
| `var(--shadow-dropdown)` | 项目只有 `--shadow-sm/--shadow/--shadow-lg` | `var(--shadow-lg)` |

**移植前建议先扫一遍**：在设计稿里搜 `var(--`，逐个核对是否存在于 `tokens.css`。

### 7.2 设计稿的"屏间不一致"在代码里不存在

13 屏是**分别生成**的，DOM 类名天生不同（如 `organize` 用 `.bookmark-row`、`folders` 用 `.item-row`；`nt-cards` 用 `.search-bar-shell`、`nt-list` 用 `.search-bar`；`nt-list` 的设计稿甚至缺引擎下拉菜单）。

**这些都不需要在代码里处理** —— 项目的 `popup.css` 里 `.row` 和 `.search-box` 本来就是同一套组件，`newtab.html` 里 `#ntSearchEngineMenu` 本来就被两个视图共用。移植时以**项目现有类**为准。

### 7.3 设计稿是理想态

实机会受真实数据影响：favicon 加载失败、超长标题、几百个书签、空文件夹。设计稿里的空态/加载态（第 9 屏）就是为这些准备的，移植时要一并落地。

### 7.4 设计稿用了 `!important` 覆盖

`docs/stitch/fix-design.ps1` 生成的修正块里有 `!important`（如 `.engine-icon { background: transparent !important; }`）。那是为了让覆盖生效，**移植时要还原成正常层叠**，不要照抄 `!important`。

### 7.5 环境相关

- 生成设计稿用到的 Stitch 接口有**进程级限流**：同一进程内连续调用，第一屏成功后后续必失败。需要逐屏开新进程（见 `docs/stitch/gen-one-by-one.ps1`）。
- 相关脚本执行顺序：`gen-screens.ps1` → `localize.ps1` → `fix-design.ps1`（后者幂等，可重复跑）。

---

## 8. 如果设计需要修改

设计稿已冻结，但如果移植中发现设计需要调整：

1. 改 `docs/stitch/prompts.md` 对应章节的提示词
2. `pwsh -File docs/stitch/gen-one-by-one.ps1 -Screens <屏名>` 重新生成
3. `pwsh -File docs/stitch/localize.ps1` 重新本地化
4. `pwsh -File docs/stitch/fix-design.ps1` 重新应用修正
5. 重新打开 `docs/stitch/output/<屏>-cn.html` 验收

**不要在代码里直接改设计意图** —— 先在提示词层改，再移植，避免两边漂移。

---

## 9. 不要做的事

- ❌ 不引入构建工具 / 框架 / Tailwind / UI 库
- ❌ 不改 `js/lib.js` / `js/background.js` 的数据与同步逻辑
- ❌ 不重写 DOM 结构或新增大段 JS
- ❌ 不删除或弱化 `tests/ui-redesign.test.js` 的既有断言
- ❌ 不在组件里写死 hex / rgba
- ❌ 不在 `@media (prefers-color-scheme: dark)` 里写组件选择器
- ❌ 不用 `title` 属性做提示（统一 `data-tip`）
- ❌ 不照抄设计稿的内联 `<style>` / `!important` / Tailwind 类名

---

## 10. 移植进度（滚动更新）

> 最后更新：**P0–P5 全部完成，并修复了一轮可用性回归与令牌遗漏**。`npm test` 15 文件 400 测试全绿，`npm run lint` 0 错。本轮改动已拆分提交（`3d70344` 样式复刻 / `7766da1` newtab 引擎与视图 / `4710322` 撤销用例）。

### 已完成

| 阶段 | 范围 | 主要改动 |
|---|---|---|
| P0 | `tokens.css` + `.stitch/DESIGN.md` | 新增 `--font-sans` / `--font-mono`、`--fs-meta/title/body/section/display`、`--on-solid` / `--on-grad`、`--toast-ink` / `--toast-muted`（全部四主题块同步）；修正官方 linter 查出的两处对比度不达标（`--c-warn-l` → `#92400e` 达 6.33:1；深色三个渐变起点 → `#2563eb` 达 5.17:1）；两页字体栈收敛到 `var(--font-sans)` |
| P1 | `newtab.css` + `.search-box.lg` | 卡片视图与列表视图按 `nt-cards-v1-cn` / `nt-list-v1-cn` 移植；目录列定宽 158px；卡片操作条改右上角浮条（24px 按钮）；favicon 改中性底衬；搜索结果少时不再拉伸卡片（`auto-fill`）；色值逃逸 17 → 1 |
| P2 | `popup.css` 08 分区 | 选项页：中性介绍卡（去掉蓝色渐变 hero 与光晕）、分组头卡 + 健康摘要 pill、四色渐变图标块收敛、去卡片彩色边条、表单控件 38px 单线高、**左右分栏**（≥900px 收敛为单列）；画布改 `var(--bg)`（修掉暗色下画布残留亮色的真实缺陷） |
| P3 块 1 | `popup.css` 03 原子件 + 06 分区 | `.btn` 主按钮改语义纯色实底 + `--on-solid`；`.help-dot` 中性化（原来是主色强调点）；`.search-box` 改 field 底 + 3px `--primary-soft` 光环；`.badge` / `.tag` / `.tag-cloud` / `.tag-filter` 中性 chip + 令牌化；KPI 首卡改顶部主色条（原蓝色实心块）；`.entry-count` 中性化；popup.css 色值逃逸 51 → 17 |
| P3 块 2 | `popup.css` 04 / 07 / 09 分区 | 行尾操作按钮（隐藏 / AI / 编辑）改**绝对定位浮条**，不占布局空间 ⇒ **标题始终占满整行**；行内文本与 `.tag-chip` 令牌化中性化；`.group` / `.group-head` / `.org-bar` 工具条 / `.row.folder-row` 收敛；`≤380px` 搜索范围 chip 改为自身横向滚动（原来不可收缩，会把输入框挤到 0 宽）。headless 实测 360px 画布 `maxRight=360`，无横向溢出 |
| P3 块 3 | `popup.css` 04 分区 | `.modal` 遮罩改 `--overlay-bg`，标题 / 正文 / 输入框按 DESIGN.md 收敛（输入框 38px 单线高 + `--field-bg` + 3px 光环）；`.drawer` 圆角令牌化，头 / 体 / 脚 / 提示的间距与字号收敛；`.toast` / `.toast-act` / `.ui-tip` 改用 `--toast-ink`，清掉白色字面量与 rgba 逃逸 |
| P4 | `popup.css` 05 分区 + 04 分区 | 空 / 加载 / 错误三态收敛：`.loading` 指示器、`.empty-state`（标题 16px/600）、`.error-card`（危险色标题、等宽错误详情、步骤块改中性 sub + 边线）；补齐 toast 第 4 个变体 `.toast.info`，四级靠左侧 4px 色条区分；`.operation-notice`（常驻错误条）令牌化，与浮层 toast 保持明显区别；`.editor` / `.more-items` / `.progressive-load` 令牌化 |
| P5（自动化部分） | 全仓库 | 逐块双主题 headless 截图核对（newtab 卡片 / 列表、options、popup 360px、反馈族与状态族）；27 组亮 / 暗配色对比度全部 ≥ 4.5:1；`popup.css` 色值逃逸 **hex 51 → 0**、rgba 32 → 10；`newtab.css` hex 17 → 1（仅 mask 用的 `#000`）；每次改动后全量 `npm test` + `npm run lint` 全绿 |

| P5 修复 | `popup.css` + `newtab.css` + `ui-redesign.test.js` | 修复**触屏（`hover: none`）下行操作按钮与拖拽把手不可达**的真实回归：新实现叠加 `opacity: 0` + `pointer-events: none`，显形又改用 `:focus-visible`，触屏既无 hover 可触发、按钮又收不到点击（进不了 `:focus-within`）。另修：`.tree-overlay` 遮罩改用 `--overlay-bg`；`.org-tool` 圆角 / 字号回到令牌档位；删除零消费死令牌 `--focus-ring`；阶梯内字面量收敛到 `var(--fs-*)` / `var(--radius*)`（`popup.css` 字号 68 → 54、圆角 43 → 26；`newtab.css` 字号 19 → 16、圆角 25 → 18）；新增 3 条触屏可达性断言 |

### 待做

- **令牌化仍未收敛完**（不阻塞功能，但离 `.stitch/DESIGN.md`「只用五档圆角与五档字号」还有距离）：按消费率计，`popup.css` 字号 **61%** / 圆角 **76%**，`newtab.css` 字号 **59%** / 圆角 **62%**。剩余基本都是**阶梯外字面量**（`12px` / `12.5px` / `10.5px` / `8px` / `9px` 等），需先确认设计归属再改，不宜机械替换；`popup.css` 另有 8 处 `rgba(37, 99, 235, …)` 聚焦光晕与 1 处 warn 边线未令牌化。
- **剩余人工走查**：自动化能覆盖的部分（双主题截图、对比度核算、360px 溢出量测、全量测试）已随各块完成并通过。还需要人来做的只有两件事：
  1. 把扩展装进 Chrome，在真实数据下逐屏目视一遍（设计稿是理想态，实机受 favicon 加载失败、超长标题、几百个书签、空文件夹影响）。
  2. 确认几个**有意为之的取舍**是否符合预期：卡片右上角悬浮操作条 hover 时会压住标题尾部一瞬；分组/卡片不再用彩色边条区分；`.help-dot`、标签 chip、文件夹图标统一改为中性色，颜色只用于真实状态。
- 若走查后还要继续收敛，优先看 `popup.css` 剩余的 10 处 `rgba()`（多为阴影与聚焦光晕）与 `newtab.css` 的 1 处 mask `#000`。

### 本轮确立的执行约定

1. 每阶段结束 `npm test && npm run lint` 全绿再进下一阶段。
2. **不要跑 `npm run format`**：HEAD 版本的三个 CSS 文件本就不符合 prettier（`git show HEAD:css/tokens.css` 验证过），跑它会把整文件重排、淹没真实移植改动。要格式化请单独开一轮。
3. 视觉核对用 headless Chrome：把 `css/*.css` 与真实 DOM 片段拼成临时页截图，用完即删。注意 `file://` 下 `icons/sprite.svg#i-*` 的外部 `<use>` 会被浏览器拦截（图标不显示属正常），`icons/engines/*.svg` 以 `<img>` 方式可正常加载。
4. 对比度核算：解析 `tokens.css` 的 `--c-*-l` / `--c-*-d`，对关键前景/背景组合算 WCAG 比值（本轮 27 组亮/暗组合全部 ≥ 4.5:1）。
5. `tests/newtab-search.test.js` 有 3 条断言原本锁定被设计稿否决的旧实现（`#047857` hex、渐变纱罩、旧列宽），已按移植规则更新为等价或更强的断言（新增"不得回退 hex"反向断言），**未删除任何断言**。
6. 已知取舍（用户已确认）：卡片右上角悬浮操作条保留设计稿的 16px 右侧留白（hover 时会遮住标题尾部一瞬）；`.help-dot` 与 `.btn` 等跨页原子件在 P3 统一，不在单页单独改。
7. **默认隐藏的行内操作必须配 `@media (hover: none)` 兜底**。`opacity: 0` 若同时带 `pointer-events: none`，触屏上既没有 hover 可触发、按钮自身又收不到点击（进不了 `.row:focus-within`），会彻底不可达；显形条件用 `:focus-visible` 也救不了（触屏点按不匹配该伪类）。`newtab.css` 的 `.nt-actions` 与 `popup.css` 的行操作按钮 / 两个拖拽把手均已兜底，并由 `ui-redesign.test.js` 断言锁定。
8. **阶梯内字面量一律改用令牌**：`11 / 13 / 14px` 与 `7 / 10 / 14 / 999px` 分别对应 `--fs-*` 与 `--radius*`，改写零视觉变化，不要再新增这类字面量。
9. **改完 `css/*.css` 必须全量跑测试**：多个测试文件用 `toContain` 锁定了 CSS 的**字面量写法**（如 `outline: 2px solid var(--primary)`、旧列宽、旧 hex）。这类断言锁的是实现细节，改动前先确认，不要为了令牌化而顺手改既有断言。
