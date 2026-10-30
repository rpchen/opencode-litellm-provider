# Tasks

## 1. 启动恢复与状态

- [x] 1.1 实施本地初始化屏障和快照待确认状态；`test/index.test.ts` 验证两模式首次宿主读取。
- [x] 1.2 保留离线快照及成功刷新替换；`test/sync.test.ts` 验证两模式、断网和网络恢复。
- [x] 1.3 验证无快照、不兼容快照和发布门禁；运行 `test/sync.test.ts`、`test/endpoint-state.test.ts`。
- [x] 1.4 用固定 model/info 样本验证现有发现链路；运行 `test/metadata-priority.test.ts`。

- [ ] 1.5 扩展 2.2 宿主兼容声明并在 CI 覆盖最新稳定版，完成真实宿主全量 E2E。

## 2. 交付验证

- [x] 2.1 分别用 Bun 和 Node 运行全部测试，运行类型检查、固定 provenance 构建和 dist 复验。
- [x] 2.2 使用固定候选和 OpenCode 2.2.3 真实宿主验证断网冷启动首次模型列表。
- [ ] 2.3 验证 GitHub 最新宿主检查通过，并切换 ruleset、回读其他保护。
- [ ] 2.4 严格验证并归档 OpenSpec，同步主规格。
