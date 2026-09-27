## 1. 基线与规格
- [x] 1.1 核验三个远端 main、目标分支和既有迁移任务；只修改 OpenCode。
- [x] 1.2 阅读约定并建立 proposal/design/spec/tasks，记录环境限制。
- [x] 1.3 比较本地 core 与公共 API，确认并测试兼容边界；本地 8 个 fixture 对比场景通过。

## 2. 实施
- [x] 2.1 通过公共入口消费 core，将 Protocol 与 ModelSpec/SDK 边界移到正确层次。
- [x] 2.2 删除受 Git 管理的重复 core；保留原单元测试、fixtures 和快照。
- [x] 2.3 实现显式更新、固定 SHA 输入、干净缓存检查及 Git 对象导出。
- [x] 2.4 实现原 dist 独立重建比较、完整 provenance、许可证及产物提交。
- [x] 2.5 调整 CI/Release 与隔离安装，不引入生命周期或运行时下载。

## 3. 验证
- [ ] 3.1 完整类型检查及原 Bun 测试：协议、能力、价格、限制、推理及 SDK 映射。
- [ ] 3.2 完整构建与固定复验，没有平级仓库和预生成源码也可构建。
- [ ] 3.3 实际 verify CLI 正常/改动/删除/多余 dist 回归；相关 25 项 Node 单元回归已在本地通过。
- [x] 3.4 独立临时缓存中的干净、unstaged、staged、untracked、隐藏工作树修改回归通过。
- [ ] 3.5 禁用脚本的外部消费者安装，实际加载入口并验证初始化，说明 peer/替身边界。
- [ ] 3.6 评估真实 OpenCode v2 手动加载条件；仅具备条件时执行，未执行需单独记录。
- [ ] 3.7 执行 OpenSpec 严格校验、同步主规格并归档；不能把未执行项勾成通过。

## 4. 交付
- [ ] 4.1 更新 README、AGENTS、decisions 和构建操作说明。
- [ ] 4.2 Conventional commit、推送并创建 PR，核验 base/head/diff/CI，不合并不发版。
