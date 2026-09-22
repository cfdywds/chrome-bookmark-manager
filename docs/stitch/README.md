# Stitch 改版素材包

这是「用 Google Stitch 重新设计书签管家界面」的**全套输入素材**，配合 [`../stitch-redesign-proposal.md`](../stitch-redesign-proposal.md)（调研与实施方案）使用。

---

## 目录里有什么

| 文件 | 作用 |
|---|---|
| `../../.stitch/DESIGN.md` | **设计系统规范**。导入 Stitch 用；已通过官方 CLI 校验（0 error） |
| `snapshots/*.html` | **5 个界面的现状快照**。双击即可用浏览器打开、截图 |
| `prompts.md` | 每屏可直接粘贴的英文提示词 + 中文说明 |
| `review-checklist.md` | 评审清单、评分表与决策门槛 |
| `build-snapshots.mjs` | 快照生成脚本（源码变化后重新生成） |

---

## 为什么需要快照

Stitch 无法访问 `chrome-extension://` 页面，而且三个界面里有**两个的真实 DOM 是运行时生成的**：

- `popup.html` 的 `#content` 在源码里只有一个 `.loading` 占位，真实内容由 `js/popup.js`（4891 行）的模板字符串生成；
- `newtab.html` 的 `#ntGrid` 同样是空的，由 `js/newtab.js`（1496 行）生成。

所以**直接上传源码 HTML 只会给 Stitch 一个空壳**。快照脚本做的事是：复用真实源文件与真实 CSS（视觉 100% 一致），只把运行时 DOM 补回去。

快照保留全部真实类名与嵌套结构，因此你在截图里看到的就是扩展里真实的样子。

---

## 快速开始（约 30 分钟到第一次生成）

### 1. 看现状（2 分钟）

双击打开 `snapshots/popup-organize.html`，把浏览器窗口拖到约 380px 宽——这就是侧边栏的真实形态。再打开 `snapshots/newtab-cards.html` 全屏看看。

### 2. 建 Stitch 项目（2 分钟）

打开 <https://stitch.withgoogle.com> → 头像 → **Settings** → 关掉 **Allow AI model training**。

然后**按屏分开建项目**：侧边栏两屏（`popup-overview` / `popup-organize`）类型选 **App**，全宽三屏（`newtab-*` / `options`）选 **Web**。360px 窄栏是移动端主场，Stitch 在这个区间明显更强。类型很可能跟项目绑定，所以建议建两个项目——「书签管家·侧边栏」（App）和「书签管家·全宽页」（Web）。

输入框右下角默认是 **Balanced**（偏速度），点开选最高质量那一档再生成。

### 3. 导入设计系统（5 分钟）

把 `.stitch/DESIGN.md` 的全部内容导入 Stitch 的 **Design system / Theme** 面板。导入后核对：主色 `#2563eb`、圆角只有 7/10/14/18/999、有亮暗两套。

> 这一步最关键。导对了，后面每屏自动贴合；导错了，每屏都要靠提示词硬掰。

### 4. 截图（3 分钟）

按 `prompts.md` 第 0.3 节的表格截 5 张图，系统主题切到**浅色**。

### 5. 生成第一屏（10 分钟）

只做 `popup-organize`（侧边栏·组织）。上传它的截图 → 粘贴 `prompts.md` 第 1 节的**通用约束块** → 再接第 3 节的**专属提示词** → 用 `generate_variants` 出 3 个变体。

### 6. 评审（5 分钟）

按 `review-checklist.md` 打分。**只有通过决策门槛（D 节）才继续其余 4 屏。**

---

## 完整流程

| 阶段 | 动作 | 产出 | 预估 |
|---|---|---|---|
| P0 | 建项目、导入 `DESIGN.md`、关训练开关 | Stitch 项目就绪 | 0.2 d |
| P1 | 5 个快照各截亮色图（可选深色） | 截图素材 | 0.2 d |
| P2 | 逐屏生成，每屏 3 个变体 | 参考稿 | 1–2 d |
| P3 | 按清单评审，选定方向 | 采纳清单 + 基线截图 | 0.5 d |
| P4 | 按移植规则落地到 `css/*.css` | 代码改动 | 2–4 d |
| P5 | 双主题走查 + `npm test` 回归 | 可发布版本 | 0.5 d |

P4/P5 的规则见方案第九、十节。**移植顺序固定为 `newtab` → `options` → `popup`**（结构独立性由高到低）。

---

## 重新生成快照

当 `popup.js` / `newtab.js` 的 DOM 结构或 `css/*.css` 变化后，快照会与现状脱节：

```bash
node docs/stitch/build-snapshots.mjs
```

脚本会覆盖 `snapshots/` 下的 5 个文件。它**只读**源文件，不会修改项目任何代码。

---

## 快照的已知简化

理解这些简化，避免误判：

| 简化 | 原因 | 影响 |
|---|---|---|
| 不含任何 JS | 快照是静态参考 | 悬停展开、折叠、拖拽等交互看不到——这些请看提示词里的「INTERACTION NOTES」 |
| favicon 用在线服务替代 `chrome://_favicon/` | 扩展专属协议在普通页面不可用 | 断网时会露出首字母 + 哈希底色的兜底（**这与真实降级行为一致**） |
| 图标已内联进每个文件 | `file://` 下跨文件 `<use href="*.svg#id">` 会被浏览器阻止 | 文件因此约 25–46 KB，正常 |
| 只呈现代表性状态 | 快照不是回归测试 | 概览页显示 12 条样例书签；空状态、骨架屏、错误态未呈现——这些在提示词里作为「REQUIRED STATES」提出 |
| 设置页表单是空值 | 无 JS 填充 | 状态摘要是空的；提示词已要求设计出「一眼读到健康度」的摘要样式 |

---

## 与现有测试的关系

**快照与素材包完全不碰产品代码**，因此现有测试不受影响：

```bash
npm test      # 含 tests/ui-redesign.test.js 的 361 行断言
npm run lint
```

`docs/stitch/` 与 `.stitch/` 都是新增目录，不影响扩展运行。构建快照的脚本也不在 eslint 的检查范围（`eslint js/`）内。

---

## 常见问题

**Q：登录后页面一直转圈，怎么排查？**

**先换代理节点。** 实测现象与结论：`stitch.withgoogle.com`、`accounts.google.com`、`www.gstatic.com`、`apis.google.com`、`identitytoolkit.googleapis.com`、`securetoken.googleapis.com`、`stitch.googleapis.com`、`firestore.googleapis.com`、`lh3.googleusercontent.com` 这九个依赖域名**全部能建立 TLS 连接并返回 HTTP 响应**（`stitch.withgoogle.com` 返回 200 / 25KB 正常 HTML），但页面仍然转圈。

原因是 Stitch 是实时应用：登录后还依赖 WebSocket / Firestore 流式长连接，而某些代理节点对长连接支持不佳——短请求能过，长连接被掐断或超时。

**判断方法：静态资源都能拿到、页面却转圈 → 基本就是节点问题，换节点即可**，不必去查 DNS、代理开关或账号资格。

按实测顺序，其余可排除项：

1. 系统代理是否指向正确的本地端口（常见 `127.0.0.1:7890`），代理进程是否真在监听该端口；
2. Chrome 里是否有代理类扩展（SwitchyOmega 等）覆盖了系统代理；
3. 第三方 Cookie 是否被拦截——Google 登录依赖它。

**Q：用 MCP 批量生成时，第二屏开始就失败怎么办？**

**一次只生成一屏。** 实测现象：连续调用 `generate_screen_from_text` 时第一屏成功，之后即使间隔 45 秒，第二屏起也立即失败——耗时 0 秒、**没有 HTTP 状态码**、只有连接层错误。这不是超时也不是 key 失效（同时刻 `list_projects` 仍返回 200）。但**单独一次调用**（独立进程、间隔 20 秒以上）可以稳定成功。

所以 `gen-screens.ps1` 里的循环重试是无效的，必须一屏一次调用。已生成 5 屏，每屏间隔一次人工操作即可。

**Q：生成的界面里冒出 "Loading State" / "Empty State" 这类不该有的区块？**

检查提示词里有没有和**第 1 节 SCOPE 段冲突**的状态描述。实测第 4 节（newtab 卡片）原有的 `REQUIRED STATES / Skeleton loading grid, and an empty state...`，导致 Stitch 在主界面屏里画了 `Skeleton Loading State` 和 `Empty State (Filter Mismatch)` 两块。而第 1 节 SCOPE 段明明写着禁止渲染这类标签——**提示词内部自相矛盾时，Stitch 会听更具体的那一句**。已改为明确的禁止段。

排查方法：对生成的 HTML 搜 `Loading State` / `Empty State` / `Error State`，命中即为泄漏。

**Q：Stitch 生成的代码能直接用吗？**
不能。它是单文件大 HTML，且带 Tailwind 类名与英文文案。本项目是零构建 + 精确脚本顺序 + 361 行结构断言，必须按方案第九节的移植规则手工落地。参考稿的用途是**提供设计意图**，不是提供代码。

**Q：为什么提示词是英文？**
Stitch 的原生交互语言是英文，中文提示词可用但更慢且偶发不响应。生成稿的文案也一律是英文占位——**移植时替换成现有 HTML 里的中文字符串**，不要让 Stitch 去写中文。

**Q：额度用完了怎么办？**
Stitch 免费但有上限，口径随版本变化（见方案 2.5 节）。优先保证 `popup-organize` 与 `popup-overview` 两屏——它们收益最大。**不要**把额度花在 `redesign`（URL 提取样式）上，那个额度更紧张（约每日 15 次），而本流程用截图就够了。

**Q：Stitch 输出太「AI 味」怎么办？**
通用约束块里的 VISUAL DIRECTION 段就是为这个准备的。如果仍然跑偏，在**同一项目内**用 `edit_screens` 逐条纠偏（一次只改一个点），不要重开新稿——重开会让设计系统上下文丢失。

**Q：改完的效果比现在还差怎么办？**
按 `review-checklist.md` 的 D 节门槛执行：达不到就降级为「灵感来源」，只挑 1–2 处局部改进手工实现，不进入完整移植。**方案本身就是允许否决的**——这比硬着头皮改完再回滚划算。
