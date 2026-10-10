# Tasks

> Core 稳定 SHA 前可完成 §1–§4；§5（重建 + 新 dist 全验证）BLOCKED，直至 Core PR 合入 `main`。

## 1. Fetch 与 modelsDevUrl（OpenCode）

- [x] 1.1 `src/net/fetch.ts`：`MODELS_DEV_URL` 改为 `https://models.dev/catalog.json`；其余语义不变
- [x] 1.2 `test/fetch.test.ts`：默认 URL 断言更新；fake catalog 改 catalog 形状；`modelsDevUrl` 自定义与非法回退测试保留并更新文档指向
- [x] 1.3 `src/options.ts` + README：`modelsDevUrl` 文档更新为 catalog 形状要求与 provider-only fail closed 说明

## 2. LKG 接线（OpenCode）

- [x] 2.1 `src/host/sync.ts` `seedPublicationLKG`：透传 live catalog + options；保持 best-effort
- [x] 2.2 纵向测试：catalog 形状 fixture → discovery → store v8 条目（Core ≥ 8 断言 proof；旧 Core 仅接线）；v7 忽略重捕获
  - 证据：`test/publication.test.ts` v7/v8 双轨（`CORE_V8` 门控）+ schema-8 proof 用例

## 3. Diagnostics/TUI（OpenCode）

- [x] 3.1 诊断与 TUI 卡片：canonical/serving/档位/operator-config/候选/shape；缺失省略；unresolved 给可操作行
  - 证据：`formatModelDetails`（本地最小形状、不依赖生成 Core 版本）+ 接入 `createDiagnosticsLines`
- [x] 3.2 测试：新手造两种形状渲染断言；纵向链路（ProviderSnapshot → command/RPC → TUI store/card）不断；删除 `test/{build,capabilities,litellm,modelsdev,protocol}.test.ts` Core 算法副本

## 4. 文档与治理（OpenCode）

- [x] 4.1 README：catalog URL、`modelsDevUrl` 形状要求、serving 双证明、operator configuration、行为变化清单、迁移说明
- [x] 4.2 OpenSpec：proposal/design/tasks + specs deltas；`openspec validate --all --strict` 通过
- [x] 4.3 提交前门禁：`test:delivery`、`typecheck`、`test`（旧 Core 305 pass / 新 Core 9328706 300 pass 双轨全绿）、`test:tui-render`、`test:package`、`validate:spec`、`test:openspec-closure`、`test:release-metadata` 通过；`verify:dist` 与 `test:distribution` 在本 PR 为预期红（差异仅本次 src 变更：host/diagnostics、host/sync、net/fetch、options；§5 重建后恢复零差异）
- [x] 4.4 Real OpenCode 2.0.16 E2E（旧 dist 宿主契约回归）：**通过**（2026-10-08 CI run 37775162760 @ cecbe87，GitHub Actions Ubuntu + 固定 OpenCode 2.0.16 + 插件安装器 + `E2E_PACKAGE_SPEC=github:rpchen/opencode-litellm-provider#cecbe87...`：startup recovery、native keyboard activation、endpoint-scoped diagnostics、credentials、providers/models、publication gate、LKG、ack 重启持久化、identity-change withdraw、resolved discrepancy、ghostless endpoint 管理全绿）。本地已建隔离固定版本环境（`@opencode/cli@2.0.16` 于 `%TEMP%\litellm-e2e-fixed\opencode`，全局 2.0.24 未动）；CI 红的根因已修复并记录：era 不匹配（v7 dist 收到 catalog 形状 fixture → `models.dev：degraded` → `models.dev ok` 超时）非环境问题——E2E catalog server 现按已装 dist era 服务 `/catalog.json`（v8 catalog 形状）或 `/api.json`（与 PR #59 基线逐字段一致的 v7 provider map），`modelsDevUrl` 按已装 dist 的 `PUBLICATION_SCHEMA_VERSION` 选路

## 5. Core 稳定 SHA 后

- [x] 5.1 `build:dist` 取稳定 SHA → `verify:dist` → 全门禁 + Real OpenCode E2E（新 dist）
  - 证据：Core `a13f16fd983478572502f3896fd5509978027261`；artifact digest `sha256:f596488b9ad2f4030cc18a2a74265076f0b82bdc8a991419e41ebafec00c3790`；`verify:dist`（105 文件零差异）、`test:delivery`、`typecheck`、`npm test`（304 pass / 5 skip / 0 fail）、`test:tui-render`、`test:distribution`、`test:package`、`validate:spec`、`test:scenario-coverage`、`test:openspec-closure`、`test:release-metadata` 全绿；Real OpenCode 2.0.16 E2E 迁移到冻结 v8 语义（fixture 合并 e2e registry、fail-closed 指纹拒绝 + 恢复、每阶段保留确定性 modelsDevUrl），CI run 37913345669 @ `1391ebb` 全绿
- [x] 5.2 schema-8 LKG 正向恢复真实宿主 E2E 补强（最后一项 E2E 验收）：**通过**（2026-10-09，CI run 37965980728 @ `ce5a094`，`E2E_PACKAGE_SPEC=github:rpchen/opencode-litellm-provider#ce5a094...`，固定 OpenCode 2.0.16 Ubuntu/PTY，`Real OpenCode 2.0.16 E2E` 8m54s 全绿）
  - 证据：`scripts/e2e-opencode-v2.mjs` 新增场景 4e：以正式 Core v8 发布完整可信模型 `lkg-recovery-model`（limits-only 声明 + canonical registry 提供能力维度，completeness 依赖 live catalog）→ 真实宿主 `litellm-publication.state` RPC 直读 `configured` 且 lkgIDs 空 → 注入真实 models.dev catalog outage（确定性 catalog 源对 canonical 路径返回 HTTP 500），并经同宿主 guard 插件调用已安装 `dist/net/fetch.js` 的 `resetModelsDevCacheForTest` 真正清空 6h catalog 缓存（等价生产 TTL 过期触发；catalog 失败计数增长证明缓存未遮蔽 outage）→ Core 实际进入 LKG 恢复路径：模型继续注册、publication 状态 `configured-lkg`、`usingLKG=true`（lkgIDs 含该模型）、`lkgDetail` = `LKG originally fetched at <capture 时刻> via provider vendora -> model lkg-recovery-model (age …ms), live unavailable: metadata-unavailable`，diagnostics 卡片渲染 LKG 模型、来源与 `live unavailable` 原因 → 恢复 catalog 后重新发现回到 `configured`、LKG 0、无 LKG 标注。全过程 LiteLLM deployment identity、声明与 LKG proof 不变；断言基于真实宿主 RPC + 真实 TUI 卡片 + 宿主模型列表，不使用宿主 stale snapshot、模型列表未清空或模拟 Core 返回值。既有 fail-closed、自动恢复、metadata failure、ack 重启持久化、identity-change、resolved discrepancy、endpoint 管理场景断言全部不变
  - 附带修复（真实宿主 RPC 边界缺陷，`4b38d27`）：`litellm-publication.state` 输出在宿主 schema 校验下 `rpc.invalid_output`（`summarizePublication` 对缺席的 `lkgDetail`/`failureKind` 显式输出 `undefined`）；改为省略缺席可选字段并补单测，dist 以同一 Core provenance 重建（`verify:dist` 105 文件零差异，artifact digest `sha256:7136e101e2b24bfab2b16bbe745d3e40f6b9a5114d2a44def774c26fc98300af`）
- [x] 5.3 与 Core/Pi PR 互链；archive + canonical sync + strict validation
  - 证据：Core PR rpchen/litellm-discovery-core#32 已合入 core `main`（`a13f16fd983478572502f3896fd5509978027261`）；本 PR #60 经 squash + HEAD SHA 匹配保护合入 `main`（2026-10-10，merge commit `60bfe2c2076e2b33b86f39007e9bd30797dcde35`，PR HEAD `24a7885`），合入后 main CI（run 38010373201，`CI` + `Real OpenCode 2.0.16 E2E`）全绿，`Publish main index`（run 38010992575）发布 `60bfe2c` 的不可变索引快照；Pi PR rpchen/pi-litellm-provider#52 同日以 squash 合入其 `main`（merge commit `21b66ef2ba2eaab86accafec3bfed7266e4bfb8b`）。`openspec archive adopt-modelsdev-canonical-catalog` 完成归档并同步 canonical specs（`model-discovery`、`provider-diagnostics`、`publication`）；归档后 `openspec validate --all --strict --no-interactive`、`test:openspec-closure`、`test:scenario-coverage`、`test:release-metadata`、`verify:dist`、`test:delivery`、`typecheck`、`npm test`、`test:tui-render`、`test:distribution`、`test:package` 全绿（真实宿主契约无变化，Real OpenCode 2.0.16 E2E 由本治理 PR 的 CI 门禁覆盖）。
