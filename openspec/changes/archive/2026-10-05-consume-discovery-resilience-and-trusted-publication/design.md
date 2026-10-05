# Design: OpenCode consumption of discovery resilience

## D1. 适配层只做映射

`buildPublicationResult` 决定 `publishable(model)`，`catalogFromPublication` 决定 catalog 事实，`decideAcknowledgement` 决定是否提醒。适配层不复制任何判定，`litellm-publication.state` 只是这些事实的只读投影。

## D2. 注册集合与持久化

`buildPublicationModels` 只把 `configured` / `configured-lkg` 映射为宿主模型；`hasOperationalLimits` 仍作为纵深防御。persisted snapshot 直接取 publishable specs（`result.publishable`），withheld 模型不会进入恢复路径。旧实现虽然对 `degraded` 做了过滤，但 degraded spec 仍可能出现在 `models-store.json` 的 `models` 数组里；恢复路径只读 `snapshot`，所以不存在 degraded override 复活路径。

## D3. RPC 表面收敛

`litellm-publication` 只保留只读 `state`（输入可选 `endpointId`，多 endpoint 模式取第一个有 publication 状态的 endpoint），`accept` 与 `accepted` 事件删除。这是本变更「删除错误语义」的关键一步：RPC 客户端不能再用一次调用把不完整模型推进宿主。

## D4. 提醒与 acknowledgement

- `decideAcknowledgement` 在成功刷新路径执行；`previouslyPublished` 采用**只增**集合（"该模型曾被应用目录发布过"），因此撤回在后续轮次仍然可见；恢复的模型通过变为 publishable 自动离开 regression 列表。
- 需要提醒时写 `pendingNotice`；TUI/诊断路径通过 `catalogNotice` 生成文本（由当前 summary + 决策 reason 组成，不存储文案）。
- 不新增命令、不新增 RPC 方法、不在 TUI 卡片上增加新的交互动作。

## D5. Diagnostics

`formatPublicationLines` 输出：总量、unusable / partial 说明、failure kind、regression 行、LKG 行（含来源与 age）、逐模型 withheld 原因（最多 5 行）、已裁决差异、未决冲突。

## D6. README

面向用户说明 withheld 原因、partial availability、LKG 保护、Retry 与自动恢复、诊断如何看，并删除 accept-degraded 章节。
