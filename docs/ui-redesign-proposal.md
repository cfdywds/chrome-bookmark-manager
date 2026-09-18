# 书签管家 · 样式 / 交互 / 界面改造方案

> 版本：v1.0（草案）
> 日期：2026-09-18
> 范围：`popup.html`（侧边栏管理面板）、`newtab.html`（新标签页）、`options.html`（设置页）
> 目标：在不改变「零构建、MV3、原生 JS」技术栈的前提下，系统性提升视觉一致性、交互效率与可维护性。

---

## 一、项目现状分析

### 1.1 架构与文件分布

| 模块 | 文件 | 规模 | 职责 |
|---|---|---|---|
| 侧边栏面板 | `popup.html` + `js/popup.js` + `css/popup.css` | 582 行 / **4346 行** / **3490 行** | 核心管理工作台：概览、整理、隐藏三个 Tab，含抽屉、弹层、批量栏 |
| 新标签页 | `newtab.html` + `js/newtab.js` + `css/newtab.css` | 158 行 / 734 行 / 777 行 | 书签浏览：搜索 + 标签筛选条 + 卡片网格 |
| 设置页 | `options.html` + `js/options.js` | 599 行 / 45K | AI 配置、同步、备份、新标签页外观 |
| 后台 | `js/background.js` (124K) + `js/lib.js` (113K) | — | 书签事件、同步、共享工具 |

### 1.2 设计系统现状（优点）

- **CSS 变量体系成熟**：`--bg / --panel / --ink / --muted / --line / --primary / --grad-* / --shadow-* / --radius-*` 已覆盖亮色与暗色（`prefers-color-scheme`），并有 WCAG AA 对比度注释。
- **lucide 风格 SVG 图标库**：`popup.html` 内嵌 `<symbol>` 雪碧图，替代 emoji，跨平台一致。
- **新标签页主题**：支持跟随系统 / 浅色 / 深色 / 自定义背景色，`data-nt-theme` 显式主题 + 变量集中维护，思路正确。
- 已有骨架屏、sticky 搜索框、批量操作栏、确认弹层等较完整的交互组件。

### 1.3 现存问题（改造动因）

**样式层：**

1. **调色板三处重复**：同一套 light/dark 变量在 `popup.css :root`、`popup.css @media dark`、`newtab.css [data-nt-theme]` 中各写一份；`--danger` 等语义色在三处取值漂移（`#be123c` / `#e11d48` / `#fb7185`），违背「变量集中维护」的既定原则。
2. **暗色覆盖靠硬编码补丁**：`popup.css` 暗色媒体查询内散落大量 `#1e2430`、`#141822` 等字面值覆盖具体组件（输入框、toast、进度条、favicon 底），新增组件时极易漏配。
3. **弹层/抽屉的 z-index、阴影、圆角无统一 token**：modal、drawer、toast、tooltip（`help-dot` 的 `data-tip`）各自为政。
4. **3490 行的单文件 CSS**：无分层索引，组件样式与布局样式混杂，定位成本高。

**交互层：**

5. **键盘导航不完整**：侧边栏有 `j/k/Enter/?/Esc`，但弹层（modal/drawer）缺少焦点陷阱（focus trap）与焦点归还；新标签页网格无键盘可达性（卡片只能鼠标点击）。
6. **tooltip 体系是手写的 `data-tip` + title 双轨**：定位、延迟、键盘触发不统一，部分按钮仅靠 `title`。
7. **危险操作反馈分散**：确认弹层（最多 4 按钮）+ toast + 内联 `settings-msg` 三种反馈通道，文案与级别（info/warn/danger）无规范。
8. **侧边栏三个 Tab 信息密度不均**：「概览」承载搜索/标签云/待办/重复/空文件夹/回收站多个入口，滚动长；「整理」功能强但入口深（拖动、分组、方案模式只有帮助抽屉里有说明，无可发现性）。

**界面层：**

9. **设置页是单列长页**：AI 分类、同步、备份、外观等 6+ 个 section 垂直堆叠，无锚点导航。
10. **新标签页与侧边栏视觉语言有代差**：newtab 是圆角 18px 大搜索 + 卡片网格的现代风格；popup 工具栏相对紧凑传统，两者共享变量但组件形态未复用。
11. **空状态/加载态不统一**：newtab 有骨架屏 + 插画式空状态，popup 的 `emptyState()` 是简单的图标 + 文字。
12. **favicon 依赖 `chrome://favicon`**：离线或图标缺失时无品牌化兜底，卡片/行内视觉单调。

---

## 二、改造方案总览

三个层次，可独立排期、独立验收：

```
P0 设计系统重构（样式基建）  →  1~2 天，纯 CSS/少量 JS，风险低
P1 交互规范升级（组件行为）  →  2~3 天，组件级改造，中风险
P2 界面结构优化（信息架构）  →  3~5 天，涉及布局调整，逐页面灰度
```

---

## 三、P0 · 样式基建：统一设计 Token

### 3.1 抽取单一调色板源

新建 `css/tokens.css`，作为**唯一**变量定义文件，三个页面全部先引用它：

```css
/* css/tokens.css —— 设计 token 唯一来源 */
:root {
  /* 中性色阶（Slate 系） */
  --slate-100: #f3f5f8; --slate-200: #e7ebf0; --slate-300: #dce1e8;
  --slate-500: #667085; --slate-700: #344054; --slate-900: #101828; --slate-950: #0f1117;
  /* 语义色（默认 = light）：--bg / --panel / --ink / --muted / --line / --primary / --danger / --warn / --ok ... */

  /* 尺寸与层级 token（新增） */
  --radius-xs: 7px; --radius-sm: 10px; --radius: 14px; --radius-lg: 18px;
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-6: 24px;
  --z-sticky: 30; --z-drawer: 80; --z-modal: 100; --z-toast: 200;
  --dur-fast: 120ms; --dur: 200ms; --ease: cubic-bezier(.2, .8, .2, 1);
}

@media (prefers-color-scheme: dark) { :root { /* 仅覆盖语义变量 */ } }
:root[data-nt-theme='light'] { /* newtab 显式浅色覆盖 */ }
:root[data-nt-theme='dark']  { /* newtab 显式深色覆盖 */ }
```

**收益**：消灭三份重复调色板；`--danger` 等漂移值统一；新增组件只需消费语义变量，暗色零额外代码。

### 3.2 暗色模式「零补丁」改造

- 原则：**组件样式只写语义变量，禁止在 `@media dark` 里写组件选择器**。`popup.css` 现有暗色块中的硬编码覆盖（输入框底 `#1e2430`、toast 底、favicon 底等）全部提升为变量（如 `--field-bg`、`--toast-bg`、`--fav-bg`），在 `tokens.css` 中分主题赋值。
- 用 `color-mix()` 替代手工调透明度（项目已在 `nt-search.is-stuck` 用过，Chrome 111+ 均支持）。

### 3.3 popup.css 分层重组（不拆文件，加索引）

保持零构建、单文件，但在文件头加入目录注释，并按固定顺序重排：

```
tokens 引用 → base/reset → 布局壳（topbar/tabs/content）→ 原子件（btn/icon-btn/input/tag）
→ 复合组件（row/group/bulk-bar/drawer/modal/toast/tooltip）→ 页面特例（opt-*/plan-*）→ utilities
```

配套约定：新增样式必须落在对应分区，禁止文件尾追加。

---

## 四、P1 · 交互规范升级

### 4.1 弹层焦点管理（a11y 必修）

新增 `js/ui.js`（≤150 行，三页面共享），提供两个原语：

```js
// 打开弹层/抽屉时：记录触发元素 → 焦点移入首个可聚焦元素 → Tab/Shift+Tab 循环锁定
UI.focusTrap(container);
// 关闭时：解除锁定 → 焦点归还触发元素
UI.releaseTrap(container);
```

- 应用到：确认弹层、prompt 弹层、标签管理弹层、新增抽屉、帮助抽屉（popup）+ newtab 确认弹层。
- `Esc` 关闭逻辑收拢进 `ui.js`，替换各页面散落的 keydown 监听。

### 4.2 统一 Tooltip 组件

- 废弃 `title` 属性提示，全部收敛到 `data-tip`。
- `ui.js` 提供单例 tooltip：150ms 延迟显示、自动翻转（上下）、`focus-visible` 也可触发、Esc 可关闭。
- `help-dot`（?）按钮与图标按钮共用同一实现。

### 4.3 反馈通道规范

| 场景 | 通道 | 规范 |
|---|---|---|
| 即时轻反馈（已复制、已保存） | toast | 统一从右下（侧边栏）/ 底部居中（newtab）滑出，2.5s 自动消失，级别色条 = `--ok/--warn/--danger` |
| 表单内错误 | 内联 `settings-msg` | 紧邻触发控件，红字 + `role="alert"` |
| 不可逆操作 | 确认弹层 | 按钮数 ≤2 为原则；现在的「第三/第四按钮」API 保留但文案必须动词化（如「直接删除」「移入回收站」） |

在 `lib.js` 将 `toast()` 扩展为 `toast(msg, level)` 签名，全局替换硬编码调用。

### 4.4 键盘导航补全

- **newtab 网格**：`/` 聚焦搜索已有；新增 `j/k` 或方向键在卡片间移动高亮（复用 popup 的高亮行视觉 `--primary-soft`），`Enter` 打开、`Shift+Enter` 后台打开、`e` 编辑、`Delete` 删除（走确认弹层）。
- **popup 列表**：高亮行增加 `aria-activedescendant`，让屏幕阅读器可感知。
- 帮助抽屉的快捷键表随功能同步更新（目前是静态 HTML，改为从 `js/ui.js` 的快捷键注册表生成，避免文档与实现漂移）。

### 4.5 拖拽可发现性

- 书签行 hover 时在左侧显示拖拽把手（⋮⋮ grip 图标），替代「整行皆可拖」的隐式约定。
- 拖动中给可投放的分组标题加 `--primary-soft` 高亮 + 虚线框；投放瞬间 200ms 落位动画（FLIP，原生 JS 可实现）。
- 首次进入「整理」Tab 时显示一次性引导气泡（存 `chrome.storage.local` 标记位）。

---

## 五、P2 · 界面结构优化

### 5.1 侧边栏（popup）

1. **Tab 重平衡**：
   - 「概览」瘦身：标签云 + 待办提醒保留；「重复书签 / 空文件夹 / 回收站」三个入口改为卡片式快捷入口（图标 + 计数 badge），点击后直接切换视图而非内嵌长列表。
   - 「整理」增加副标题提示，降低理解成本。
2. **工具栏**：搜索框在输入时右侧浮出「范围筛选」chip（全部/标题/标签/网址），替代仅靠 `#标签` 语法的隐式能力（语法保留给高级用户）。
3. **批量栏**：现在底部出现，改为悬浮 pill（圆角 999px、居中、`--shadow-lg`），勾选数 + 操作按钮，视觉更轻。
4. **空状态**：复用 newtab 的「插画图标 + 标题 + 引导按钮」结构，`emptyState()` 增加第三个参数 `action`（如「去新增书签」按钮）。

### 5.2 新标签页（newtab）

1. **视图切换**：卡片网格之外增加「紧凑列表」视图（toggle 存在 storage），长书签列表场景信息密度更高；复用 popup 的行组件样式。
2. **卡片增强**：
   - favicon 缺失/加载失败时，回退为域名首字母 + HSL 哈希底色（由 URL 哈希出色相），替代灰块。
   - 卡片底部显示标签 chip（最多 2 个 + 「+n」），现在标签只在筛选条出现，卡片上看不到归属。
3. **分组浏览**：顶部增加「文件夹」筛选下拉（与标签筛选条并存），利用已有的文件夹浏览与隐藏状态同步能力。
4. **性能**：首屏骨架屏已有；卡片网格在 >200 条时启用 `content-visibility: auto` + `contain-intrinsic-size`（零依赖虚拟化，Chrome 原生支持）。

### 5.3 设置页（options）

1. **左侧锚点导航**：桌面宽度下左侧固定 mini-nav（AI 分类 / 同步 / 备份 / 外观…），点击平滑滚动 + scroll-margin 定位；窄屏（侧边栏内打开时）自动隐藏为顶部下拉。
2. **分组卡片头统一**：icon + 标题 + 状态摘要（如「AI 分类 · 已配置 DeepSeek」「同步 · 上次 3 分钟前」），不用展开即可看到配置健康度。
3. **危险区收敛**：备份恢复、清空数据类操作集中到页面底部「危险操作」卡片，红色左边框标识。
4. **保存反馈**：现在是每个 section 底部一条 `settings-msg`，统一为「修改即时生效」的全局 toast（选项本就即时生效，减少页面噪音）。

### 5.4 跨页面一致性

- **组件形态对齐**：newtab 的大圆角搜索框（18px）与 popup 的搜索框统一为同一 `.search-box` 组件的两个尺寸变体（`.search-box.lg`）。
- **图标库单一来源**：popup.html 内嵌的雪碧图抽到 `icons/sprite.svg`，三页面用 `<use href="icons/sprite.svg#i-gear">` 外链引用（MV3 扩展内同源，无 CORS 问题），消除 newtab/options 里重复的 inline SVG。
- **版本号展示**：popup 顶栏和 options hero 都有版本，统一格式 `v1.0.1`。

---

## 六、实施路线图

| 阶段 | 内容 | 涉及文件 | 预估 | 验收标准 |
|---|---|---|---|---|
| P0-1 | 抽取 `tokens.css`，三页面引用；删除重复调色板 | 新增 tokens.css；popup.css/newtab.css 头部改造；3 个 html | 0.5d | 两主题下视觉无回归（截图对比）；`--danger` 等值全站唯一 |
| P0-2 | 暗色补丁变量化；z-index/间距 token 替换 | popup.css | 0.5d | `@media dark` 内不再有硬编码色值 |
| P0-3 | popup.css 分区重排 + 目录注释 | popup.css | 0.5d | 纯重排，无行为变化；lint 通过 |
| P1-1 | `js/ui.js`：focusTrap + tooltip + toast(level) | 新增 ui.js；popup.js/newtab.js 接入 | 1d | 弹层 Tab 循环锁定；title 属性清零 |
| P1-2 | 键盘导航（newtab 网格 + aria） | newtab.js, popup.js | 1d | 键盘全流程不碰鼠标可完成搜索→打开 |
| P1-3 | 拖拽把手 + 投放高亮 + 新手引导 | popup.js, popup.css | 1d | 拖放可发现性可用性测试通过 |
| P2-1 | popup 概览瘦身 + 批量栏 pill 化 | popup.html/css/js | 1d | 概览首屏高度缩短 ≥40% |
| P2-2 | newtab 列表视图 + favicon 兜底 + 文件夹筛选 | newtab.html/css/js | 1.5d | >200 书签滚动流畅；缺图标无灰块 |
| P2-3 | options 锚点导航 + 状态摘要 + 危险区 | options.html/js, popup.css | 1d | 每个分组 2 次点击内可达 |

**回归保障**：现有测试（`tests/popup-performance.test.js`、`tests/newtab-search.test.js` 等）必须在每阶段全绿；UI 纯样式阶段建议增加一次人工双主题走查清单（亮/暗 × popup/newtab/options × 各弹层）。

---

## 七、非目标（本次不做）

- 不引入任何构建工具、框架或第三方 UI 库（保持零构建 MV3 架构）。
- 不改数据层、同步协议、AI 打标逻辑（`lib.js`/`background.js` 仅在被要求扩展 `toast()` 签名时做最小改动）。
- 不重绘品牌 icon（`icons/icon*.png` 保持不变）。
- 不做多语言（当前 zh-CN 单语，i18n 另立项）。

---

## 八、风险与缓解

| 风险 | 缓解 |
|---|---|
| token 重命名导致视觉回归 | P0 阶段只做「搬家不改值」，逐页面截图对比后再删旧变量 |
| focusTrap 影响现有 Esc/快捷键 | `ui.js` 单测覆盖；popup.js 中旧 keydown 逐路径替换而非一次性删除 |
| 设置页导航在窄侧边栏中挤压内容 | mini-nav 仅在 ≥720px 显示，媒体查询兜底 |
| 用户习惯旧布局 | P2 逐页面灰度：先 newtab（结构最独立），再 options，最后 popup |
