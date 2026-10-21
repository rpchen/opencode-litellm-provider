## 1. Reproduction and implementation

- [x] 在真实 OpenCode 2.0.16 复现两个目录的 activation 分歧；在旧 TUI 实现验证位置回归失败。
- [x] endpoint RPC、integration 查询/连接与轮询使用当前 session location。
- [x] 管理状态刷新同步已保存 activation 并协调 runtime。
- [x] 使用固定 LiteLLM/Core 样本验证两个 runtime 的状态与模型发布。
- [x] README 说明 session location 与 activation 刷新行为。

## 2. Delivery validation

- [x] 固定 provenance 重建 dist，通过类型检查、单测及交付/分发/包检查。
- [x] 固定提交 34540af 通过 Real OpenCode 2.0.16 非默认目录 session 的真实键盘启用、模型发布和跨目录刷新回归。
- [ ] 通过 Real OpenCode 2.0.16 非默认目录 session 键盘启用回归与完整 E2E。
- [ ] strict OpenSpec validation、scenario coverage 和 closure 检查；验收通过后 CLI archive。
