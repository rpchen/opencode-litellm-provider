# Design: OpenCode publication memory persistence

## 存储

沿用 `context.storage` 与 `discoverySnapshotKey` 相同的 endpoint 隔离约定：`litellm.publication.memory.v1`（legacy default endpoint）或 `litellm.publication.memory.v1.<endpointId>`。内容为 Core `serializePublicationMemory` 的稳定 JSON；不写入 snapshot schema（那是共享兼容性契约）。

## 生命周期

1. 每次 discovery 循环首次创建 publication controller 时 `loadPublicationMemory(controller)`（只读一次，结果标记为已持久化，避免立即回写）。
2. 成功轮次后计算 `decideAcknowledgement` + `nextPublishedBaseline`，内容变化时写入；写入失败只损失提醒抑制。
3. 完全恢复写入 `acknowledgement: null`，保留 baseline。
4. 损坏/版本不符 → `parsePublicationMemory` 返回 undefined → 忽略，publication 不变。

## 可观测性

`litellm-publication.state` 增加 `acknowledgement`（notify/reason/fingerprint），diagnostics 增加提醒状态行；两者都只反映提醒状态，不参与 publication。
