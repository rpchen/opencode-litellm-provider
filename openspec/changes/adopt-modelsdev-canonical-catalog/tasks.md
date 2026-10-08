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
- [ ] 4.4 Real OpenCode 2.0.16 E2E（旧 dist 宿主契约回归）：本地 Windows 无 POSIX PTY（E2E 的 `startAttachedTui` 要求 util-linux `script`，CI 在 Ubuntu 执行）；已建立隔离固定版本环境（`@opencode/cli@2.0.16` 安装于 `%TEMP%\litellm-e2e-fixed\opencode`，`--version` 验证 `opencode v2.0.16`，全局 2.0.24 未动）并完成 era 感知修复（d6045e6：catalog server 同时服务 `/catalog.json` 与 `/api.json` 两种形状，`modelsDevUrl` 按已装 dist 的 `PUBLICATION_SCHEMA_VERSION` 选路——CI 红的根因是 v7 dist 被 catalog 形状 fixture 打成 degraded，非环境问题）；WSL2 不可用（`wsl.exe` 挂起无发行版输出），交 CI Ubuntu 固定基线门禁执行并记录

## 5. Core 稳定 SHA 后（BLOCKED）

- [ ] 5.1 `build:dist` 取稳定 SHA → `verify:dist` → 全门禁 + Real OpenCode E2E（新 dist）
- [ ] 5.2 与 Core/Pi PR 互链；archive + canonical sync + strict validation
