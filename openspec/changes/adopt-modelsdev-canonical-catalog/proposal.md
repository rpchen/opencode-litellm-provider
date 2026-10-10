# Adopt the models.dev Canonical Catalog (OpenCode adapter)

## Why

Core change `adopt-modelsdev-canonical-catalog`（`rpchen/litellm-discovery-core`）
重写了 models.dev 消费模型：canonical registry（`catalog.models`）+ serving
proof（`catalog.providers` + `models_dev_provider` + exact SKU），未证明记录零供给，
Proven Runtime Enforcement 空证明集，LKG schema 8。OpenCode 仍从 `api.json`
拉取、按旧 Core SHA 构建，不跟进则新行为无法到达用户，旧 `dist` 与新语义漂移。

## What Changes

- `src/net/fetch.ts` 默认 URL 由 `https://models.dev/api.json` 改为
  `https://models.dev/catalog.json`（单请求、同 snapshot；超时/重试/缓存不变）。
  `modelsDevUrl` 自定义镜像能力保留，但镜像必须为 catalog 形状；
  provider-only 镜像由 Core 按其 `catalog-input` 契约 fail closed（不做
  canonical 解析，LiteLLM 完整者仍发布）并诊断提示。Core 负责全部形状校验与
  identity/authority/merge。
- LKG 接线迁移到 schema 8：`seedPublicationLKG` 传递 live catalog + options，
  使 capture 由同一 resolution 派生；v7 及更早条目由 Core 判不兼容
  （fail closed），下一轮 live 自动重捕获。不复制 proof 判定。
- diagnostics/TUI 展示新增字段：canonical identity / evidence、serving
  status-provider-record、推理档位状态（unknown/known）、operator-configuration
  键（不称 enforcement）、诊断候选、catalog shape；字段缺失时（旧 Core）优雅省略。
- Fake catalog fixture 改为 catalog 形状；删除 `test/` 中重复 Core 算法的
  `build/capabilities/litellm/modelsdev/protocol` 副本（Core 仓单测覆盖；
  本仓只测 OpenCode 映射）。
- README（含 `modelsDevUrl` 文档）同步行为变化。

**BREAKING（用户可见）**：见 Core README 迁移说明；OpenCode 侧无新增配置项，
`dist` 重建前行为保持旧 Core。

## Impact

- Affected specs：`model-discovery`（ADDED：catalog URL、形状与 `modelsDevUrl`
  语义）、`provider-diagnostics`（ADDED：诊断字段）、`publication`（ADDED：LKG v8 接线）。
- Affected code：`src/net/fetch.ts`、`src/options.ts`（文档）、`src/host/sync.ts`
  （seeding 接线）、`src/host/diagnostics.ts` + TUI（展示）、`test/` fixtures 与映射测试、
  `README.md`。
- Downstream顺序：本 change 与 Core PR 并行评审；`build:dist` 必须等 Core 合入
  `main`、以稳定 SHA 重建后另行提交（BLOCKED 项见 tasks）。`verify:dist` 在此
  前为预期红。
- 不复制 Core 业务算法；Core 行为由 Core 侧测试覆盖。
