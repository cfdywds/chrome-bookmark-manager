# Chrome Web Store 发布、迁移与回退

## 发布记录

- Chrome Web Store 条目 URL：（发布后填写）
- 生产扩展 ID：（发布后填写 `chrome.runtime.id`）
- 已验证版本：（发布后填写）

## 生产发布

Chrome Sync 由扩展 ID 隔离。所有生产设备必须从同一个 Chrome Web Store 条目安装本扩展，首次发布建议使用“不公开列出”状态。发布完成后，在此手册所在的发布记录中写下商店条目 URL 和 `chrome.runtime.id`。

1. 在权威设备导出书签 JSON 备份，并妥善保存，不提交到 Git。
2. 从已审阅的仓库根目录创建 Chrome Web Store 上传 ZIP。上传前确认 ZIP 不包含开发 manifest、私钥、API Key、书签备份或 `node_modules`。
3. 将 ZIP 上传到一个 Chrome Web Store 条目，完成审核或发布为不公开列出。
4. 在两个 Chrome 配置文件上安装同一个商店条目，打开设置页并记录相同的 `chrome.runtime.id`。
5. 只在权威配置文件导入备份，启用标签云同步并确认成功状态；第二个配置文件打开侧边栏或新标签页，确认标签、固定标签池和自定义规则到达。
6. 在源配置文件删除一个标签和规则，确认删除也会同步到目标配置文件。
7. 确认目标设备没有收到任何 LLM API Key、端点、模型或 profile。

## 解压开发

解压扩展仅用于开发。若确实需要在多台开发机之间维持一个开发扩展 ID：

1. 生成一对 RSA 密钥，将私钥保存在仓库外的安全位置，例如 `extension-private.pem`。
2. 只把 Base64 DER 格式的公钥写入本地开发 manifest 副本的 `key` 字段，并在每台开发机使用同一副本。
3. 在创建 Chrome Web Store ZIP 前移除该 `key` 字段，且绝不复制或提交私钥。

这个开发 ID 与 Chrome Web Store 的生产 ID 有意不同，不能用于迁移生产同步数据。

## 回退

1. 在测试配置文件关闭标签云同步。
2. 重新安装原扩展 ID 对应的版本。
3. 导入发布前导出的 JSON 备份，确认书签标签和规则恢复。
4. 不要为了回退删除 Chrome Sync 数据；保留它以便重新升级时恢复。
