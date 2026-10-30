# discovery-snapshot Specification

## Purpose
Defines how OpenCode persists and restores endpoint-bound discovery snapshots, validates Core compatibility and integrity, and observes drift without moving host persistence concerns into the shared Core.

## Requirements

### Requirement: neutral persisted models
OpenCode SHALL persist the Core-neutral model representation rather than host-only model fields.

#### Scenario: package reconstruction
- **WHEN** a neutral snapshot is restored
- **THEN** OpenCode reconstructs its protocol package metadata before provider registration

### Requirement: successful refresh persistence
A successful network discovery SHALL create and best-effort persist a new Core snapshot.

#### Scenario: unchanged endpoint and models
- **WHEN** endpoint and model fingerprint are unchanged
- **THEN** OpenCode does not rewrite the durable snapshot solely to update its timestamp

### Requirement: destructive failure invalidation
Authentication and exhausted-notfound failures SHALL invalidate the persisted snapshot for the current endpoint.

#### Scenario: authentication failure
- **WHEN** discovery proves the current credential invalid
- **THEN** OpenCode clears the durable snapshot before exposing an empty provider catalog

### Requirement: storage failure isolation
Snapshot storage failures SHALL NOT fail model discovery or provider registration.

#### Scenario: write failure
- **WHEN** durable storage rejects a snapshot write
- **THEN** OpenCode logs a warning and keeps the successful in-memory discovery result

### Requirement: OpenCode current-policy snapshot restore
OpenCode SHALL 仅在Core接受schema2及关键完整性、endpoint/credential/结果相关scope一致时恢复中立模型；contextTierCap与price不决定scope或可用性。保持plugin durable storage、stale标记及既有endpoint-state门禁。 旧schema不恢复；价格错误由Core归零，关键损坏仍拒绝。

#### Scenario: [T19] 旧策略不回放
- **WHEN** 只有schema1快照
- **THEN** 等待成功刷新重建，不暴露旧空档位/cap

#### Scenario: [T21] scope不兼容
- **WHEN** credential、endpoint或协议选项改变
- **THEN** 不恢复旧模型

#### Scenario: [T19] 价格损坏
- **WHEN** 关键配置与指纹合法但cost损坏
- **THEN** 恢复能力并显示参考价0

### Requirement: 初始化发布兼容快照

插件 SHALL 在初始化完成之前发布启用、配置合法、持有凭据且与当前 endpoint 兼容的上次成功快照；不等待网络发现。legacy 与多 endpoint SHALL 一致。后台发现成功后更新结果，暂时网络失败时保留快照；认证和 notfound 的现有失效规则不变。

#### Scenario: [STARTUP-SNAPSHOT] 初始化读取
- **GIVEN** 启用的 endpoint 有兼容快照和有效配置、凭据
- **WHEN** 插件初始化完成而网络请求仍未结束
- **THEN** 宿主首次模型读取包含快照模型，状态为来自上次快照、待确认

#### Scenario: [STARTUP-OFFLINE] 网络不可用
- **WHEN** 初始化发布快照后网络发现失败
- **THEN** 快照模型仍可读取，状态仍说明来源和待确认

#### Scenario: [STARTUP-NO-SNAPSHOT] 无兼容快照
- **WHEN** 不存在兼容快照
- **THEN** 不发布旧模型，初始化不等待网络发现

#### Scenario: [STARTUP-GATE] 不允许恢复
- **WHEN** endpoint 停用、配置非法、无凭据或快照不兼容
- **THEN** 不发布该快照
