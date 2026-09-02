# 本地同步、发布与回退

## 本地同步

这是个人多设备使用的默认方案，不需要 Chrome Web Store 开发者账号。Chrome Sync 会按扩展 ID 隔离数据，因此所有设备必须加载由同一私钥生成的 `local-sync-build` 目录。

### 前提

- 使用 Chrome 114 或更高版本，且每台设备登录同一 Google 账号并开启 Chrome 同步。使用自定义同步时，保持「扩展程序」同步项开启。
- 不要将 Chrome 和 Edge 混作同一同步组；本地同步仅支持 Chrome。
- 权威设备安装 Node.js 20 或更高版本，并保留项目根目录的 `prepare-local-sync.cmd`。

### 首次配置

1. 若已有旧版本扩展，先更新并重新加载到当前版本，再导出一份 V4 JSON 备份。
2. 在权威设备双击 `prepare-local-sync.cmd`，或执行 `npm run prepare:local-sync`。脚本会检查环境，在仓库外创建或复用私钥，并在 `local-sync-build` 生成带固定 ID 的扩展。
3. 打开 `chrome://extensions`，开启开发者模式，选择「加载已解压的扩展程序」，再选择 `local-sync-build`。
4. 只在权威设备导入备份并启用一次「标签云同步」。记录设置页中的扩展 ID，它应与脚本输出一致。
5. 加密离线备份脚本显示的私钥。默认 Windows 路径为 `%LOCALAPPDATA%/BookmarkManager/local-sync/extension-private.pem`；私钥用于换机后继续生成相同 ID，不能提交到 Git、上传共享同步盘或复制到其他使用设备。
6. 将整个 `local-sync-build` 目录复制到其他设备。每台设备仍需手动在 `chrome://extensions` 加载一次该目录，确认设置页扩展 ID 与权威设备相同；不要重复导入备份。

Chrome 不允许脚本绕过「加载已解压的扩展程序」的确认。`local-sync-build/` 已被 Git 忽略，私钥不会写入该目录或仓库。

### 日常更新

1. 在权威设备更新项目源码后，再次运行 `prepare-local-sync.cmd`。
2. 确认脚本输出的私钥状态为「已复用」，且固定扩展 ID 没有变化；若显示「首次生成」或 ID 变化，停止更新并从加密离线备份恢复私钥。
3. 更新前保留一份旧的 `local-sync-build` 目录用于回退，再将新生成的整个目录复制到其他设备，覆盖旧目录。
4. 每台设备打开 `chrome://extensions`，点击扩展卡片的「重新加载」。无需再次导入备份或重新启用标签云同步。

若更新新增权限，Chrome 会在重新加载时要求确认。

### 回退

恢复保存的旧 `local-sync-build` 目录，并在每台设备重新加载扩展即可。不要为了回退删除 Chrome Sync 数据，保留它可以在重新升级时继续使用。

仅支持当前 V4 格式的版本才能导入 V4 备份；早于 V4 的代码不能用于恢复该备份。

### 备份恢复边界

- 导入不会删除当前书签：同一完整 URL 默认合并标签，其余书签新增；确认框可选择保留副本。
- 隐藏状态和回收站记录会合并；固定标签池与自定义标签规则会以备份内容覆盖当前配置。
- 若回收站容量不足，恢复会失败，不会静默删除现有回收站记录。
- 备份与标签云同步均不包含 API Key、LLM 配置、端点、模型或可选主机权限。

## Chrome Web Store 发布（可选）

本节仅面向维护公开或不公开列出商店版本的维护者。商店生产设备必须从同一个 Chrome Web Store 条目安装，才能共享其扩展 ID 和对应的 Chrome Sync 命名空间；本地同步生成的 ID 与商店 ID 相互独立。

### 发布记录

- Chrome Web Store 条目 URL：（发布后填写）
- 生产扩展 ID：（发布后填写 `chrome.runtime.id`）
- 已验证版本：（发布后填写）

### 生产发布

1. 在权威设备使用当前版本导出 V4 书签 JSON 备份，并妥善保存，不提交到 Git。
2. 从已审阅的仓库根目录创建 Chrome Web Store 上传 ZIP。上传前确认 ZIP 不包含私钥、API Key、书签备份、`node_modules` 或 `local-sync-build`。
3. 将 ZIP 上传到一个 Chrome Web Store 条目，完成审核或发布为不公开列出。
4. 在两个 Chrome 配置文件安装同一个商店条目，打开设置页并确认 `chrome.runtime.id` 相同。
5. 只在权威配置文件导入备份，启用标签云同步并确认成功状态；目标配置文件打开侧边栏或新标签页，确认标签、固定标签池和自定义规则到达。
6. 在源配置文件删除一个标签和规则，确认删除也会同步到目标配置文件。
7. 确认目标设备没有收到任何 LLM API Key、端点、模型或 profile。
