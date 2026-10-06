# Persist publication memory across restarts

## Why

OpenCode 的 acknowledgement/baseline 只保存在进程内存里：宿主重启后同一组 withheld 问题会被重新当成首次观察。阶段一 spec 只要求「同一问题集合不重复打扰」，没有写跨重启；本轮按 Core 新增的 `PublicationMemory` 补齐 OpenCode 的持久化与验证。

## What Changes

- OpenCode 通过 `context.storage` 的独立 per-endpoint key（`litellm.publication.memory.v1[.endpointId]`，与 snapshot key 同风格）持久化 Core 的 `PublicationMemory`，在每次刷新前恢复。
- `litellm-publication` 只读 `state` 增加 `acknowledgement` 字段，客户端可读取抑制决定（仍然没有 accept/override 方法）。
- diagnostics 增加提醒状态行，说明为什么不再重复打扰。
- Real OpenCode v2 E2E（Ubuntu + 真实 PTY）新增：不可用 catalog 首次被 surface、真实重启后同一 fingerprint 静默、material change 后再次 surface；并保持既有 publication 场景（partial catalog / LKG / recovery / 无确认路径）在真实宿主通过。

## Impact

- Affected specs: `discovery-resilience-integration`（MODIFIED）
- Affected code: `src/host/sync.ts`、`src/host/diagnostics.ts`、`src/host/publication-rpc.ts`、`test/publication.test.ts`、`scripts/e2e-opencode-v2.mjs`
- 依赖 Core：`PublicationMemory` 编解码与 `nextPublishedBaseline`（新 SHA）
