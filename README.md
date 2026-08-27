# 书签管家 · Bookmark Manager

> 浏览器书签全维度管家：**标签体系管理**（多标签 / AI 打标 / 标签池收敛）、精确重复校验、敏感检测、隐藏书签、回收站、⭐ 收藏接管。以 Chrome / Edge MV3 侧边栏形式呈现。

## 核心功能

### 🏷 标签体系（主组织方式）
- **多标签**：一个书签可打多个标签（逗号分隔），标签为主、分类为辅
- **AI 打标**：OpenAI 兼容 LLM（DeepSeek / OpenAI / Grok / Groq / Gemini / Ollama / 自定义），批量打标 / 全量重打，强制从标签池选 1-3 个
- **标签池收敛**：固定池内标签统一管理；散落标签一键归并；池外自动兜底「其他」
- **标签管理**：新建 / 重命名（同步改所有书签）/ 删除 / 批量打标签

### 📖 三个界面
- **New Tab 新标签页**：按标签分组展示书签 + 搜索（支持 `#标签` 前缀精确筛选）+ 卡片 hover 操作（隐藏 / 编辑 / 删除）+ 与侧边栏实时同步
- **侧边栏**（点击工具栏图标打开）：概览 / 标签两个页签；清理、敏感书签和回收站从概览待办项进入
- **独立设置页**：LLM 配置 / 域名分组 / 标签池

### 🧹 清理能力
- **精确重复检测**：仅完整 URL（协议、域名、路径、参数、锚点）完全一致时判定重复
- **空文件夹清理**：递归识别无书签的文件夹
- 均走「**预览 → 确认 → 执行**」方案引擎，回收站可恢复

### 🛡 安全与保护
- **敏感书签检测**：登录 / 银行 / 加密钱包 / 成人 / 医疗 / 政务 / 邮箱（仅本地判定）
- **隐藏书签**：从日常视图完全排除（不删除），随时可恢复
- **回收站**：删除保留 30 天，支持单条或一键全部恢复；到期自动清理（上限 5000 条，入站先清过期）
- **备份 v2**：JSON 一键导出/导入，含书签 + 标签 + 隐藏 + 标签池 + 域名分组（id 自动映射，不含 LLM 配置和 API Key）

### ⭐ 收藏接管
- 地址栏 ⭐ 收藏后在后台按标签规则自动打标，不打开侧边栏或新增抽屉（可在设置关闭）
- 点击图标打开侧边栏；右上 ➕ 才会预填当前页并进入手动新增流程
- 新增书签自动打标（本地规则）+ 精确重复校验

### 其他
- 报告导出（HTML）、拖拽排序 / 跨组移动、暗色模式 + 无障碍（键盘快捷键、WCAG AA）

## 安装（Chrome / Edge）

1. 打开 `chrome://extensions/`（Edge 为 `edge://extensions/`）
2. 开启右上角「**开发者模式**」
3. 点击「**加载已解压的扩展程序**」，选择本项目根目录
4. 浏览器工具栏点击「**书签管家**」图标打开右侧侧边栏

> 注意：图标扩展名应是「**书签管家**」（紫色圆形），不要与浏览器内置的 ★ 收藏星标混淆。

## AI 打标配置（可选，标签更精准）

1. 点击右上角 ⚙️ 按钮（或访问独立设置页）
2. 选择服务商（OpenAI / DeepSeek / Grok / Groq / Gemini / Ollama / 自定义）
3. 填写 Base URL、API Key、模型名（如 `https://api.deepseek.com/v1` + `deepseek-chat`）
4. 点击「**测试连接**」验证
5. 在「标签」页签 →「🤖 AI 批量打标」为未打标书签生成标签

**隐私说明**：API Key 仅保存在本地（`chrome.storage.local`），不会上传给扩展开发者。AI 打标仅发送非高敏感书签的**标题、URL 域名和路径**，不发送 query 或 fragment；登录、银行、钱包等高敏感书签不会发送。首次保存 LLM 配置或测试连接时，扩展只请求该 API 域名的网络访问权限。

## 使用指南

- **概览页签**：KPI 看板（已打标率 / 待清理数 / 回收站）+ 重复、空文件夹、敏感书签和回收站入口
- **标签页签**：标签云（大小=数量）+ 分组浏览 + 新建/管理标签 + 批量打标签 + AI 打标
- **新增书签**（右上 ➕）：自动填充当前页 + 建议标签 + 精确重复校验
- **New Tab**：卡片点击新标签页打开；hover 右上角 👁/✏️/🗑 操作

## 目录结构

```
chrome-bookmark-manager/
├── manifest.json          # MV3 配置
├── popup.html             # 侧边栏主界面
├── newtab.html            # New Tab 新标签页
├── options.html           # 独立设置页
├── css/
│   ├── popup.css          # 侧边栏设计系统
│   └── newtab.css         # New Tab 样式
├── js/
│   ├── background.js      # Service Worker（⭐接管 / 回收站定时清理 / 书签事件监听）
│   ├── lib.js             # 工具库（URL / 域名 / 标签 / 敏感规则 / AI 客户端 / 回收站 / 备份）
│   ├── analyzer.js        # 分析引擎（flatten / 精确去重 / 统计）
│   ├── popup.js           # 侧边栏 UI 逻辑
│   ├── newtab.js          # New Tab UI 逻辑
│   └── options.js         # 设置页逻辑
├── icons/                 # 扩展图标（16/32/48/128 PNG）
└── .gitignore
```

## 开发

**零依赖、零构建**。纯原生 JavaScript + Chrome MV3 API。修改文件后到扩展管理页点击「**重新加载**」即可生效。

### 测试与代码质量（可选）

```bash
npm install        # 安装 vitest / eslint / prettier
npm test           # 单元测试（lib.js 纯函数：urlKey / eTLD+1 / 标签归一化 / LLM 解析 / 敏感检测）
npm run lint       # ESLint 检查
npm run format     # Prettier 格式化
```

### 代码分层（架构原则）

- `lib.js` —— 纯函数工具库，无副作用，挂载 `window.BM`
- `analyzer.js` —— 分析引擎，依赖 `lib.js`，挂载 `window.BMAnalyzer`
- `popup.js` / `newtab.js` / `options.js` —— UI 逻辑与状态管理
- `background.js` —— Service Worker（事件监听 + 定时清理）

### 调试小贴士

- 侧边栏右键 → 检查：调试 popup DOM
- 扩展管理页 →「服务工作线程」→ 检查：调试 background
- New Tab 页调试：新开标签页 → 右键 → 检查

## 发布

插件内置 **「🔄 检查更新」**（概览页）：对比 `manifest.json` 版本与 GitHub 最新 Release tag，发现新版时引导下载更新。

### 版本规则（重要）

| 项目 | 规则 |
|---|---|
| `manifest.json` 的 `version` | 项目发布统一使用 **`x.y.z` 纯数字点分**，每段为 `0` 到 `65535`，不能为 `0.0.0`。不允许 `1.2.0-beta` / `v1.2.0` 这类带字母/前缀的格式 |
| `package.json` / `package-lock.json` | 与 `manifest.json` 保持同一版本；`package-lock.json` 顶层 `version` 与 `packages[""].version` 均由发布脚本同步写入 |
| git tag | 使用 annotated tag，格式为 `v1.2.0` |
| 一致性 | tag 名、tag 内的 `manifest.json`、`package.json`、`package-lock.json` 的两个版本字段必须都是同一版本；tag 必须指向发布 commit |

### 一键发布脚本

```bash
npm run check-version                        # 校验版本文件、本地 tag 内代码与 origin 的最新 tag
npm run release                              # 交互输入版本，并选择是否推送
npm run release -- 1.3.1                     # 指定版本，仍逐步确认
npm run release -- 1.3.1 --push              # 指定版本并在确认后推送当前分支和 tag
npm run release -- 1.3.1 --push --yes        # 自动确认；仅用于 CI 等受控环境
npm run release -- 1.3.1 --push --allow-legacy-invalid-tags # 仅在确认远端最新 tag 是历史遗留异常时使用
```

脚本流程：

```
① 读取/校验版本号（x.y.z 纯数字、非 0.0.0、每段 0~65535；推送时必须大于本地和远端最新 tag）
② 执行 git diff --check、单测和 ESLint
③ 展示当前改动与推送计划，等待确认
④ 同步写入 manifest/package/package-lock 版本并提交（"release: vX.Y.Z"）
⑤ 给刚创建的 HEAD 打 annotated tag，并校验 tag 内全部版本字段与提交 SHA
⑥ --push：推送当前分支和 tag，再从远端校验 tag SHA；远端已有同版或更高版本时中止。远端最新 tag 不合规则默认中止；仅在确认是历史遗留异常后，显式传入 `--allow-legacy-invalid-tags` 才可发布更高版本
⑦ 打印 GitHub Release 直达链接
```

> 安全：交互模式会单独确认远端推送；`--yes` 跳过全部确认，必须同时传入版本号。脚本不会覆盖已有 tag。提交、打 tag 或推送阶段失败时，脚本会输出对应的恢复命令。

### 手动发布流程（等价于脚本）

```bash
# ① 改代码；发布前检查必须通过
npm test && npm run lint && git diff --check
# ② 同步所有版本文件并提交
# manifest.json / package.json / package-lock.json：1.2.0
git add -A && git commit -m "release: v1.2.0"
# ③ 在刚提交的 HEAD 打 annotated tag，随后校验
git tag -a v1.2.0 -m "v1.2.0: <更新摘要>" HEAD
git rev-parse v1.2.0^{commit}
git show v1.2.0:manifest.json
# ④ 推送分支与 tag
git push origin main
git push origin v1.2.0
# ⑤ GitHub Release（网页）
# 仓库 → Releases → Draft a new release
# → 选择既有 tag v1.2.0，并核对其 commit → 标题/说明 → Publish release
```

### 更新机制说明

- **「🔄 检查更新」**：`GET api.github.com/repos/cfdywds/chrome-bookmark-manager/releases/latest` → 对比 `version` 与 `tag_name` → 有新版弹窗引导下载 zip 后重新加载
- 这是 unpacked 模式的半自动更新；若想**完全自动更新**（无感升级），需上架 Chrome Web Store（发布即自动分发）

## 路线图

- [x] v1.0 基础功能（重复 / 敏感 / 空夹）
- [x] 回收站（30 天软删除 / 恢复 / 自动清理）
- [x] AI 打标与重试（避免 token 超限）
- [x] 标签体系（多标签 / 标签池 / 收敛 / 管理）
- [x] 备份 v2（含全部自定义数据，id 映射恢复）
- [x] New Tab 新标签页（标签分组 + 搜索 + 卡片操作）
- [x] ⭐ 收藏按钮接管 + 图标切换侧边栏
- [x] 隐藏书签（全视图排除 + 实时同步）
- [ ] popup.js 按职责拆分（搜索 / 渲染 / 方案引擎 / AI / 新增）
- [ ] Chrome Web Store / Edge 加载项商店上架

## 隐私

- 书签、标签、隐藏、回收站、域名分组和备份均保存在本机；备份不包含 LLM 配置或 API Key。
- API Key 仅存本地，仅在你主动触发 AI 打标时发送到你配置的 LLM 服务。
- AI 打标仅发送非高敏感书签的标题、URL 域名和路径；所有 query 与 fragment 会移除，高敏感书签不会发送。
- 点击「检查更新」时会请求 GitHub Releases API；该请求不包含书签数据或 API Key。
- 书签本身由 Chrome 原生同步（Google 账号），标签体系不随账号同步（可用备份 v2 手动迁移）

## 许可

MIT License — 详见 [LICENSE](./LICENSE) 文件。
