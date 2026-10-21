## 1. Reproduction and implementation

- [x] 在真实 OpenCode 2.0.16 复现两个目录的 activation 分歧；在旧 TUI 实现验证位置回归失败。
- [x] endpoint RPC、integration 查询/连接与轮询使用当前 session location。
- [x] 管理状态刷新同步已保存 activation 并协调 runtime。
- [x] 使用固定 LiteLLM/Core 样本验证两个 runtime 的状态与模型发布。
- [x] README 说明 session location 与 activation 刷新行为。

- [x] [ACT-RECONCILE-ORDER] 用延迟 provider 清理在旧实现复现 desired 回退，串行协调修复后通过。
- [x] [ACT-CACHED-RESTORE] 用单实例固定模型快照复现已生效但无宿主模型，首次生效 reload 修复后通过。

## 2. Delivery validation

- [x] 最终修复按固定 provenance 重建 dist；308 项单测、类型检查、TUI、交付/分发/包检查通过，107 个 dist 文件固定复验一致。
- [x] 固定 Git 包通过 Real OpenCode 2.0.16 / 2.0.30 非默认目录 session 的真实键盘启用、模型发布和跨目录刷新回归。
- [x] 在用户实际 OpenCode 2.0.30 上验证单个非默认目录会话的键盘启用、模型发布和跨目录状态同步。
- [x] eb2f2375d0ecd33966f4ce4d68110bc6818047b6 的 CI #339（run 39532414531）中，常规 CI 及 Real OpenCode 2.0.16 / 2.0.30 完整 E2E 全部成功。
- [x] strict OpenSpec validation、scenario coverage 和 closure 检查通过；使用 CLI archive 同步 canonical 规格后再次验证。
