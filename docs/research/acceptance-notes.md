# 真实环境验收记录

## 2026-09-24：OpenCode 2.0.15 与 LiteLLM

### 范围与安全措施

- 宿主版本：OpenCode 2.0.15。
- 以独立的 XDG config/data/cache/state 目录启动本地验收 server，不读取或修改日常 OpenCode 数据。
- 加载当前仓库 `dist` 目录中的实际构建产物，而不是直接调用插件内部函数。
- LiteLLM 地址和 API Key 仅在运行时从任务指定的 `.env` 读取并保存在进程内。
- 本文不记录 API Key、LiteLLM 地址、原始响应体或其他部署内部字段。
- 没有逐个探测发现到的模型；每种实际存在的协议只选择一个代表模型进行调用。

### 插件加载与连接

- 本地构建产物成功加载，插件状态为 active。
- `litellm` integration 与 `LiteLLM` provider 均成功注册。
- 通过 integration 的 key 连接接口提交地址与 Key，等价于 `/connect` 表单流程。
- OpenCode 的本地插件目录解析要求入口位于所配置目录的根部，因此开发态 `file://` 配置必须指向 `dist`，不能指向仓库根目录；README 已按实测结果说明。

### 模型发现

- 直接读取 LiteLLM 模型信息并按插件规则过滤后：18 个对话模型。
- OpenCode `model.list()` 中 `litellm` provider 的模型：18 个。
- 集合比较结果：缺失 0 个，多余 0 个。
- provider 级与模型级数据均未包含 API Key。

### 协议与真实调用

| 协议 | 部署中存在 | 真实调用 | 请求路径验证 |
|---|---:|---:|---|
| OpenAI Chat Completions | 是 | 成功 | `/v1/chat/completions` |
| OpenAI Responses | 是 | 成功 | `/v1/responses` |
| Anthropic Messages | 否 | 按任务的“若有”条件跳过 | 未声称已验证 |

Responses 模型成功使用 `@opencode/ai/providers/openai-compatible-responses`，确认该非内置首选包可在 OpenCode 2.0.15 的实际构建中加载和调用。当前部署没有 Claude/Messages 模型，因此 `@opencode/ai/providers/anthropic-compatible` 的真实加载及 Messages 鉴权仍需在未来出现相应部署时复核。

### Reasoning variants

通过只记录协议路径和 reasoning 选项的本地转发层检查实际出站请求；未记录 prompt、Authorization header 或完整请求体。

- Chat 代表模型选择 `high` 后，请求包含 `reasoning_effort: "high"`。
- Responses 代表模型选择 `high` 后，请求包含 `reasoning: { effort: "high" }`。
- 两个请求均由真实 LiteLLM 后端成功完成。

这确认了宿主会应用模型 variant，并且 `reasoningEffort` 会由各协议包转换为相应 wire 字段。

### 阶梯上下文截断

在 OpenCode 返回的模型信息中确认：

- 带 272k 输入价格阶梯的 GPT 系列模型，其 `limit.context` 与 `limit.input` 均为 272000。
- 带 512k 阶梯的 MiniMax-M3，其 `limit.context` 与 `limit.input` 均为 512000。

### 连接和失败同步

验收配置把 `pollInterval` 调整为允许的最小值 30 秒：

- 在一次成功发现后使 LiteLLM 网络路径不可达，等待超过一个完整轮询间隔；18 个上次成功模型仍然保留。
- 切换到无效 Key 后，旧模型清单被撤下，OpenCode 中该 provider 的模型数变为 0。
- 恢复有效连接后，18 个模型重新出现。

管理员侧真实新增/删除模型未在本轮执行。2026-09-24 用户明确决定将此操作性验收推迟到未来真实发生模型变更时；若届时出现问题，再反馈并迭代。本轮以自动化测试覆盖同一同步路径：轮询响应从一个模型变为两个模型后整体刷新，再从两个变为一个后删除消失模型。

### 结论

本轮已验证构建产物加载、连接表单对应 API、模型集合一致性、Chat/Responses 路由、reasoning variant 参数、阶梯截断，以及断网、无效 Key 和连接恢复行为。当前环境不具备 Messages 部署，管理员模型增删也按用户决定延期；两项均未伪报为已实测。

## 2026-09-24：GitHub-only 发行

### 仓库与合并门禁

- 仓库已公开：<https://github.com/rpchen/opencode-litellm-provider>，默认分支为 `main`。
- GitHub ruleset `Protect main` 处于 active 状态，无 bypass actor，当前用户不可绕过。
- ruleset 要求 pull request、最新 `main` 上的 required `CI`，只允许 squash merge，并禁止删除及 non-fast-forward push；单维护者 approval 数量为 0。
- 首次发行 PR #1 的 required `CI` 与合并后的 main CI 均通过。
- Windows Git 安装修复 PR #2 的 required `CI` 通过后 squash merge 为 `e9b654771daed021e4c611f577ef2e3ec6d02589`；对应 main push CI <https://github.com/rpchen/opencode-litellm-provider/actions/runs/35955265220> 通过，包括远端 commit Git package smoke。

### Windows 无 ref Git 安装

首次合并版本在 Linux CI 的普通 Git package smoke 中通过，但真实 Windows OpenCode 2.0.15 安装失败。诊断确认 Pacote 会把精确的 `scripts.build` 当作 Git dependency preparation 触发器，并在 OpenCode 直接调用 Arborist 的路径中尝试启动嵌套 `npm`，最终报 `spawn npm` ENOENT。

修复先更新 OpenSpec，再把构建命令改名为 `build:dist`，并在 package smoke 中拒绝 `scripts.build`、相关 lifecycle scripts 和 workspaces。修复合并后使用全新的 XDG config/data/cache/state 目录执行：

```bash
opencode plugin add github:rpchen/opencode-litellm-provider
```

结果：

- 安装成功，配置中写入无 ref GitHub spec；
- OpenCode 日志确认从隔离 Git cache 的 `dist/index.js` 加载插件；
- `opencode plugin list` 显示 `litellm`、提交版本 `e9b6547` 与 GitHub source；
- 验收未配置或读取 LiteLLM 地址与 API Key。

### `v0.1.0` 与 GitHub Release

- `v0.1.0` 指向已通过 main CI 的提交 `e9b654771daed021e4c611f577ef2e3ec6d02589`。
- Release workflow <https://github.com/rpchen/opencode-litellm-provider/actions/runs/35960033086> 成功完成版本匹配、全部本地门禁、tag Git package smoke、打包、checksum 与 Release 创建。
- GitHub Release：<https://github.com/rpchen/opencode-litellm-provider/releases/tag/v0.1.0>，状态为已发布且不是 prerelease。
- Release 含 `opencode-litellm-provider-0.1.0.tgz` 与对应 `.sha256`；下载后的 tarball SHA-256 与附件记录一致。
- 在另一组全新隔离目录中执行 `opencode plugin add github:rpchen/opencode-litellm-provider#v0.1.0` 成功，OpenCode 日志确认加载 tag package，`plugin list` 显示提交版本 `e9b6547`。
- npm registry 查询确认该 package 未发布；发行流程没有使用 npm token、PAT 或 LiteLLM 凭据。

## 2026-09-25：浅色主题卡片不可见的根因与本地修复

- 原生 Windows Terminal 中，无论先开会话再导出，还是导出后重开同一会话，卡片均不可见。临时诊断构建证明 setup、latest、会话关联与插槽均正常；卡片布局为 104×4，标题、路径与按钮均已创建。所有 TextRenderable 前景均为 RGBA `[255,255,255,255]`、背景透明；宿主 light 主题背景也是白色，而 `theme.text.base` 为 `[26,26,26,255]`。根因是卡片没有显式使用主题色，并非 Windows Terminal 不支持卡片或命令未提交。
- 伪终端字符断言只证明文字存在；此前的截图脚本进一步统一以黑字绘制，掩盖了白底白字。不能以该图证明真实配色可见。试改 slot sessionID 的响应式读取未解决问题，已撤回该试改，未作为颜色修复的一部分。
- 修复通过 `context.theme.text.base` 的 getter 将主题色传给全部卡片文本；自动 JSX runtime 也保留 `fg` getter，让已挂载的标题、路径、按钮、失败原因及操作反馈随主题更新。未增加运行依赖、模型请求或新的轮询。
- 颜色回归先在旧实现失败：实际 `[255,255,255,255]`，预期 `[26,26,26,255]`。修复后浅色／深色、已挂载主题切换、操作反馈／失败颜色、事件连续更新与 latest 收敛均通过；关键颜色与节点断言在 `renderOnce()` 前执行，字符帧不再是唯一判据。
- 使用当前 OpenCode 2.0.16 和原后台服务，**仅在自建 TUI 测试进程**以 `OPENCODE_CLI_CONFIG_CONTENT` 加载本地 dist（TUI-only 转发入口，不含诊断逻辑）；后台服务保留唯一 `#v0.1.2`。在可见 Windows Terminal 的新会话实际输入并提交命令两次，序号 2→3，每次均看到完整路径及两个操作，第二次路径改变，不重进、不切会话、不强制刷新。另在深色真实窗口重开同会话恢复最新路径；另一空会话不显示此前报告。
- 原生截图保存在本地忽略目录：`.tmp/windows-terminal-fixed-first.png`、`.tmp/windows-terminal-fixed-second.png`、`.tmp/windows-terminal-fixed-dark-reopen.png`、`.tmp/windows-terminal-fixed-other-session.png`，均已查看。截图包含本机报告路径，不作为公开 fixture 提交。
- 本地门禁通过：typecheck；89 项单测、304 个 expect 断言；TUI 渲染／模拟鼠标／颜色与主题切换回归；clean build；34 个 dist 文件再次 clean build 的 SHA-256 完全一致；禁用生命周期脚本的 package smoke；OpenSpec 全部 6 项通过；`git diff --check`。这些是本地结果，不代表已运行新的 GitHub CI 或已发布修复。
- 本次没有读取用户保存的 Key、调用模型、修改全局插件配置、移动 tag 或发布。测试进程外的全局安装仍为 `v0.1.2`，不能说该 tag 已包含此修复；正式发布与默认／固定新版 Git 安装验收仍待进行。真实打开报告／覆盖剪贴板未执行，继续只记录模拟鼠标测试通过。

## 2026-09-25：活跃 TUI 导出卡片修复

> 验收更正：本节此前的卡片可见／活跃更新通过记录来自 ConPTY／pyte 伪终端，不是可见 Windows Terminal。后续在可见 Windows Terminal 实际提交命令，确认同会话导出成功但卡片未出现；导出后另开伪终端则能恢复结果。v0.1.2 的真实窗口验收未通过，终端差异与启动／更新时序需分别验证。发行与模型调用的已有证据不因此被撤销。

- 已发布的 `v0.1.1` 固定 tag 在原 OpenCode 2.0.16 后台服务中导出成功、报告文件生成且 RPC `latest` 更新，但已打开的 TUI 不即时显示卡片；重进同一会话后才显示路径及操作。其 Release 已注明此限制，tag 保持不变。
- 在 `v0.1.1` TUI 增加 `latest` 短间隔读取并由原服务加载本地 Git 提交 `3d78066` 后，仍未即时显示卡片。OpenTUI 的 runtime plugin 只将 `solid-js` 裸模块重写为宿主共享实例，未重写插件原来导入的 `solid-js/dist/solid.js`；换成裸模块导入后再测试。
- 原后台服务加载本地 Git 提交 `aa2c0ab`，两个新建的空会话分别验证：（1）TUI 已打开时以 RPC 导出；（2）在 TUI 输入并执行 `/litellm-audit-export`。两者都无需重进即可即时显示成功卡片、完整路径与“打开报告／复制路径”；独立导出 RPC 返回成功。没有调用模型或读取用户保存的 Key。OpenTUI 测试渲染器还覆盖了模拟鼠标操作、失败反馈和最新结果收敛。
- 上述视觉与命令验收**不是**真实鼠标点击验收：为免未经确认就打开桌面应用或覆盖用户剪贴板，未在原 TUI 自动点击。另以 OpenCode 2.0.15 TUI 客户端连接原 2.0.16 服务，活跃卡片也即时显示；这**不证明**完整的 2.0.15 服务端兼容。
- PR #8 的 required CI 和合并后主分支 CI 通过；合并提交 `0dbb78c1c4cbea4dd42d36bf95564c9633b93bc3`。默认 Git spec 首次安装可复用旧提交缓存，经 `plugin update`／`reload` 后确认原后台服务只加载 `0dbb78c`；Responses 默认／`#low` 和 Chat 代表实际调用均返回成功，已打开的 TUI 中 `/litellm-audit-export` 命令即时显示完整路径与操作。
- `v0.1.2` 指向同一合并提交，Release 工作流成功；Release 含 tarball 和 SHA-256，下载后校验为 `OK`。原服务切换到唯一的固定 `github:rpchen/opencode-litellm-provider#v0.1.2` 后，再次通过相同三个代表调用和活跃 TUI 命令；RPC 报告 `schemaVersion: 1`、`plugin-submitted`、`ready`，18 个导出模型 ID 与 18 个宿主 LiteLLM 模型 ID **集合**一致，目标模型协议为 Responses，未见禁止字段。宿主模型列表另有自己的排序，不能以列表显示顺序不一致推断插件提交的审查顺序错误。
- 对独立 OpenCode 2.0.15 `serve` 再测：`GET /api/info` 返回 401，2.0.15 CLI `models --server` 退出码 1、未取得模型列表；因此不能宣称其服务端已兼容。真实桌面点击、完整 2.0.15 服务端兼容、真实连接的 stale／空清单／切换及独立代理端点抓证仍未完成；不能以这些部分结果替代它们。

## 2026-09-25：对话反馈通道（`conversationFeedback`）验收

**范围**：`add-conversation-feedback-channel` 变更的宿主验收（任务 4.1–4.4）。构建产物为本地 `dist`，通过插件配置 `file://` 入口加载；未读取用户保存的 Key、未改写用户配置（临时切换后已恢复）。
LiteLLM 地址与 Key 仅在运行时从任务指定的 `.env` 读取并保存在进程内，本文不记录其值。

### 协议层探测（任务 1.1，2.0.15 与 2.0.16）

隔离 XDG 四目录 + `config.plugins` 指向本地探测插件目录，`providers.stub` 指向本地假模型服务，`opencode serve` 起私有服务，经 `@opencode/client/promise` 调用 `session.command`。

| 探测 | 命令耗时 | 消息列表 | 模型上下文 | inbox |
|---|---:|---|---|---|
| `session.prompt`（默认 delivery） | 17ms / 19ms | 1 条 `type: user` | 可见 | 空 |
| `session.prompt` + `delivery: queue` | 11ms / 10ms | 同上 | 可见 | 空 |
| `session.prompt` + `delivery: steer` | 11ms / 10ms | 同上 | 可见 | 空 |
| `session.synthetic({ resume: false })` | 14ms / 9ms | **0 条** | 不可见 | 1 条 `type: synthetic` |

忙碌会话（模型请求长时间未返回）：命令 55ms / 42ms 内完成，`prompt` 46ms 内 resolve，不阻塞、不拒绝；反馈消息进入 inbox，随后可被消费显示。

**结论：go**。选定默认投递（不显式指定 delivery），命令不等待模型回复。

### TUI 真实宿主（任务 4.1 / 4.2，OpenCode 2.0.16，真实 LiteLLM 连接）

| 开关 | 命令 | 会话消息数 | 反馈标记 | 路径 | 模型数 | 状态 |
|---|---|---:|---:|---:|---:|---|
| `false` | 导出 ×2 | **0** | 否 | 否 | — | — |
| `true` | 导出 1 | 2 | 是 | 是 | 18（与真实连接一致） | 正常 |
| `true` | 导出 2 | 4（累计） | 是 | 是，**与第一次不同** | 18 | 正常 |

开关关闭时零对话消息、零会话 API 调用，报告文件仍正常写入。开关开启时消息包含插件标识、完整绝对路径、发现状态与模型数，其后跟随 assistant 回复；连续两次导出消息序贯且路径各异。

### Desktop 真实 e2e（任务 4.3 / 4.4，OpenCode Desktop 2.0.16）

- 从官方分发入口下载并静默安装 Desktop v2.0.16（`%LOCALAPPDATA%\Programs\@opencodedesktop`）；安装时后台服务在运行导致安装器提示"OpenCode 无法关闭"，用 `opencode service stop` 解除后完成安装。**安装保留未卸载。**
- Desktop 内部启动 `opencode-cli.exe serve --service`（`127.0.0.1:49374`），读同一份全局配置；以 `file://` dist 入口加载插件后，`plugin.list` 显示 `litellm` **active**，`command.list` 含 `litellm-audit-export`，`model.list` 中 `litellm` 有 **18** 个模型。
- 经 CDP（`--remote-debugging-port`）以 **`Input.dispatchKeyEvent` 真实按键事件**驱动 Desktop 窗口：聚焦输入框、键入 `/litellm-audit-export`、Enter 提交。界面截图（`docs/research/desktop-feedback-e2e.png`）显示会话时间线渲染出插件消息气泡，内容为状态／完整路径／发现状态／模型数／插件生成说明，随后出现 assistant 回复；同时刻新增对应报告文件。
- 开关关闭对照：报告文件数 10→11（命令正常执行），而 `session.context` 返回 `messages=0`、无反馈标记。
- 说明：早期尝试用全局合成鼠标/键盘事件驱动界面时，前台焦点漂移导致键入内容被送入其他窗口，已立即停止；后续全程改用 CDP 精确注入。**不得以全局合成输入作为验收手段。**

### 附带观察：模型会自行读取报告

开关开启时，模型在收到含路径的消息后**主动打开并读取了报告文件**，并在回复中复述报告内容（状态、模型数等）。这与设计文档预判一致——插件无法约束模型后续的工具使用行为。报告含模型名、价格与限制等元数据，**不含 API Key 或连接凭据**；用户已明确表示该行为可接受，README 对此作事实性说明。

## 2026-09-25：v0.1.3 默认与固定 tag 安装验收

- 宿主为 OpenCode v2.0.16。验收期间未读取用户配置中的凭据、未记录 LiteLLM 地址、prompt 或原始响应；真实调用由当前 OpenCode 连接处理。
- 默认 GitHub spec 实际加载提交 `6a1bed0`，`opencode plugin check` 显示 current。通过 `litellm/deepseek-v4.1-flash` 完成一次真实调用，收到预期结果标记。
- 使用默认 spec 新建的可见 Windows Terminal 窗口中，实际输入 `/litellm-audit-export` 并连续导出两次。卡片在活跃会话中即时显示完整路径和两个操作；RPC 成功序号从 1 更新到 2，第二次路径不同。截图已实际查看。
- 随后移除默认 spec、添加 `github:rpchen/opencode-litellm-provider#v0.1.3` 并重载。`opencode plugin list` 显示唯一 `litellm` 插件来源为固定 tag、加载提交 `1b774da`；`opencode plugin check` 显示 current。固定 tag 下同样完成一次目标模型真实调用，并在新建的可见 Windows Terminal 窗口中连续导出两次；卡片即时可见，RPC 成功序号从 1 更新到 2，第二次路径改变。
- 固定 tag 的原生窗口截图保存在本地忽略目录 `.tmp/real-terminal-before.png` 与 `.tmp/real-terminal-capture.png`；截图含本机报告路径，不应提交或公开。
- 本轮只确认卡片上的“打开报告／复制路径”操作可见；没有实际点击打开文件，也没有覆盖剪贴板。两种安装入口的模型调用与卡片可见性已验收，但真实点击操作仍未验收。
