# Consume discovery resilience and trusted publication

## Why

Core 已经把 publication gate、LKG、evidence source authority 与 catalog 可用性表达为一套事实。OpenCode 适配层必须完整消费这套事实：当前它保留了 `litellm-publication` RPC 的 `accept` 方法与 `/litellm-accept-degraded` 命令，允许用户确认后发布不完整模型；diagnostics 用「未完成 / 降级」描述不可信状态，也没有表达 partial availability、unusable catalog 与 previously-published regression。

## What Changes

- **删除 model-level degraded publication**：`litellm-publication` RPC 的 `accept` 方法与 `accepted` 事件、`/litellm-accept-degraded` 命令、`acceptDegradedForSnapshot`/`splitAcceptArgs`、`degradationEligible` 字段与 `acceptedDegradedIDs` 状态全部移除。`accept()` 不再存在，客户端无法通过 RPC 影响 publication。
- 消费 Core 的 **withheld / partial / unusable / regression / LKG / discrepancy / conflict** 事实：`PublicationSummary` 与 `litellm-publication.state` schema 改为新事实面，diagnostics 逐模型列出 withheld 原因、已裁决差异、未决冲突与 LKG 来源。
- 新增 **catalog notice** 与 **acknowledgement**：regression 与 `0/N` unusable catalog 生成一次性提醒；fingerprint 只由 withheld 身份与实质原因组成；acknowledgement 只抑制重复提醒，不参与 publication。
- **不新增 acknowledgement slash command**：OpenCode 的 TUI 卡片只服务 `/litellm-diagnostics`、`/litellm-audit-export` 的既有结果，不存在「查看后立即确认」的安全上下文动作，因此本轮只实现底层 acknowledgement domain model 与 notification suppression。
- persisted snapshot 只保存 publishable spec；旧 acceptance 状态从未持久化，无需迁移。
- README 重写模型可用性章节。

## Impact

- Affected specs: `publication`（MODIFIED + REMOVED）、`discovery-resilience-integration`（新增）
- Affected code: `src/host/publication.ts`、`src/host/publication-rpc.ts`、`src/host/diagnostics.ts`、`src/host/sync.ts`、`src/host/audit-command.ts`、`src/host/multi-audit-command.ts`、`test/publication.test.ts`、`test/audit-command.test.ts`、`scripts/e2e-opencode-v2.mjs`、`scripts/installed-consumer.mjs`、`README.md`
- 依赖 Core：`catalogFromPublication` / `decideAcknowledgement` / `withheldReasons`（`litellm-discovery-core` 新 SHA）
