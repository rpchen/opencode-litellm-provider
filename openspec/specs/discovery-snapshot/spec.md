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
