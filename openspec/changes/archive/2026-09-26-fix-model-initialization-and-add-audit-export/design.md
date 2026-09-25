## Context

参见 proposal.md。当前 `src/core/build.ts` 生成带 `protocol`、`package` 的 `ModelSpec`；`src/host/register.ts` 把它变成 `Model.Info` 并通过 `ProviderEditor.add` 注册，provider 级 Chat package 为默认值。`src/host/sync.ts` 保留内存快照并按指纹 reload。`package.json` 仅有 `@opencode/plugin` peer。已在用户当前 OpenCode 2.0.16 后台服务中复现 `litellm/deepseek-v4.1-flash` 的 `Cannot find package '@opencode/ai'`，其实际模型级 package 为非内置 `@opencode/ai/providers/openai-compatible-responses`，即 Responses 而非 Chat；同一版本另一安装路径的新服务可调用成功，不得把后者当作当前后台服务已修复。OpenCode 2.0.15 的 `@opencode/plugin` 提供 `ctx.command.transform` 与 RPC/TUI API；`synthetic(..., resume: false)` 只入 inbox，不会在命令执行后立即展示，不能用于即时反馈。

## Goals / Non-Goals

**Goals:**
- 以同一安装路径复现、定位和修复模型初始化阻断，明确区分导入成功、模型可见与真实发送成功。
- 以插件实际传给 `ProviderEditor.add` 的映射结果生成可审查、最小化、带状态的报告，不触发额外模型请求。
- 对导出失败、连接切换、轮询失败及新版本升级保有明确且可验收的行为。

**Non-Goals:**
- 读取宿主后续更改后的内部最终配置、导出完整 LiteLLM 响应、对每个模型发送探测消息、自动上传报告、提供比较表格／差异工具、重写既有模型判定规则。
- 在本次规划中宣称 `v0.1.0` 已修复，或把尚无部署的 Messages 伪报为实测成功。

## Decisions

### 1. 调用修复采用证据驱动的定向路径

先在用户当前 OpenCode 环境验证安装与配置，不读取或输出配置中的 Key。实际诊断：`opencode plugin list` 显示已加载 Git package，`opencode debug config` 解析得到 `providers: {}`，静态 LiteLLM provider 块仅在注释中；当前后台服务调用 `deepseek-v4.1-flash` 报包解析失败，模型列表显示其 package 是非内置 Responses 路径。OpenCode 2.0.15 的 `provider.ts` 对内置 package 使用宿主的静态 import，对其他 `@opencode/ai/*` 路径直接动态 import 且不执行 `npm.add`；因此插件自身增加依赖不能修复宿主打包导入位置的解析作用域。将 Responses 改用内置 `@opencode/ai/providers/openai/responses`，Messages 改用内置 `@opencode/ai/providers/anthropic`，Chat 保持内置 `@opencode/ai/providers/openai-compatible`，模型级和 provider fallback 均引用内置入口。不改协议判定优先级；改映射后用用户当前后台服务的真实 Responses 代表调用确认端点和 variants，并在实际部署存在时核验 Chat／Messages。当前环境追加本地 `file://dist` 到 `OPENCODE_CONFIG_CONTENT` 可临时加载构建而不修改 `opencode.jsonc`，但会与已有 Git 插件的 `litellm` ID 冲突；并且 `opencode run --standalone` 的私有服务在启动发现尚未完成时直接发送消息会报 `Model unavailable`，与原 `Cannot find package` 故障不是同一错误。不能把这些私有服务的即时失败当作协议修复失败或成功证据。后续验收必须确认插件 ID 唯一、连接已激活、模型发现完成后再发送，并保留当前后台服务不被未经提示重启。

### 2. 导出入口执行文件写入，TUI 会话卡片交付路径

2026-09-25 补充验收边界：v0.1.2 在可见 Windows Terminal 中已复现命令提交、同会话导出成功但卡片缺失；导出后新开伪终端可显示已有结果。此前伪终端通过不证明真实窗口的活跃更新通过，也不能直接归因为终端差异。修复前须对照先打开再导出与导出后重开，追踪实际加载、事件／latest、响应式状态与宿主绘制，确认最早失败环节。回归必须在可见 Windows Terminal 中实际输入并提交命令，无重启、切会话或强制刷新即可显示并连续更新卡片；组件测试主动调用 renderOnce 不替代这一证据。

以 `ctx.command.transform` 注册 `/litellm-audit-export`，命令闭包只读取当前插件内存状态，执行显式 allowlist 导出和原子文件写入。`execute` 返回 `Promise<void>`，不能把函数返回值或 `console.log` 当作 UI 消息。实测 `ctx.session.synthetic({ resume: false })` 仅在 inbox 排队，后续 prompt 才成为可见消息；不能因此强迫用户发起模型调用。server `ctx.rpc.register` 继续提供显式导出 RPC、命令完成／失败事件及最近结果 `latest`；TUI 先订阅事件再查询最近结果并按序号去重。原 toast 已在真实 TUI 显示路径，但无法方便地复制或点击打开，不再作为成功路径的唯一交付方式。改由同包 `./tui` 入口在公开 `session.composer.top` 插槽渲染按 sessionID 关联的结果卡片（位于会话消息区下方、输入框上方，不是历史对话消息）：展示完整路径并提供显式“打开报告”“复制路径”点击动作；失败同样呈现原因。该插槽要求 OpenTUI 的 JSX 元素及 Solid 响应式状态，故 TUI 入口必须新增 `@opentui/solid` 与 `solid-js` 运行依赖（server 入口不加载它们），并针对 Bun 默认 Node 条件下的本地测试运行时采用浏览器条件，同时从宿主可重写的 `solid-js` 裸模块共享客户端响应式运行时；禁用 lifecycle scripts 的 tarball／Git 安装和真实 TUI 装载都必须验证。使用系统默认文件打开器和可用的宿主／平台剪贴板机制，调用必须避免 shell 注入；操作失败显示明确反馈，保留路径与报告。TUI 晚加载可通过 `latest` 恢复同一服务最近一次导出，未打开的其他会话不得错显其路径；不承诺跨服务重启保存完整导出历史。正式 `v0.1.1` Git 安装的宿主验收发现：已经打开的会话执行命令时，文件及 RPC `latest` 更新成功，卡片却未即时出现，重进同一会话后才显示；TUI 组件渲染器和 RPC mock 单测未捕获该缺陷。给 TUI 增加短间隔 `latest` 查询后，原服务中仍不即时显示，说明仅有轮询不足。进一步核对 OpenTUI runtime-plugin-support：宿主将插件导入的精确 `solid-js` 模块重写为宿主共享的响应式运行时，但未重写 `solid-js/dist/solid.js`；原卡片使用子路径，导致插件 signal 与宿主插槽渲染的 Solid runtime 不同。改用 `solid-js` 裸模块导入，以共享宿主 runtime，并保持短间隔读取本地 `latest` 作为完成事件丢失时的收敛路径；按 sequence 去重并在卸载时清理计时器。必须在真正宿主的活跃会话中证实无需重进就能显示卡片，不以源代码推断或测试渲染器代替验收。该查询只读取插件进程状态，不触发 LiteLLM／模型请求，不写报告，不把路径交给模型。文件路径绝不自动打开或送给 LLM，命令本身不调用模型；无 TUI 客户端可直接从 RPC 获得结构化绝对路径。实际宿主需验收卡片显示、打开及复制，不以 `file://` 文本超链接未经验证的终端支持作为点击能力。

2026-09-25 根因确认：可见 Windows Terminal 中诊断得到卡片已挂载、会话正确、布局 104×4，但标题／路径／按钮的文本默认前景均为 `#FFFFFF`、背景透明，宿主 light 主题背景也是 `#FFFFFF`，形成白底白字。之前 pyte 只判断字符存在，图片脚本又统一绘制黑字，掩盖了颜色缺陷。修复显式使用公开 `context.theme.text.base`，以 getter 保持主题切换响应性；所有卡片文本（含失败及操作反馈）都需覆盖。增加真实颜色而非仅字符帧断言，分别验证浅色、深色及已挂载组件的主题切换。此前试改 slot sessionID 的响应式读取未解决此现象，不将其称为根因。

默认报告放入当前用户私有的应用状态目录（遵循 XDG_STATE_HOME；Windows 使用用户 LOCALAPPDATA），文件名带 UTC 时间与随机后缀；成功响应给绝对路径，不写入仓库或用户配置。使用排他创建、owner-only 权限（平台支持时），写入临时文件并同步后，以同目录硬链接原子发布唯一目标路径且拒绝覆盖，再清理临时文件；失败不损坏旧文件。Windows 除撤销继承外还须清除目录和文件的其他显式 DACL 授权，保留当前用户完全访问；实际文件 ACL 和目录 ACL 均逐条核对，不能只以不存在继承规则判断安全。路径与权限在 README 中具体说明，并在真实 Windows 宿主验证。仅明确命令触发时写磁盘，绝不于启动／轮询自动输出。

### 3. 注册与审查共享单次发布的不可变视图

从已映射 `ModelSpec` 构建单个注册视图：同一次发现的 `Provider.Info` 与按既定排序构造的 `Model.Info[]` 供 `ProviderEditor.add` 使用，同时与 `ModelSpec` 的 `protocol` 按 id 关联以生成审查记录。导出只投影明确允许的标量与数组，不直接序列化 `snapshot`、`Provider.Info`（含 `settings.baseURL`）、`sourceConnection` 或上游响应；variant id 与已知安全的 variant settings 值保留实际注册值，不从任意可扩展设置中附带其他键，也不尝试推测或过滤正常模型名及推理等级是否“敏感”。无新 reload 的同指纹成功轮询也更新成功采集时间和状态，而模型数据仍是同一映射结果。若发生 reload 竞态，导出以当前已提交／确认的视图为准；在没有成功注册视图时明确标记待发现，不能把新旧数据拼接。报告 `schemaVersion: 1`，`scope: plugin-submitted`，`exportedAt` / `lastSuccessfulDiscoveryAt` 使用 ISO 8601 UTC，价格 USD／百万 token，发布日期保留 `Model.Info.time.released` 的实际数值：当前 `releaseTimestamp()` 对字符串使用 `Date.parse()` 得到 Unix 毫秒，对数值原样透传且单位未知，默认 0 表示无可用日期。映射时仅在内存中关联来源类型／单位标签（`unix-ms`、`unknown`、`none`），不改变宿主注册值，也不导出原始上游日期字符串；如将来要统一注册单位，须另行核实宿主约定并修订模型映射规格。0／空数组是实际默认或无已知条目而不是上游已验证不支持。provider 只包含 id、name、activation、package 等允许字段；不输出 URL、headers、body、connection ID。

状态机增加独立的状态标签与最近成功时间：未连接、待首次发现、就绪、临时失败保留旧结果、认证失败清空、连接切换待发现、成功空清单。连接变化必须先撤下旧视图，绝不能把旧连接的模型导给新连接；失效连接或 404 清空时沿用现有注册语义并标记清空原因。纯导出读单个 `audit` 状态对象（含不可变视图），不主动 fetch/reload；对并发切换只读取一次状态对象，避免 TOCTOU 混杂。

### 4. 发现降级与基线差异

LiteLLM 网络错误／超时／429／5xx／解析失败保留同连接上次成功模型，仅标记 stale；401／403／404 撤下模型；成功空清单标记 empty。models.dev 不可达时继续用 LiteLLM，六小时进程内缓存不变；下一次刷新仍重试。启动、连接更新事件和默认 5 分钟轮询触发不变，指纹未变不 reload，导出不影响计时器。模型字段优先级、单条 models.dev 记录选择、协议优先级、variant 映射及阶梯截断逻辑不改。

与 `opencode-litellm-config-sync` 基线差异（差异 → 理由）：
- 插件只用用户连接的 Key 而非旧脚本高权限发现 Key → 遵守现有 `litellm-connection`，不扩大可见模型范围。
- 插件不读取 Codex `models_cache.json`、继续按 LiteLLM 阶梯截断 → 遵守现有 `model-discovery`，本 change 不改变模型语义。
- 新增可手动触发的审查 JSON，而非旧脚本写静态 provider 配置 → 审查实际运行时提交值，同时不改写用户配置。
- 若根因要求 package 引用或装载方式变化，仅调整使既有协议可真实调用的机制，不改变协议优先级或 variants → 修复运行时解析，而非改动原有模型映射规则。

## Risks / Trade-offs

- [用户环境与本地验收安装形态不同] → 优先在用户当前连接与实际出错的宿主安装路径加载修复构建并完成调用，不改写当前用户配置；发布前再以全新安装的 Git package 和固定新版本安装分别验收。保留受支持宿主版本和解析证据。
- [OpenCode v2 命令／synthetic 反馈并不公开稳定] → 先在 2.0.15 验证可调用与可见性，失败则先更新规划文档并改用经验证入口；不可默默只写文件。
- [模型名／价格本身敏感，报告路径可泄露信息] → 不输出根地址与连接标识，owner-only 文件、随机命名、不覆盖和分享前提示；Windows ACL 的实际行为需要验证。
- [provider 加载与快照更新交错] → 快照版本化并一次性冻结注册视图，连接切换先清理旧模型；导出失败保持注册正常。
- [Messages 缺少真实部署] → 固定样本与包加载测试覆盖该路径，实际环境不存在时记录跳过而不声称端到端成功。

## Migration Plan

1. 从新分支和 PR 修改源码、测试及同步提交干净构建的 `dist`，沿用 required `CI`、strict validation、无 lifecycle scripts 的 Git 分发门禁。
2. 在用户当前连接与实际出错的宿主路径验证已加载修复构建的 Responses 实际消息及主动导出，不修改用户 `opencode.jsonc`、不读取或记录其保存的 Key；其他已部署协议选择代表模型验收，不输出原始请求／响应或 prompt。另在新版本发行前，以实际安装的 Git package 验证安装行为和可回滚性。
3. 另拟新版本号并经 PR 合并后给新版本打不可变 tag、核对版本及 Release 工作流；验证默认 GitHub 安装和固定新 tag 安装都能加载、发现、实际调用且可以导出，再发布升级说明。`v0.1.0` 保留原状；回滚为旧 tag 会重新暴露该缺陷，须在文档明确标注。此规划本身不授权提交、推送或发布。
