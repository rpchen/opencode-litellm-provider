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
- [x] 4.1 Real OpenCode 2.0.16 E2E 阶段 2：`scripts/e2e-opencode-v2.mjs` 用 OpenCode 自己的 `plugin add` 安装固定 commit，在 PTY 中用真实按键驱动 TUI，仅以配置文件提供 options，覆盖 add → connect → activate → 模型可见 → edit Base URL（注释与高级字段保留）→ replace → disconnect → deactivate → delete → 重启后状态

## 5. README
- [x] 5.1 `README updated: 管理 endpoint（/litellm-endpoints）`；同步删除“完整 CRUD 不在范围内”的旧说明

## 6. Closure
- [ ] 6.1 PR 合入后 `openspec archive add-endpoint-management` 并 `openspec validate --all --strict --no-interactive`
- [ ] 6.2 按 AGENTS.md 发版（feat → minor）；打 tag 前向用户确认

## Requirement / Scenario → Test Evidence

| Scenario | Evidence files |
|---|---|
| HOST-UI | test\tui-endpoints.test.ts |
| LIST-EMPTY | test\endpoint-manager.test.ts, test\tui-endpoints.test.ts |
| LIST-SINGLE | test\endpoint-manager.test.ts |
| LIST-MULTI | test\endpoint-manager.test.ts, test\tui-endpoints.test.ts |
| LIST-EXTERNAL | test\config-file.test.ts, test\endpoint-manager.test.ts |
| ADD-OK | test\config-file.test.ts, test\endpoint-manager.test.ts, test\tui-endpoints.test.ts |
| ADD-DUP | test\config-file.test.ts, test\endpoint-manager.test.ts, test\tui-endpoints.test.ts |
| ADD-BAD-ID | test\config-file.test.ts, test\endpoint-manager.test.ts, test\tui-endpoints.test.ts |
| ADD-BAD-URL | test\config-file.test.ts, test\endpoint-manager.test.ts, test\tui-endpoints.test.ts |
| ADD-INACTIVE | test\endpoint-manager.test.ts, test\tui-endpoints.test.ts |
| ADD-PRESERVE | test\config-file.test.ts, test\endpoint-manager.test.ts |
| ADD-LEGACY | test\config-file.test.ts, test\endpoint-manager.test.ts, test\tui-endpoints.test.ts |
| EDIT-URL | test\config-file.test.ts, test\endpoint-manager.test.ts, test\tui-endpoints.test.ts |
| EDIT-ID-READONLY | test\config-file.test.ts, test\tui-endpoints.test.ts |
| EDIT-PRESERVE | test\config-file.test.ts, test\endpoint-manager.test.ts |
| EDIT-ATOMIC | test\config-file.test.ts, test\endpoint-manager.test.ts |
| EDIT-ISOLATED | test\config-file.test.ts, test\endpoint-manager.test.ts |
| EDIT-ENV-LEGACY | test\endpoint-manager.test.ts |
| CRED-CONNECT | test\tui-endpoints.test.ts |
| CRED-REPLACE | test\tui-endpoints.test.ts |
| CRED-DISCONNECT | test\tui-endpoints.test.ts |
| CRED-NO-ECHO | test\tui-endpoints.test.ts |
| CRED-ACTIVATION-INDEPENDENT | test\tui-endpoints.test.ts |
| CRED-CONNECT-CONSISTENT | test\tui-endpoints.test.ts |
| CRED-INVALID-KEY | test\tui-endpoints.test.ts |
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
