## 1. 基线与规格
- [x] 1.1 核验三个远端 main、目标分支和既有迁移任务；只修改 OpenCode。
- [x] 1.2 阅读约定并先建立 proposal/design/spec/tasks，记录环境限制。
- [x] 1.3 比较旧 core 与公共 API；本地 8 个 fixture 场景逐字段、JSON 顺序、指纹对比通过。

## 2. 实施
- [x] 2.1 通过公共入口消费 core，将 Protocol 与 ModelSpec/SDK 边界移到正确层次。
- [x] 2.2 删除受 Git 管理的重复 core；原单元测试、fixtures 和快照不变。
- [x] 2.3 实现显式更新、固定 SHA 输入、干净缓存检查及 Git 对象导出。
- [x] 2.4 实现原 dist 独立重建比较、完整 provenance、许可证及产物提交。
- [x] 2.5 调整 CI/Release 与隔离安装，不引入生命周期或运行时下载。

## 3. 验证
- [x] 3.1 CI 锁定工具链完整 typecheck 通过；113 项 Bun 测试、1 个原快照通过，覆盖协议、能力、价格、限制、推理、SDK 与宿主功能。
- [x] 3.2 CI 54 文件固定产物复验通过；外部临时目录无平级仓库、预生成 core、已有 core 缓存，完整固定构建通过。
- [x] 3.3 实际 verify CLI 正常通过，改动/删除/多余 dist 分别按预期失败且不覆盖候选；真实工作区保持不变。
- [x] 3.4 25 项 Node 回归在本地及 CI 通过；临时缓存覆盖 clean、unstaged、staged、untracked、隐藏修改和 Git 对象导出。
- [x] 3.5 tgz 与远端固定 Git commit 两种外部消费者安装均通过；禁用生命周期脚本，独立进程加载真实安装入口并执行 setup/cleanup、10 个模型与三个实际 SDK 检查。
- [x] 3.6 已评估真实 OpenCode v2 手动加载条件：当前环境没有宿主/Bun，未执行真实宿主或 LiteLLM 对话，不读取个人凭据；实际 peer + 模拟 context/HTTP 不计作真实宿主测试。
- [x] 3.7 在途变更严格校验通过；同步 shared-discovery-core/distribution 主规格并迁移至归档目录。归档后的主规格由该提交的 CI 再次严格校验。

## 4. 交付
- [x] 4.1 更新 README、AGENTS、CONTRIBUTING、decisions 和 OpenSpec 配置；保留版本 0.1.4 与原锁文件。
- [x] 4.2 Conventional commits，经认证连接快进推送并创建 PR #19，base=main；实现提交 CI 已全绿，后续文档/归档提交继续验收同一产物；不合并不发版。

## Validation Notes

已完成项的具体证据与环境边界见 `docs/research/pr3-core-migration-validation.md`。实现提交 `dc83ecf3e258a156bdc6d65ad5e6d44556018751` 的完整 CI run `36320877915` 已成功。最终文档/归档提交的 CI 状态以 PR checks 为准，不把旧提交成功等同新提交通过。

本地仅有 Node 与 TypeScript 5.8.3，不能执行完整锁定的 Bun/宿主依赖工具链；完整构建、typecheck、Bun、安装与 OpenSpec 命令的实际执行位置是 GitHub Actions。真实宿主手动加载和真实服务对话未执行，不属于已通过项目。
