# 跨客户端代码索引

## 使用约定

新仓库不自动建索引。四个仓库用已入库的 `.codebase-memory/selection.json` 显式选择 `merged-main` 分发。原生 `artifact.json` 与图谱是被忽略的工作文件；旧仓库只有 artifact.json 时仍保留原有接入方式。代理每个新任务先同步最新 main 与对应远端索引，再确认工作 marker 的 project/status；结构查询优先使用图谱，coverage 过时、缺失或跳过的部分回读源码。

MCP 配置使工具进入客户端的工具列表，使用约定使代理知道何时调用。两者都需要配置。模型是否遵循约定仍须从实际工具调用判断，不能把配置存在等同于每次任务必然调用。

工具的 project 标识以当前 `artifact.json` 与 `index_status` 为准，不硬编码上一会话的名称。CBM 可能按本机路径建立项目别名；Release 的源码身份由 GitHub 仓库、tag 和完整 commit SHA 验证，manifest 的 project 必须与发布图谱 metadata 一致，不要求跨机器沿用本地缓存别名。

## 新机器接入

1. 安装 Node.js、Git、GitHub CLI，并显式安装 `npm install -g codebase-memory-mcp@0.11.0`。发布附件下载通过 gh 使用当前用户已有认证；无需新增 API Key。
2. 在工作区先运行 `npm ci --ignore-scripts` 安装工具链开发依赖，再运行 `node scripts/install-codebase-memory-clients.mjs`。它在任何修改前只保存一次原始配置字节，安装用户级启动入口，然后配置 Codex、Claude Code、OpenCode v2 和 Pi。OpenCode 的旧配置使用 JSONC 结构化编辑并校验，原始备份不会被 CLI 写入的中间状态覆盖。不会建新索引、改 branch/tag、发布或提交。
3. 重启四个客户端。Codex/Claude Code/OpenCode 使用 stdio MCP；Pi 扩展按原生 MCP 注册表提供同名工具，并持有相同的 stdio MCP 会话直至 session_shutdown，使用相同参数和本地数据库。安装支持本机 Junction，不改权限或目录布局。

运行时脚本安装到用户目录 `~/.agents/codebase-memory/`，不依赖这个工作区所在路径。安装器固定 `auto_index=false`、`auto_watch=true`，四客户端保留持久原生会话。0.11.0 会重新导出已有工作图谱；这些输出现在被 Git 忽略，不再污染源码 PR 或 main。用户原有生成文件在迁移前备份，移除的是 Git 跟踪关系。

## 每次 PR 的完成条件

1. PR 的 CI 为实际审核源码生成完整候选索引；非 indexed 状态阻止 CI 成功。
2. 合并后，准确 merge SHA 的完整 CI 成功触发 `Publish main index`。它再次核对该 SHA 的 CI，生成索引并把图谱、原生 metadata、SHA-256 manifest 写到独立 `codebase-memory-index` 分支的 `snapshots/<source-SHA>/`。首次创建该分支是索引分发，不创建产品 tag/Release。
3. 同一源码 SHA 的快照不可覆盖。发布脚本下载远端结果并逐字节校验；索引分支只向前追加，不能反过来提交源码 main，也不会触发循环构建。这里使用长期 Git 存储，避免 Actions 临时附件过期。
4. 当前完成任务的客户端调用 `finish_codebase_task`，切回最新 main、取得相同 SHA 的远端快照、校验本地缓存与远端三文件的 Git blob/SHA-256，并激活当前代码的原生工作图谱。返回 ready 才能报告合并收尾完成。PR 显示 merged 本身不算完成。

索引 manifest 的源码 SHA 来自已经存在的合并提交，因此没有“快照提交必须包含自己的 SHA”的循环。发布失败或尚未完成时，准备工具明确报 pending，不能静默把旧索引当成最新。

## 新任务先同步

Codex、OpenCode、Claude Code 和 Pi 均暴露 `prepare_codebase_task` 与 `finish_codebase_task`。每个新任务必须先调用 prepare，传当前任务目录和 mode=new；MCP 已经连接也需要调用，不能只依靠进程首次启动。工作区根会同时准备三个已选择子仓库，独立子目录只准备最近 Git 仓库。

prepare 先 fetch 最新远端 main，并在改变 checkout 前取得对应完整 SHA 的已验证快照。干净的 main 只允许 fast-forward；已合并任务分支可以回 main。未提交源码、未合并分支、本地 main 的独有提交或其他 worktree 占用会阻止新任务准备，既有工作保留，不做 stash/reset/clean。显式续做旧任务使用 mode=resume，保留原分支并刷新其工作图谱，不能把该结果称作最新 main。

离线、索引发布失败、身份/校验不符均不返回 ready。客户端需要关注失败结果，不能在旧代码上直接实施新任务。源码同步与原生图谱激活使用仓库级锁，避免四客户端同时改同一 checkout。

## 启动同步与 Release

客户端启动只处理最近 Git 仓库中已显式选择的项目。工作区根还检查 workspace.json 子仓库，跳过未选择仓库。新分发模式优先同步 main 的准确 SHA 快照；Release 快照仍单独下载和校验，不能把旧 Release 当作最新 main。

工作图谱不沿用其他机器快照中的名称：刷新不传 name override，让原生工具按本机规范化 Git 根目录生成 project；MCP 同样在这个根目录启动。子目录启动和 Desktop roots/list 均归一到最近的已选择 Git 根。工作区的独立子仓库各保留原生会话注册 watcher，Pi 的会话也不会在初始化后立即退出。查询使用当前 marker/status 返回的本地 project；代码修改无需重启即可由原生 watcher 更新。若用户另行关闭 watcher_enabled，则需要手动 refresh。

| 数据 | 位置 | 用途 |
|---|---|---|
| 显式启用标记 | 源码 main 的 `.codebase-memory/selection.json` | clone 后知道该仓库已选择，不自动选择新仓库 |
| 每次合并快照 | 远端 codebase-memory-index 分支；本机 `~/.cache/codebase-memory-main/<owner>/<repo>/<SHA>/` | 本地与远端三文件字节一致，准确对应合并提交 |
| 工作图谱 | 原生本地数据库及被忽略的 `.codebase-memory/` 输出 | 按本机根目录注册 watcher，匹配当前代码与 coverage |
| 发布快照 | GitHub Release 三个 `codebase-memory.*` 附件 | 对应不可变 tag 的源码 SHA |
| 本地发布快照 | `~/.cache/codebase-memory-releases/<owner>/<repo>/<commit>/` | 与云端附件校验一致的版本快照，不覆盖 checkout |

两个插件把生成和回读校验接入现有 `release.yml`。Core 当前没有 Release；其工作流仅在未来 Release published 后上传对应 tag 图谱，不主动创建 Release。总工作区不发版。

每份发布快照固定 codebase-memory-mcp 0.11.0、full 模式，包含原生图谱、原生 metadata、仓库/tag/commit/工具版本和 SHA-256 manifest。构建拒绝脏源码、HEAD/tag 不一致、工具版本不符或索引失败；原生 index_repository 必须明确返回 indexed，degraded、未知、缺失或其他状态均不得生成发布 manifest，不能用随后 ready/节点数大于零代替成功。同步拒绝身份、schema、图谱格式或校验值不符。下载后不切分支、不改 tag、不覆盖工作区文件。

GitHub 无法向关机或离线的电脑写文件。本地按用户确认的方式在下一次在线启动时补齐。旧 Release 没有附件时不回填历史发行；离线、下载或刷新失败不会阻止客户端启动，已有索引继续可用，代理需注意 freshness/coverage，下一次启动重试。

## 手动命令与维护

每个新任务执行 `node scripts/codebase-memory-main.mjs prepare`，授权合并后执行 `node scripts/codebase-memory-main.mjs finish`；MCP 两个同名任务工具封装该协议。ready.json 记录 Git SHA、源码 tree、原生 project、快照位置及校验值。`build`/`publish` 由 CI 使用，不在普通客户端自动发布。

原有 `node scripts/codebase-memory.mjs sync [vX.Y.Z]`、`refresh` 和 `build vX.Y.Z` 继续用于 Release 快照与工作图谱；它们不创建 tag/Release。

索引/发布脚本在每个独立仓库内各自可运行，不需要平级 checkout，也不进入插件 runtime/package。客户端启动脚本与安装器由工作区维护；修改后显式重跑安装器更新用户级副本。四个仓库的 Release 工具副本只处理开发索引，不承担 Core 的 discovery 业务算法。

普通 PR 合并生成专用索引分支快照；正式 Release 另外生成该 tag 的附件，发行授权规则保持有效。

## 验证入口

持久 MCP stdout 使用流式 UTF-8 解码，再按 JSONL 分帧；不得把每个 Buffer 单独转换后拼接，否则跨字节边界的中文和 emoji 会静默损坏。`scripts/codebase-memory-session.test.mjs` 的 [CBM-UTF8] 使用实际 McpSession 和隔离子进程，覆盖完整响应、三字节中文与四字节 emoji 的每个内部字节边界，并比较 content 与 structuredContent 的原始内容。子进程等父进程读完首块再发送剩余字节，确保操作系统不会合并测试分块。该测试由 `npm test` 和 CI 执行。

工作区 `npm test` 覆盖发布边界、降级状态、最近 Git 根、JSONC 首/中/末项及嵌套/注释、原始字节备份和 CLI 失败；`npm run test:mcp` 使用真实 0.11.0 验证新路径 clone、子目录启动和工作区独立子仓库修改源码后，保持同一 MCP 会话查询新符号。三个子仓库 CI 都执行 `npm run test:codebase-memory`，包括 structuredContent 和 content/text 两种原生降级返回。实际 Release 是否完成必须核对 workflow 和已发布附件；合并 PR、打 tag、创建 Release 仍须用户明确授权。

接口依据：[codebase-memory 配置](https://github.com/DeusData/codebase-memory-mcp/blob/v0.11.0/docs/CONFIGURATION.md)、[Pi 官方桥接生成器](https://github.com/DeusData/codebase-memory-mcp/blob/v0.11.0/src/cli/client_adapter.c)、[OpenCode v2 MCP schema](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/config/mcp.ts)、[Codex MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。

## 本轮审核后的同步安全边界

prepare/finish 在等待与下载完成后重新 fetch main；原生工作图谱激活后再次核验远端。目标 SHA 前进时获取新 SHA 的准确索引，沿用第一次调用的总等待预算；失败和超时清除本次 ready 回执。ready 的 remote_verified_at 是最终远端核验时刻，commit/index_commit/tree 与实际 symbolic branch/HEAD、三文件 snapshot_sha256 一致。这是该时刻的事实，不冻结以后发生的 GitHub 合并。

同步锁位于 Git common dir，所有工作树和客户端共用；owner 带 PID 与随机 token。下载后和每次 Git 修改前核对分支、HEAD、main 引用和工作区状态。先安全检出目标提交，再以旧 OID CAS 更新明确的 refs/heads/main，最后正常切 main；不通过当前 HEAD 合并其他分支。并发分支、源码、暂存或未跟踪变化会安全失败，Git ref 和文件不被强制覆盖。普通编辑器与其他直接 Git 命令不参与 MCP 的互斥；状态保护和非强制 Git 命令阻止覆盖，ready 只证明最终检查时刻。

GitHub 默认 concurrency group 只有一个 pending 槽位，cancel-in-progress:false 仍可能取消旧 pending。发布 group 改为完整 source SHA，较旧 CI 晚完成不会挤掉最新 main 的任务；同 SHA 重复任务由不可变快照幂等处理。不同 SHA 的发布者并发创建 Git 对象，共享索引分支只接受 fast-forward；409/422 重新取父提交、退避并重试，禁止 force=true。永久网络/权限失败仍会使任务失败，需要重跑失败工作流或 workflow_dispatch；不能把失败称为 ready。

main 索引从隔离、固定的干净 Git 检出生成，前后核验原始与隔离 checkout 的 HEAD/tree/分支/dirty，以及原生 status 的 root/project/counts 和 artifact 的 git-clean-head 来源标记。manifest 增加 source.kind=isolated-git、commit/tree/clean。没有这份来源证明的旧 main 快照不再被接受为新协议 ready；保留旧快照不覆盖，后续合并的准确新 SHA 由更新后的 CI 正常生成。Release 附件协议保持原样。

同 SHA 的缓存下载各用独立 staging 目录。rename 输家只在严格验证赢家的源码身份、完整三文件、SHA-256 和远端 Git blob 后复用；缺失、损坏或错误身份的赢家不会被信任或删除。工作区已选择子仓的 metadata 损坏或身份不符必须使整体准备失败；仅缺失工作 artifact 的已选择新 clone 仍纳入预期集合，必须成功恢复才可 ready。所有预期仓库的回执须齐全且与实际 Git 身份一致。

四客户端通过同一已安装 stdio 入口执行失败门禁，Pi 也转发到该入口。门禁从原生 tools/list schema 识别 project、base_project、target_project 等项目参数，额外覆盖原生接受的 project_name/project_id/projectName。用原生 index_status 解析别名、路径和数据库内部名称到同一根目录，比较工具任一目标失败均被拒绝；无法解析时不放行。list_projects/index_status 仅保留诊断能力。每个新任务是否主动调用 prepare 仍由代理遵守 AGENTS 约定；MCP 无法感知宿主对话的任务边界，也不能拦截任意 shell/编辑器写入。此部分不宣称已有四宿主级强制任务拦截器。

共享回归入口为 node --test scripts/codebase-memory-main.test.mjs；使用临时 bare remote、独立 checkout、实际 Git 状态和独立子进程，索引服务模拟 GitHub API但实际写 Git 对象/ref。覆盖目标前进、同 SHA 换分支、tracked/untracked/staged/commit、预算、失败边界、固定源码、CI 乱序、并发发布与同 SHA 缓存。workspace 的 codebase-memory-client.test.mjs 另含真实原生 MCP 的 schema、别名/路径/compare 双目标失败门禁，以及已选 metadata 损坏/缺失/身份与回执校验。历史负向控制入口 node scripts/codebase-memory-review-baseline.mjs <审核前提交> 仅适配外部 I/O，不修改旧状态机或测试断言；旧故障必须使同一回归失败。

排队语义依据：[GitHub concurrency 官方文档](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)。
