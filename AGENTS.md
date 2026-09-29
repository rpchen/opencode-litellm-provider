# AGENTS.md

本文件是 AI 编码代理在本仓库工作时必须遵守的约定。变更流程由 OpenSpec 管理（见 `openspec/config.yaml`）。

本仓库是独立 Git 仓库（remote: `rpchen/opencode-litellm-provider`），不要求与部署仓库、Pi 或 core 位于平级目录。开始工作先检查目录、remote、分支、工作区和真实远端 main；不要覆盖、清理、stash 或提交用户已有未提交修改，必要时使用独立 clone/worktree。

## 目录结构

| 路径 | 用途 |
|---|---|
| `src/` | OpenCode 宿主源码（TypeScript ESM）；`src/index.ts` 默认导出 v2 Promise 插件，`src/tui.ts` 为 TUI 入口 |
| `src/host/models.ts`、`src/host/protocol.ts` | 中立 ModelSpec 到 OpenCode 的薄适配及宿主 SDK 映射 |
| `src/generated/discovery-core/`、`src/core/` | 构建时生成并被 Git 忽略的 core 源码与兼容转接；禁止手工修改或入库 |
| `dist/` | 必须提交的交付产物；`core-provenance.json` 记录所编入 core 的来源与完整 SHA |
| `scripts/` | core 准备、构建、固定产物复验及外部消费者测试 |
| `test/` | Bun 单元测试；fixtures/快照为脱敏行为基线，不得为迁移盲目刷新 |
| `docs/` | 调研与文档；`docs/decisions.md` 记录用户确认的决策，实施前必读 |
| `openspec/` | 变更提案、能力规格、归档 |
| `.opencode/`、`.claude/` | 已入库的 OpenSpec 代理 skills |

## 共享 core 边界

宿主无关 LiteLLM 地址/响应归一化、部署分组、协议判定、models.dev 匹配、能力/价格/限制、推理变体与指纹只在 **rpchen/litellm-discovery-core** 维护。仅通过其公共入口消费；不要重新维护本地业务副本，不要将 HTTP、轮询、凭据、缓存、注册或审计搬入 core。

`Protocol` 等中立类型来自共享公共入口；共享 `ModelSpec` 不含 `package`。SDK 路径与 OpenCode 输出映射属于宿主适配层。不得用新增 `any`、强制转换或弱化测试掩盖边界错误。保留现有入口、SDK peer/external 和 manifest 依赖，不新增运行时 core 依赖。

## 构建与验收

`npm run build:dist` 是显式更新操作：解析当时 core/main 的完整 SHA，在隔离源码目录以同一 SHA 完成类型检查、测试、tsc 编译，成功后更新 dist/provenance。SHA 是自动构建记录，不是手工维护依赖版本。core 更新不会改变已发布插件，下一次更新构建才包含新 core。

日常复验与 CI 使用固定输入，不能先执行更新构建或清理候选 dist：

```bash
npm ci
npm run verify:dist
npm run test:delivery
npm run typecheck
npm test
npm run test:tui-render
npm run test:distribution
npm run test:package
npm run validate:spec
```

`prepare:core`、`typecheck`、`test`、`build:fixed` 和 `verify:dist` 使用已有 `dist/core-provenance.json`。缺失/无效 provenance 必须失败，不回退 main。`build:fixed` 会更新产物；`verify:dist` 只在外部临时目录重建并比较路径和字节，绝不覆盖待验收 dist。提交前同时检查遗漏/多余产物，并保持原 fixtures/快照兼容。

`.tmp/discovery-core/<sha>` 是开发缓存，不是运行时依赖。准备步骤拒绝 Git 报告的暂存、未暂存或未跟踪修改，核对提交后从 Git 对象导出；被忽略文件不参与导出。不要自动 reset/clean/stash 脏缓存；先保留并处理开发者修改。缓存锁异常也应明确检查后处理，不能盲删运行中的锁。

## 安全与交付规则

1. 临时文件放 `.tmp/`；隔离构建与安装消费者必须位于工作区以外的系统临时目录。不得把本机路径或凭据写入 provenance。
2. 不得在仓库、fixtures、文档或日志写入真实 Key、内网地址、PAT、npm token；示例使用 `sk-xxx`、`http://litellm.example:4000`。CI/package smoke 不接触真实 LiteLLM 服务。
3. 真实 LiteLLM 验证仅使用 `~/.agents/skills/opencode-litellm-config-sync/.env` 中的 `LITELLM_BASE_URL` / `LITELLM_API_KEY`，只在运行时读取并留在内存。不得输出或持久化；不要读取 `~/.config/opencode` 中用户自己的 Key，不修改用户配置。无需真实服务的任务不要读取这些凭据。
4. 提交前执行适用验证；环境阻断时记录具体未运行项，不把部分编译、替身测试或 pending CI 说成完整通过。隔离安装提供实际 peer；模拟 host context/HTTP 不等于真实 OpenCode 验收。
5. 从最新 main 建功能分支并经 PR；已有同任务分支/PR先检查后续做，不强推、不覆盖他人工作。Conventional Commits，OpenSpec 随实施维护，完成后同步主规格并归档。
6. 安装只使用已提交 dist，不依赖生命周期脚本、core 下载、本地缓存或平级仓库。禁止精确 `scripts.build` 及 Git preparation 生命周期。普通迁移不自行合并、打 tag、创建 Release 或发布 npm；跨仓库触发不属于本次迁移。
7. **测试完成标准**：共享规范以 `rpchen/litellm-discovery-core/docs/testing-standard.md` 为权威来源。本仓库每个 OpenSpec Scenario 必须有可追踪自动化证据；安全/失败边界必须有真实负向输入；新增用户可见能力至少有一条贯穿 Core → ProviderSnapshot → command/RPC → TUI 的纵向自动化链路。禁止仅因 CI 全绿就宣称 Scenario 已闭环。

8. **模型发布边界**：必须遵守共享 testing-standard 的 Discovery 不变量。Core 可以保留 limit 未知的模型用于 diagnostics，但宿主 `buildModelSpecs` 不得向 OpenCode 发布 `limit.context <= 0` 或 `limit.output <= 0` 的模型；必须用通用 adapter 测试锁住该边界，不得只针对某个具体模型。
9. **发版与跨会话事实基线**：用户可见 `feat:`/`fix:` 合入后检查 Release/tag 是否落后于 main；release PR 必须同步 package/lockfile、README 当前固定版本和 release notes。下一会话开工前重新核对 main、最新 Release/tag、README、`dist/core-provenance.json`、active OpenSpec 和共享 testing-standard；结束前执行 retrospective，不能把“规范已写但实现未通用保证”的状态带入下一会话。
