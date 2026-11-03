# 项目现状分析结论 · chrome-bookmark-manager

> 生成时间：2026-11-03 · 基线提交：`c49629c` · 分析方式：只读审查（未修改任何源码）
> 环境：Windows 11 + PowerShell 7 · Node v22.19.0 · npm 10.9.3 · vitest 2.1.9 · eslint 9.39.5

## 一、结论摘要

1. **工程健康度良好**：478 个用例全绿（24 文件 / 75.46s），ESLint 实扫 10 个文件 0 错误 0 警告，三处版本号一致为 `1.0.2`，零构建（改完即「重新加载」可用）。
2. **当前处于「功能已落地、尚未归档」状态**：工作区 7 个文件、`+632/−115` 行改动未提交；`CHANGELOG.md:5` 的 `[Unreleased]` 已积压 30+ 条变更（HTML 互通、健康体检、拼音搜索、快捷收藏、新标签页三模式、隐藏双键修复等），但 `manifest.json` 仍是 `1.0.2`。
3. **首要结构性风险是「真相分散」而非缺陷**：URL 键算法、隐藏状态判定、存储键常量在 `js/lib.js` 与 `js/background.js` 各存一份，靠注释约定同步（`js/lib.js:3228` 注释「与 background.syncUrlKey 同算法」）。本次隐藏修复必须同时改后台 8 个函数即为耦合成本实证。
4. **门禁缺口在格式与行尾**：CI 只跑 `test + lint + git diff --check`，不含 Prettier 校验；仓库无 `.gitattributes`，`git diff` 已对 3 个文件报「LF will be replaced by CRLF」。
5. **仓库卫生待收敛**：根目录 2 个同 SHA256 的 1.5MB 视频未跟踪也未忽略；`docs/stitch` 63 个设计产物（2.0MB，含 PNG 快照）已入库；`.stitch/DESIGN.md` 与根 `DESIGN.md` 双份并存。

## 二、基线事实

| 项目 | 现状 | 证据 |
| --- | --- | --- |
| 产品形态 | Chrome/Edge MV3 书签管理扩展，零构建纯原生 JS | `manifest.json`、`DESIGN.md` |
| 版本 | `1.0.2`（manifest / package / package-lock 三处一致） | `npm run check-version` 逻辑、`.github/workflows/release.yml` |
| 代码规模 | `js/` 10 文件 19238 行 / 670KB、`css/` 3 文件 5801 行 / 144KB | `(Get-Content $f).Count` 统计 |
| 测试规模 | `tests/` 24 文件 11197 行 / 468KB，478 用例，测试/源码体积比 0.70 | vitest 运行输出 |
| 提交历史 | 51 次提交，最新 `2026-10-15 15:34`（wanghaijun30） | `git log` |
| 跟踪文件 | 141 个 | `git ls-files` |
| 依赖 | 4 个 devDependencies（eslint / globals / prettier / vitest） | `package.json` |
| 许可 | MIT | `LICENSE` |

## 三、质量门禁实测

### 3.1 通过项

- `npm test`：24 文件 / 478 用例全部通过，退出码 0，耗时 75.46s。重模块集中在 `tests/native-bookmark-sync.test.js`（71 用例 / 14.5s）、`tests/release.test.js`（12 用例 / 67.5s）、`tests/bookmark-health.test.js`（3.2s）。
- `npm run lint`：`eslint js/ --ext .js` 实扫 10 个文件，0 错误 0 警告，退出码 0。
- 版本一致性：`package.json` / `manifest.json` / `package-lock.json` 顶层与 `packages[""]` 均为 `1.0.2`。

### 3.2 缺口项

| 缺口 | 现象 | 影响 |
| --- | --- | --- |
| Prettier 未入门禁 | `prettier --check` 报 14 个文件不合规（全部 `js/*.js`、`css/*.css`、3 个 HTML）；CI 无该步骤 | 格式只降不升，且无法在评审阶段拦截 |
| 无 `.gitattributes` | 仓库根不存在该文件；`git diff` 对 `js/background.js`、`js/lib.js`、`js/popup.js` 报 `LF will be replaced by CRLF` | 跨平台行尾漂移，`git diff --check` 无法覆盖 |
| 无覆盖率门禁 | 无 vitest config、无 `coverage` 脚本与阈值 | 新增模块（`popup-dnd.js`、`popup-modals.js`）只能靠引用次数间接确认 |
| 无 E2E 自动化 | `.gitignore` 留有 `.tmp-e2e/` 约定，但无对应 runner | 扩展交互（拖拽、侧边栏重载、权限授予）只能手工回归 |
| 无 schema 版本号 | 22 个 `bm*` storage 键无迁移版本标记 | 键语义变更只能靠代码内 `*_MIGRATED` 布尔量兜底 |

## 四、架构与规模

### 4.1 模块地图

| 层 | 文件 | 行数 | 职责 |
| --- | --- | --- | --- |
| 后台 | `js/background.js` | 3532 | 书签事件、原生标签同步分片协议、alarms、快捷收藏、回收站清理 |
| 共享库 | `js/lib.js` | 5605 | URL 规范化、25 类规则表、标签/隐藏/备份/LLM/健康探测 |
| 侧边栏 | `js/popup.js` | 5116 | 概览/组织/清理/回收站/体检/方案引擎 |
| 新标签页 | `js/newtab.js` | 1596 | 卡片+紧凑列表、虚拟化、乐观删除、文件夹弹窗 |
| 设置页 | `js/options.js` | 1944 | 标签池、规则、AI、外观、危险操作、分组导航 |
| 共享 UI | `js/ui.js` | 329 | 焦点陷阱、tooltip、toast、快捷键注册表 |
| 分析器 | `js/analyzer.js` | 332 | 扫描聚合、拼音键、隐藏命中 |
| 搜索 | `js/newtab-search-engine.js` | 296 | 引擎选择与安全跳转 |
| 拆出模块 | `js/popup-dnd.js` / `js/popup-modals.js` | 289 / 199 | 拖拽、弹层（已从 popup 解耦，`popup.html:485-486` 引用） |

### 4.2 集中度问题

- `js/lib.js` 内 `js/lib.js:178`–`2170` 是**规则数据表**（25 类分类关键词），约 1992 行，占该文件 35.5%。它是数据不是逻辑，却与逻辑同文件、同 review 单元。
- 三个核心文件合计 14253 行，占 `js/` 总量 74%；任何一次跨层改动都在大文件里做（本次隐藏双键改动即横跨 `lib.js` / `background.js` / `popup.js` / `analyzer.js` / `newtab.js`）。
- CSS 侧同样失衡：`css/popup.css` 3774 行 88KB，是 `css/newtab.css`（1639 行）的 2.3 倍，侧边栏单页承载了概览/组织/清理/回收站/体检五套视图。

## 五、数据契约（storage.local）

已识别 22 个键，均无版本号字段：

`bmActiveLlmProfileId`、`bmAutoAiTag`、`bmDomainGroupsMigrated`、`bmFixedTags`、`bmHiddenIds`、`bmHiddenUrls`、`bmLlmProfiles`、`bmNativeTagSyncCompletedRequest`、`bmNativeTagSyncConfig`、`bmNativeTagSyncConfigRequest`、`bmNativeTagSyncEnabled`、`bmNativeTagSyncRecords`、`bmNativeTagSyncRequest`、`bmNativeTagSyncState`、`bmNativeTagSyncUrls`、`bmNewtabAppearance`、`bmNewtabView`、`bmStarHook`、`bmTagRules`、`bmTags`、`bmTagSyncStatus`、`bmTrash`

**键常量重复定义**（同一字符串在两个文件各写一遍）：

| 常量 | lib.js | background.js |
| --- | --- | --- |
| `TAGS_KEY` | `js/lib.js:2385` | `js/background.js:98` |
| `HIDDEN_KEY` | `js/lib.js:3228` | `js/background.js:99` |
| `HIDDEN_URLS_KEY` | `js/lib.js:3229` | `js/background.js:102` |
| `FIXED_TAGS_KEY` | `js/lib.js:2499` | `js/background.js:103` |

## 六、工作区处置状态

未提交改动（`git status`）：`CHANGELOG.md`、`js/analyzer.js`、`js/background.js`、`js/lib.js`、`js/newtab.js`、`js/popup.js`、`tests/lib.test.js`、`tests/native-bookmark-sync.test.js` 已修改；`bookmark_manager_intro.mp4`、`bookmark_manager_intro_1min.mp4` 未跟踪。

改动主题单一且自洽：**隐藏书签从「只记书签 ID」升级为「ID + URL 键双键」**，用于修复 Chrome 重启/重新登录后书签 ID 漂移导致隐藏失效。

- 新增存储键 `bmHiddenUrls`，判定入口统一为「ID 命中或 URL 键命中」：`js/lib.js:3299`（`isHidden`）、`js/lib.js:3353`（`toggleHidden`，改为接收「期望状态」以消除点一次不生效）、`js/lib.js:3309`（`ensureHiddenUrls` 迁移）。
- 后台同步侧把隐藏集合统一成 `{ids, urls}`：`js/background.js:466`（`normalizeHiddenSets`）、`js/background.js:507`（`hiddenSetsFromStorage`），并改造水合、种子、删除、URL 迁移等 8 处调用点。
- 扫描期迁移只处理确实未迁移的条目，挂进后台串行队列：`js/analyzer.js:175-186`。
- 备份导出/恢复同步以双键为准（`lib.js` 内 `encodeBackupRoots` / 恢复分支）。
- 新增 9 个用例覆盖 ID 漂移、并发、写失败、跨页可见性、幂等：`tests/lib.test.js` 内 `describe('隐藏书签（ID + URL 双键）')`。

结论：这是一次**完整的分支级改动**（代码 + 测试 + CHANGELOG 同步），缺的只是提交与版本定级。

## 七、问题清单

### P1 · 影响发布与协作

| # | 现象 | 根因 | 建议 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | `[Unreleased]` 积压 30+ 条变更，版本仍 `1.0.2` | 功能连续落地但未走 `npm run release` 定级 | 按 KAC 语义把本轮定为 `1.0.3` 或 `1.1.0`，拆分提交后发版 | `CHANGELOG.md:5` |
| 2 | 隐藏双键修复尚未提交 | 改动完成、测试通过，停在未提交状态 | 先提交该主题（含 9 个新用例），再处理其余发布事项 | `git status --porcelain` |
| 3 | Prettier 14 文件不合规且 CI 不校验 | 门禁只覆盖 lint 与 `git diff --check` | `npm run format` 一次性归零，随后在 `ci.yml` 增 `prettier --check` | `.github/workflows/ci.yml`、`prettier --check` 输出 |
| 4 | 行尾 LF/CRLF 混用 | 缺 `.gitattributes` | 加 `* text=auto eol=lf` 与 `*.png binary` 等规则 | 仓库根无 `.gitattributes`；`git diff` 三条 CRLF 警告 |

### P2 · 结构与正确性

| # | 现象 | 根因 | 建议 | 证据 |
| --- | --- | --- | --- | --- |
| 5 | URL 键算法两份实现 | 前后台各自需要、无共享 ESM 入口 | 抽到 `js/lib.js` 单一实现并在后台引用，或加跨实现一致性用例（当前用例只锁 `scripts`↔`background`） | `js/lib.js:169` vs `js/background.js:302`；`tests/check-native-sync.test.js:104` |
| 6 | 存储键常量重复定义 4 组 | 无共享常量模块 | 收敛到单一 `KEYS` 表，禁止文件内重写字符串 | 见第五节表格 |
| 7 | 健康体检可能把 403/404 判为「连通正常」 | `no-cors` 的 opaque 响应恒为真，无法读状态码 | 在 `no-cors` 分支标注「仅连通性」，并对可疑域保持 `unknown` 而非 `ok`；或改为可选全站权限 + `webRequest` | `js/lib.js:5186-5200` |
| 8 | HEAD 探针携带被禁止的 `User-Agent` 头 | 浏览器会静默丢弃 forbidden header | 删除该头，避免误导后续维护者 | `js/lib.js:5149-5152` |
| 9 | 单文件过大（5605/5116/3532） | 历史累积 + 规则数据内联 | 先把 `lib.js:178-2170` 规则表拆为 `js/rules/*.js`（零行为变更），再按视图拆 popup | 行数统计 |

### P3 · 卫生与体验

| # | 现象 | 根因 | 建议 | 证据 |
| --- | --- | --- | --- | --- |
| 10 | 2 个 1.5MB 视频未跟踪未忽略，且 SHA256 相同（`E56D960A8B31EF03…`） | 素材放在仓库根、`.gitignore` 无 `*.mp4` | 删除重复那份，素材移出仓库或加 `*.mp4` 忽略 | `Get-FileHash` 输出 |
| 11 | `docs/stitch` 63 文件 2.0MB、`.stitch/DESIGN.md` 与根 `DESIGN.md` 双份 | 设计探索产物随源码入库 | 产物归档到独立分支或 `docs/stitch/output` 加 ignore | `git ls-files docs/stitch`（63）、`git ls-files .stitch`（2） |
| 12 | CI Node 20 / 本地 Node 22 漂移；4 个 dependabot 分支（eslint 10、globals 17.12、prettier 3.9.9、vitest 5）长期未合 | 依赖升级未纳入节奏 | 统一 CI 与 `engines` 到 Node 22 后逐条合并 PR | `.github/workflows/ci.yml`、`git branch -a` |
| 13 | 生产代码 console 输出 48 处（background 28、popup 15） | 调试信息未按级别收敛 | 保留 `console.warn/error`，`console.log` 走可开关的调试前缀 | `grep -c 'console\.'` |
| 14 | 备份仅当前版本可恢复 | V4 紧凑格式无向后兼容解析 | 在 README/设置页显式标注版本边界（已部分标注），必要时补 V3 读取器 | `README.md` 数据与隐私段 |

## 八、建议路线

**第一步（当天，阻塞项）**

1. 提交隐藏双键改动（代码 + 测试 + CHANGELOG），单独一个 commit。
2. `npm run format` 归零格式差异，加 `.gitattributes`，CI 增 `prettier --check`。
3. 清理根目录重复视频（保留一份或移出），`.gitignore` 增 `*.mp4`。

**第二步（下次发版前）**

4. 按语义化版本把 `[Unreleased]` 收口为 `1.0.3`/`1.1.0`，走 `npm run release` 校验链路。
5. 收敛 `urlKey` 与存储键常量到单一来源，并补跨实现一致性用例。
6. 修健康体检的 `no-cors` 判定语义与 `User-Agent` 头。

**第三步（结构性，可排期）**

7. 拆分 `lib.js` 规则表为数据模块，popup 按视图拆分，CSS 按视图拆文件。
8. 补覆盖率阈值与最小 E2E（侧边栏重载、拖拽、权限授予三条主路径）。

## 九、闭环记录（体检后已执行）

体检结论落地为 4 个提交，工作区回到干净状态：

| 提交 | 类型 | 内容 |
| --- | --- | --- |
| `d436f5d` | fix | 隐藏状态改按书签 ID 与 URL 键双键判定（7 文件 / +632−115，含 9 个新用例） |
| `002bf99` | test | 源码字面量断言改为格式无关正则，容忍 Prettier 展开 |
| `33d7cb9` | style | Prettier 全量格式化（13 文件 / +467−159），无语义改动 |
| `95df551` | chore | 新增 `.gitattributes`（`* text=auto eol=lf`）、`.gitignore` 忽略 `*.mp4`、CI 增 `prettier --check`，删除同哈希重复视频 |

对应本文档问题清单：P1 第 1–4 条已处理（提交、格式归零、`.gitattributes`、行尾统一）；P3 第 10 条已处理（重复视频）。
剩余未动：P1 的版本定级与发版（需另行拍板 `1.0.3` 还是 `1.1.0`）、P2 全部 5 条、P3 第 11–14 条。

闭环后门禁实测：`vitest run` 24 文件 / 478 用例全通过；`eslint js/` 0 错 0 警；`prettier --check` 全绿；`git diff --check` 无输出。

## 十、附录：复现命令

```powershell
# 质量门禁
npx vitest run --reporter=basic          # 24 文件 / 478 用例
npx eslint js/ --ext .js -f json         # 10 文件，0 错 0 警
npx prettier --check "js/**/*.js" "css/*.css" "*.html"   # 14 文件不合规

# 版本一致性
(Get-Content package.json -Raw | ConvertFrom-Json).version
(Get-Content manifest.json -Raw | ConvertFrom-Json).version
(Get-Content package-lock.json -Raw | ConvertFrom-Json -AsHashtable).packages[''].version

# 工作区与素材
git status --porcelain=v1
Get-FileHash bookmark_manager_intro*.mp4 -Algorithm SHA256

# 结构度量
Select-String -Path js/lib.js -Pattern '^  function ' | Measure-Object
git ls-files docs/stitch | Measure-Object
```
