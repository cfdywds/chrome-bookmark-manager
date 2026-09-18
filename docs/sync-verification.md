# 验证隐藏书签是否已同步到云端

本文说明「书签管家」的隐藏书签如何进入 Chrome 书签同步，以及如何在当前设备分层验证
「隐藏数据已写入本地镜像」与「云端确实已收到」。

## 1. 机制：隐藏书签如何进入同步

1. 用户在侧边栏/新标签页隐藏书签 → `lib.toggleHidden()` 把书签 id 写入
   `chrome.storage.local` 的 `bmHiddenIds`（数组）。
2. 后台 Service Worker 监听标签/隐藏变化，维护一份按「规范化 URL 键」索引的记录表
   `bmNativeTagSyncRecords`：`{ [urlKey]: { tags, hidden, revision:[clock,seq,deviceId] } }`。
   - `hidden` 是 **URL 级**语义（`nativeRecordHiddenForUrl`）：同一规范化 URL 下
     任意一个书签被隐藏，该 URL 键的记录就为 `hidden: true`。
   - 规范化 URL 键 = `host(+port)+path+search(+hash路由)`，去 `www.`、去尾部斜杠、小写。
3. 记录按 URL 键 FNV-1a 哈希分入 32 个桶（`nativeBucketForUrl`），压缩
   （gzip + base64url，前缀 `z`/`j`）后切成每 180 字符的分片，作为“书签”节点写入
   设备专属目录：
   - 根目录：`其他书签 › 书签管家同步数据（请勿修改）`
   - 设备目录：`BMN1|D|<设备ID>`
   - 分片节点：`BMN1|S|<桶>|<代次>|索引|总数|<负载>`，提交头 `BMN1|H|<桶>|<代次>|总数|<校验和>`
4. 这些节点就是普通 Chrome 书签，随 **Chrome 书签同步**上传到云端的同一 Google 账号。
   其他设备开启书签同步、且能读到该内部目录时，后台水合所有设备分片，按修订号
   （混合逻辑时钟 `[clock, sequence, deviceId]`）合并，把 `hidden: true` 应用到
   对应 URL 的全部书签（写入目标设备的 `bmHiddenIds`），隐藏状态即出现在该设备。

### 关键边界

- 同步的是「隐藏状态 + 标签 + 固定标签池 + 规则」，**不含**书签标题、回收站、API Key、LLM 配置。
- 设置页的「上次同步成功」只表示**本地分片写入成功**（`publishNativeSync` 完成，
  `setBackgroundTagSyncStatus('')` 记录 `lastSuccessAt`），**不是云端确认**。
  Chrome 书签同步是异步的且扩展无法感知其上传结果。
- 磁盘上的 `Bookmarks` 文件是 Chrome 每次变更后（防抖）和退出时写入的镜像；
  浏览器运行期间该文件可能滞后于内存。

## 2. 分层验证

按成本从低到高，前面全过才是“基本可信”，最后一步才是“云端实锤”。

### L0 扩展内状态（快，但只能证明本地写入成功）

1. 打开扩展设置页，确认「标签原生同步」开关为开。
2. 状态文案应为「上次同步成功：<时间>」，而不是「上次同步失败」或「正在等待设备写入」。
3. （可选）侧边栏“隐藏”视图确认本机隐藏数量符合预期。
4. 若显示失败/等待，则先解决该状态，再做 L1-L3。

### L1 本机镜像核验（推荐，重点针对隐藏书签）

用仓库自带工具 `scripts/check-native-sync.js` 解码本机 Bookmarks 镜像：

```bash
npm run check:sync                       # 自动扫描 Chrome/Edge 各配置
node scripts/check-native-sync.js --bookmarks "<浏览器 Profile 的 Bookmarks 文件>"
```

先导出一份 `bmHiddenIds`（扩展 Service Worker 控制台执行）：

```js
chrome.storage.local.get('bmHiddenIds').then(r => console.log(JSON.stringify(r.bmHiddenIds || [])))
```

再逐条核验每个本机隐藏书签是否已在某设备分片以 `hidden: true` 发布：

```bash
node scripts/check-native-sync.js --bookmarks "<Bookmarks 文件>" \
     --hidden "hidden-ids.json"         # JSON 数组或 {"bmHiddenIds": [...]}
```

输出判定：

| 结果 | 含义 |
| --- | --- |
| 根目录未找到（exit 2） | 该配置文件从未成功发布同步数据，隐藏书签必然未同步 |
| 完整性错误 | 分片缺块/校验和不匹配，需重新触发发布（设置页关-开一次同步） |
| 每条 `[已发布]` | 该隐藏书签的 URL 键已在分片中 `hidden: true`，镜像就绪 |
| `[未发布]` | 本地 `bmHiddenIds` 有该书签，但分片里记录是 `hidden: false`——本机改动还没写进镜像 |
| `[缺失]` | 该 URL 键在任意设备分片中都不存在——尚未发布 |
| `[无此书签]` | id 不在书签文件（可能已删除或文件过期），重新导出后重试 |

全部 `[已发布]` 时 exit 0。

### L2 Chrome 同步引擎状态（确认云方向）

1. 打开 `chrome://settings/syncSetup`，确认「书签」同步项开启。
2. 打开 `chrome://sync-internals/` → Sync Status：状态应为 `ACTIVE`、有最近同步时间；
   在 `Type Status` 里看 `bookmarks` 的节点数 / 最近成功时间；可点 `Trigger GetUpdates`
   主动拉取，或在其附带的调试页确认 bookmarks 失败原因。
3. 若 bookmarks 类型长时间未同步或报错，按 Chrome 同步帮助排障（退出登录重登等），
   与扩展本身无关。

### L3 跨设备端到端（云端实锤）

1. 在另一台电脑（同一 Google 账号、开启书签同步）加载本项目目录并重新加载扩展。
2. 等待 Chrome 书签同步完成（可看 `chrome://sync-internals` bookmarks 类型有变动）。
3. 打开该设备侧边栏/新标签页：被隐藏的书签应**不出现在日常视图**，且出现在
   「隐藏」视图；设置页显示「上次同步成功」。
4. 反向验证：在该设备隐藏/取消隐藏一个书签，回到源设备确认状态一致——证明同步是
   双向且云端已写入。

## 3. 常见误判

- “设置页显示上次同步成功” **不等于** 云端已收到——那只是本地分片写入成功（L2/L3 才能确认云端）。
- 本机 `bmHiddenIds` 有记录 ≠ 已同步——只有当对应 URL 键出现在设备分片且 `hidden: true` 才算
  写入镜像（L1 的 `[未发布]`/`[缺失]` 就是这种“未同步”情形）。
- 隐藏是 URL 级同步：两台设备即使书签 id 不同、甚至同一个 URL 有多个书签，隐藏状态也会
  以 URL 键为单位对齐，因此跨设备看到的是“URL 被隐藏”，而不是“某一条书签被隐藏”。
- 浏览器正在运行时磁盘 `Bookmarks` 文件可能滞后：重跑脚本前可先让浏览器退出，或在
  扩展侧边栏里触发一次保存，再执行核验。