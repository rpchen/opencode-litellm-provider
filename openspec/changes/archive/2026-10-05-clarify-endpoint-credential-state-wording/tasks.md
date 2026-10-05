# Tasks: clarify-endpoint-credential-state-wording

## 1. Spec delta

- [x] 1.1 编写 `specs/endpoint-management/spec.md` delta：MODIFIED `Endpoint listing`、`Add endpoint`、`Credential management`、`Delete endpoint`，把 credential 状态表达从 Connected / Not connected 改为已保存/未保存 API Key 等四种标签；`Credential management` 显式写明标签不得称为 Connected / Not connected。验证：`openspec validate --strict`。
- [x] 1.2 同步更新 canonical `openspec/specs/endpoint-management/spec.md`（MODIFIED requirement 语义与 delta 一致），archive 前通过 `openspec validate --all --strict --no-interactive` 与 `npm run test:openspec-closure`。

## 2. 用户可见文案 fix

- [x] 2.1 `src/tui-endpoints.ts` Add 成功 toast：`未启用、未连接` → `未启用、未保存 API Key`。
- [x] 2.2 `src/host/endpoint-manager.ts` migrate 失败消息：`当前没有已连接的 LiteLLM endpoint` → `当前没有配置地址的 LiteLLM endpoint`。
- [x] 2.3 `src/host/diagnostics.ts` 与 `src/host/audit-feedback.ts` 的 `disconnected: "未连接"` 渲染改为不与 credential 语义混淆的表达；`src/host/sync.ts` 的 note `LiteLLM 尚未连接。` 同步调整。内部 `DiscoveryStatus` 枚举值不改名。
- [x] 2.4 README 常见问题标题 `连接成功但看不到模型` → `已保存 API Key 但看不到模型`；解释性语句保留。
- [x] 2.5 重建 `dist/`（固定 core SHA，`npm run build:fixed`），`verify:dist` 通过。

## 3. 测试

- [x] 3.1 `test/tui-endpoints.test.ts`：Add toast 断言改为 `未启用、未保存 API Key`，新增负向断言（不含 `未连接`/`已连接`）。
- [x] 3.2 `test/endpoint-state.test.ts`：扩展 credentialLabel 负向断言（不含 `已连接`/`未连接`/`connected`/`disconnected`）。
- [x] 3.3 同步更新所有断言旧渲染文案 `未连接` 的测试。

## 4. 验证

- [x] 4.1 `npm run verify:dist`、`npm run test:delivery`、`npm run typecheck`、`npm test`、`npm run test:tui-render`、`npm run test:distribution`、`npm run test:package` 全部通过。
- [x] 4.2 `openspec validate --all --strict --no-interactive`、`npm run test:openspec-closure`、`npm run test:scenario-coverage`、`npm run test:release-metadata` 全部通过。
- [x] 4.3 全文审计：`src/`、`test/`、`README.md`、`scripts/e2e-opencode-v2.mjs` 中不再有把 credential 状态表达成已连接/未连接的用户可见文案；SDK/transport 工程术语保留。CI Real OpenCode 2.0.16 E2E 绿。