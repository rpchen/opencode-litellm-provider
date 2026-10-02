# 代码索引与 Release

本仓库已显式建立 `.codebase-memory/` 索引并将快照入库。新仓库不自动索引。

索引工具由用户级配置接入 Codex、OpenCode、Claude Code；Pi 使用同一工具注册表生成的扩展。工具启动时先下载最新 Release 快照，再按当前检出代码刷新工作索引。未发布附件、断网或 GitHub 不可用时保留已有索引，并在下一次启动重试。修改代码时仍以当前源码与 Git 为准。

## Release 附件

固定使用 codebase-memory-mcp 0.11.0、full 模式；只从干净源码和对应 tag SHA 生成。Release 附带：

- `codebase-memory.graph.db.zst`：压缩图谱；
- `codebase-memory.artifact.json`：原生元数据与源码 commit；
- `codebase-memory.release.json`：仓库、tag、commit、工具版本与前两项的 SHA-256。

现有 release.yml 在创建 Release 前生成附件，上传后回读并验证 tag SHA、schema、图谱格式与 SHA-256；失败会使 Release workflow 失败。

## 本地命令

`node scripts/codebase-memory.mjs sync` 下载最新 Release，`sync vX.Y.Z` 下载指定版本。快照保存在用户目录 `~/.cache/codebase-memory-releases/<owner>/<repo>/<commit>/`，不会覆盖 checkout、切分支或修改 tag。它与当前分支的工作图谱是两份不同用途的数据。

`node scripts/codebase-memory.mjs refresh` 刷新本地工作图谱缓存。CBM 0.11.0 会对已有持久目录自动重新导出，因此即使 persistence=false，也可能更新 .codebase-memory/ 中的生成文件；这些变化按 Release/里程碑审阅提交，不自动提交或推送。`build vX.Y.Z` 要求 HEAD 与该 tag 相同，更新本地 `.codebase-memory/` 并在 `.tmp/codebase-memory-release/` 生成附件；不会推送、打 tag 或创建 Release。新机器客户端接入步骤见 [工作区说明](https://github.com/rpchen/litellm-provider-workspace/blob/main/docs/codebase-memory.md)。

普通 PR 合并不生成 Release 附件；本地工作索引在工具启动时刷新，支持 MCP 的客户端另由 watcher 跟踪已索引仓库。没有会话运行时不承诺后台即时同步。本机离线期间，云端 Release 保留最新发布快照，下一次在线启动补齐。

## 索引成功与本地身份

发布构建要求原生 index_repository 明确返回 indexed；degraded、未知、缺失或其他状态必须在导出 manifest 前失败。随后 ready/节点数大于零不能代替成功。`npm run test:codebase-memory` 的 [CBM-DEGRADED] 覆盖 structuredContent 与 content/text 两种返回、七种非成功状态，以及仅落盘 2 个节点但预计 200 个节点的降级输入。

工作刷新不指定快照中的 name，按本机规范化 Git 根目录派生 project；客户端在同一根目录启动持久 MCP 会话注册 watcher。查询以当前 artifact.json 和 index_status 为准，从子目录启动也使用最近 Git 根目录。Pi 同样保持原生会话，新仓库继续不自动索引。工作区的真实 MCP 自动化验证新路径 clone、子目录和独立子仓库编辑后无需重启即可查询变化。
