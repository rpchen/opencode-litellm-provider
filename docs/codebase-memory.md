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

`node scripts/codebase-memory.mjs refresh` 刷新本地工作图谱缓存，不改入库快照。`build vX.Y.Z` 要求 HEAD 与该 tag 相同，更新本地 `.codebase-memory/` 并在 `.tmp/codebase-memory-release/` 生成附件；不会推送、打 tag 或创建 Release。新机器客户端接入步骤见 [工作区说明](https://github.com/rpchen/litellm-provider-workspace/blob/main/docs/codebase-memory.md)。

普通 PR 合并不生成 Release 附件；本地工作索引在工具启动时刷新，支持 MCP 的客户端另由 watcher 跟踪已索引仓库。没有会话运行时不承诺后台即时同步。本机离线期间，云端 Release 保留最新发布快照，下一次在线启动补齐。
