## 1. Reproduction and implementation

- [x] 1.1 使用固定 discovery fixture 添加不同 endpoint 重叠 toggle 回归并先验证失败。
- [x] 1.2 在同一 runtime 队列内完成读取、计算、保存与协调；更新内部调用测试及 README。

## 2. Delivery and verification

- [x] 2.1 固定 Core provenance 构建 dist，完成本地测试、类型、交付与规格验证。
- [ ] 2.2 更新 PR #69，并通过当前实现提交的 OpenCode 2.0.16、2.0.30 真实宿主 CI。
- [ ] 2.3 同步 canonical spec 并用 CLI 归档，通过 closure 检查，记录 Scenario 测试证据。

## Evidence

- `[ACT-CONCURRENT-TOGGLES]` → `test/activation-runtime.test.ts` 同名测试：修改实现前失败（仅 personal），修改后 company/personal 的 activation 持久化、期望状态和实际模型发布均通过。
- 本地 `npm test`：309 pass / 0 fail；固定构建与 `verify:dist`：107 文件一致，Core SHA 保持 `a08db4a70498ae7f397c264bb3f7c01eb196e1f8`。
- delivery、typecheck、TUI render、distribution、package、strict spec、scenario coverage、closure 与 release metadata 检查通过。TUI harness 同步更新回调签名后单独重跑通过。
