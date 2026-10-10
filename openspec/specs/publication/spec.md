# publication Specification

## Purpose
OpenCode 消费 Core 模型配置与发布结果，保留完整能力、限制、可选推理档位和参考价；只注册 configured/configured-lkg，不用宿主默认值扩展未知能力。

## Requirements

### Requirement: Publication partition governs registration
OpenCode SHALL register only models Core reports as `configured` or `configured-lkg`, and SHALL keep every other discovered model out of OpenCode registration with its status and complete reason list visible in diagnostics. No user confirmation, acceptance, or override exists or may be added: a withheld model cannot be moved into the published set by any OpenCode action.

#### Scenario: Complete models register normally
- **WHEN** discovery returns Core-configured models
- **THEN** they register with correct limits, input, cost, and protocol mapping

#### Scenario: Incomplete models never disguise as normal
- **WHEN** a discovered model is missing limits or has unknown key capabilities
- **THEN** it does not register and diagnostics names its status plus missing/unknown/illegal fields

#### Scenario: Operational guard stays as second layer
- **WHEN** any spec with non-positive context or output reaches the host mapper
- **THEN** it is excluded from registration regardless of publication state

#### Scenario: Withheld models stay withheld without any user action
- **WHEN** a model is withheld and the user takes no action, or executes any available command
- **THEN** the registration view is unchanged and there is no acceptance method on the publication RPC

#### Scenario: DeepSeek official provider limits reach the OpenCode host model
- **WHEN** the endpoint serves `deepseek-v4.1-flash` and the Core publication resolves the canonical identity `deepseek/deepseek-v4.1-flash` to the official `deepseek` provider record (`selectionSource: canonical-original`, `limit.output = 393216`)
- **THEN** the registered OpenCode model carries `limit.output = 393216` and `limit.context = 1000000`, never the OpenRouter reseller serving limit `943718`

#### Scenario: Reseller fallback conflicts stay withheld
- **WHEN** no official provider record is provable and the fallback-selected OpenRouter record's serving limit conflicts with the endpoint's own declarations
- **THEN** the model is blocked, `limit.output = 943718` never reaches OpenCode registration, and diagnostics report the unresolved conflict

#### Scenario: Fallback never rewrites the canonical identity
- **WHEN** discovery selects a fallback record for a model whose deployment identity is a given canonical model name
- **THEN** the host model id stays the deployment's own identity (never prefixed with the metadata provider namespace)

### Requirement: Conservative host tool mapping
The plugin SHALL map `unknown` tool support to disabled and SHALL never
enable host tool calling from unevidenced metadata.

#### Scenario: Degraded entry with unknown tools
- **WHEN** an entry reports unknown tool support
- **THEN** its registered capabilities disable tools while diagnostics still reports tools unknown

### Requirement: Failures and LKG are visible and safe
The plugin SHALL classify metadata failures with the Core taxonomy,
SHALL substitute only valid LKG snapshots (identity/schema/conflict
checked by Core, never TTL-expired), and SHALL show live-vs-LKG
selection with provenance and age, failure kind, retry state, withheld
reasons, and field-level evidence facts. A descriptive LiteLLM metadata
difference Core resolved into a discrepancy SHALL NOT be presented as a
failure and SHALL NOT discard a trusted snapshot.

#### Scenario: Live failure with valid LKG
- **WHEN** the metadata source fails but a provably belonging complete snapshot exists
- **THEN** the model still registers with LKG provenance and diagnostics marks the LKG selection with age and reason

#### Scenario: Live failure without valid LKG
- **WHEN** no valid snapshot exists
- **THEN** the model stays withheld with the failure kind and reason visible, and no default-filled model registers

#### Scenario: Retry recovery
- **WHEN** a retry fetch returns complete trustworthy metadata
- **THEN** the model returns to normally configured state

#### Scenario: Snapshot persists only normally publishable specs
- **WHEN** a discovery round completes with withheld entries present
- **THEN** the persisted snapshot holds publishable specs only, and no withheld or previously accepted model survives into it

#### Scenario: Descriptive discrepancy keeps the trusted snapshot
- **WHEN** Core reports a resolved discrepancy for a model otherwise served from LKG
- **THEN** the model stays registered from the trusted snapshot and diagnostics shows both the discrepancy and the LKG provenance

### Requirement: LKG 以 schema 8 同 resolution 派生

扩展 SHALL 在 seeding 时把 live catalog 与 options 透传给 Core，使 LKG 条目由
通过 gate 的同一 resolution 派生（`PUBLICATION_SCHEMA_VERSION = 8` 的
group-wide proof composition）；seeding 保持 best-effort。内存中已存在的 v7
及更早条目 SHALL 被 Core 判不兼容（fail closed），下一轮 live 自动重捕获为
v8。OpenCode 不复制 proof 判定、不持久化 LKG 条目。

#### Scenario: seeding 产出 v8 条目

- **WHEN** 某模型本轮 `configured` 且 Core 为 schema 8
- **THEN** store 中的条目 `schemaVersion` 为 8 且对未变更的 live 输入验证通过

#### Scenario: 旧条目 fail closed 后重捕获

- **WHEN** store 中存在 v7 条目且 catalog 中断
- **THEN** 本轮不恢复该条目；catalog 恢复后的首轮 live 自动捕获 v8 条目
