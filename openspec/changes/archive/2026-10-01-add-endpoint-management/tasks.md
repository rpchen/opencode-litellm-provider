## 1. OpenSpec
- [x] 1.1 proposal / design / specs/endpoint-management（`openspec validate --strict` 通过）

## 2. Implementation
- [x] 2.1 `src/endpoint-input.ts`（共享校验）`src/host/config-file.ts`（jsonc-parser 最小编辑、原子写、冲突检测、定位配置文件）
- [x] 2.2 `src/host/endpoint-manager.ts`（服务端 Add/Edit/Delete、legacy 迁移、被遮蔽只读保护）
- [x] 2.3 `src/host/endpoint-rpc.ts` / `endpoint-command.ts` 扩展；`src/index.ts` 改为可重建 runtime 的 supervisor
- [x] 2.4 `src/tui-endpoints.ts`（原生 select/prompt/confirm 管理流程；凭据走宿主 client API）
- [x] 2.5 `dist/` 按不变的 core SHA `8e155e0` 重建，`verify:dist` 通过（core 无变更）；新增运行时依赖 `jsonc-parser@3.3.1`
- [x] 2.6 更新既有 `test/tui.test.ts` 与 `scripts/test-tui-render.ts` 到“列表 → 详情 → 切换”的新流程

## 3. Tests（Specification Scenario Coverage = 100%，`npm run test:scenario-coverage` / `bun run test:scenario-coverage` 强制）
- [x] 3.1 每个 Scenario 在测试名或注释中带 `[SCENARIO-ID]`，下表由该脚本生成
- [x] 3.2 `test/config-file.test.ts` `test/endpoint-manager.test.ts` `test/tui-endpoints.test.ts`（TUI → RPC → 配置文件/凭据 client 的纵向用例）

## 4. Real host E2E
- [x] 4.1 Real OpenCode 2.0.16 E2E：`scripts/e2e-opencode-v2.mjs` 用 OpenCode 自己的 `plugin add` 安装固定 commit，在 PTY 中用真实按键驱动 TUI，覆盖三阶段：①既有启动恢复/activation 契约；②explicit endpoint 全流程（add → connect → activate → 模型可见 → edit Base URL（注释与高级字段保留）→ replace → disconnect → deactivate → delete → 重启后状态）；③legacy 全流程（真实 `/connect` 带 url answer → 迁移确认 → replace → edit 后新地址发现 → delete → 重启不复活）

## 5. README
- [x] 5.1 `README updated: 管理 endpoint（/litellm-endpoints）`；同步删除“完整 CRUD 不在范围内”的旧说明

## 6. Closure
- [x] 6.1 `openspec archive add-endpoint-management` 后 `openspec validate --all --strict --no-interactive`（随实施同一 PR 归档）

> 发版（feat → minor，需用户确认后打 tag）不属于本 change 的任务，见 PR 说明。

## 7. Review 2 边界修复（随实施归档）
- [x] 7.1 `[DEL-CANCEL]` Delete 流程重排：最终 Delete 确认（legacy 合并确认迁移+删除）之前零持久化变更，Cancel 不调用 `rpc.migrate` / `prepareRemove` / `remove` / credential 移除（`test/tui-endpoints.test.ts`）
- [x] 7.2 `[ADD-INACTIVE]` `[LIST-LEGACY-GHOST]` activation 物化只针对真实 configured/managed 定义：ghostless legacy 首次 Add 产生 `selected([])`，不写入 stale `default`（`test/endpoint-manager.test.ts`）
- [x] 7.3 `[ADD-ROLLBACK]` 区分 config commit 前后失败：commit 后 rebuild 失败保留物化 `selected`（不回退 `all`）、新 endpoint 保持 inactive、结果 `saved: true` + `code: "rebuild-failed"`、TUI 以 warning 报告“配置已保存、运行时重新加载失败”
- [x] 7.4 spec/design 同步强化 `[DEL-CANCEL]` / `[ADD-INACTIVE]` / `[LIST-LEGACY-GHOST]` / `[ADD-ROLLBACK]` / `[LEGACY-MIGRATE]`；scenario coverage 保持 43/43（100%）
- [x] 7.5 真实宿主 E2E 新增 legacy Delete Cancel 与 ghostless 首次 Add 场景（见 `scripts/e2e-opencode-v2.mjs`）

## Requirement / Scenario → Test Evidence

| Scenario | Evidence files |
|---|---|
| HOST-UI | test\tui-endpoints.test.ts |
| LIST-EMPTY | test\endpoint-manager.test.ts, test\tui-endpoints.test.ts |
| LIST-SINGLE | test\endpoint-manager.test.ts |
| LIST-MULTI | test\endpoint-manager.test.ts, test\tui-endpoints.test.ts |
| LIST-EXTERNAL | test\config-file.test.ts, test\endpoint-manager.test.ts |
| LIST-LEGACY-GHOST | test\endpoint-manager.test.ts, test\tui-endpoints.test.ts |
| ADD-OK | test\config-file.test.ts, test\endpoint-manager.test.ts, test\tui-endpoints.test.ts |
| ADD-DUP | test\config-file.test.ts, test\endpoint-manager.test.ts, test\tui-endpoints.test.ts |
| ADD-BAD-ID | test\config-file.test.ts, test\endpoint-manager.test.ts, test\tui-endpoints.test.ts |
| ADD-BAD-URL | test\config-file.test.ts, test\endpoint-manager.test.ts, test\tui-endpoints.test.ts |
| ADD-INACTIVE | test\endpoint-manager.test.ts, test\tui-endpoints.test.ts |
| ADD-PRESERVE | test\config-file.test.ts, test\endpoint-manager.test.ts |
| ADD-LEGACY | test\config-file.test.ts, test\endpoint-manager.test.ts, test\tui-endpoints.test.ts |
| ADD-ROLLBACK | test\endpoint-manager.test.ts, test\tui-endpoints.test.ts |
| EDIT-URL | test\config-file.test.ts, test\endpoint-manager.test.ts, test\tui-endpoints.test.ts |
| EDIT-ID-READONLY | test\config-file.test.ts, test\tui-endpoints.test.ts |
| EDIT-PRESERVE | test\config-file.test.ts, test\endpoint-manager.test.ts |
| EDIT-ATOMIC | test\config-file.test.ts, test\endpoint-manager.test.ts |
| EDIT-ISOLATED | test\config-file.test.ts, test\endpoint-manager.test.ts |
| LEGACY-MIGRATE | test\config-file.test.ts, test\endpoint-manager.test.ts, test\tui-endpoints.test.ts |
| CRED-CONNECT | test\tui-endpoints.test.ts |
| CRED-REPLACE | test\tui-endpoints.test.ts |
| CRED-DISCONNECT | test\tui-endpoints.test.ts |
| CRED-NO-ECHO | test\tui-endpoints.test.ts |
| CRED-ACTIVATION-INDEPENDENT | test\tui-endpoints.test.ts |
| CRED-CONNECT-CONSISTENT | test\tui-endpoints.test.ts |
| CRED-INVALID-KEY | test\tui-endpoints.test.ts |
| CRED-LEGACY-FORM | test\tui-endpoints.test.ts |
| ACT-TOGGLE | test\tui-endpoints.test.ts |
| ACT-ZERO | test\tui-endpoints.test.ts |
| ACT-CRED-INDEPENDENT | test\tui-endpoints.test.ts |
| ACT-IMMEDIATE | scripts\e2e-opencode-v2.mjs |
| DEL-CONFIRM | test\tui-endpoints.test.ts |
| DEL-CANCEL | test\tui-endpoints.test.ts |
| DEL-CLEANUP | test\endpoint-manager.test.ts, test\tui-endpoints.test.ts |
| DEL-ISOLATED | test\config-file.test.ts, test\endpoint-manager.test.ts, test\tui-endpoints.test.ts |
| DEL-NO-GHOST | test\endpoint-manager.test.ts |
| DEL-PARTIAL-FAILURE | test\tui-endpoints.test.ts |
| CFG-NON-DESTRUCTIVE | test\config-file.test.ts |
| CFG-PARSE-FAIL | test\config-file.test.ts, test\endpoint-manager.test.ts |
| CFG-CONFLICT | test\config-file.test.ts |
| CFG-COMMENTS | test\config-file.test.ts |
| CFG-SHADOWED | test\endpoint-manager.test.ts |
