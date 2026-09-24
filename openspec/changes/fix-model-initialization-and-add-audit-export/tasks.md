## 1. 复现与确认宿主接口

- [ ] 1.1 在用户当前 OpenCode 环境核对已安装 Git package、`opencode.jsonc` 中是否有活动的冲突 provider，并用当前后台服务实际调用 `deepseek-v4.1-flash`；记录脱敏错误类别、宿主版本、选定协议和包解析位置，不输出凭据／原始请求响应；另以受支持的 2.0.15 宿主核验兼容性。
- [x] 1.2 对比用户当前后台服务、同机新服务与已安装包，阅读 2.0.15／2.0.16 模型初始化和 SDK resolver，确认非内置 `@opencode/ai/*` 的动态导入与宿主内置静态导入的作用域差异；记录为什么改用内置包而不盲目增加依赖，并核对 Responses／Messages 的端点约定。
- [ ] 1.3 验证 `synthetic(..., resume: false)` 不即时显示的实际行为；在真实 OpenCode 2.0.15／当前 TUI 检查 server 命令和同包 TUI／RPC 入口是否可用，使用户调用命令后无需 LLM 即在对应会话看到可操作路径卡片或失败；核验复制、点击打开及多会话隔离。

## 2. 优先修复真实模型初始化

- [x] 2.1 按 1.2 的根因修正模型级及 provider 级 package／加载机制，并使 Chat、Responses、Messages 均引用宿主可解析的实现；验证 `test/protocol.test.ts`、`test/register.test.ts` 的 package 字段及 override／variants 回归测试通过。
- [x] 2.2 用 `test/fixtures` 中脱敏且固定的 LiteLLM `/v1/model/info` 样本覆盖 Chat、Responses、Messages、缺失数据及同名多部署，验证 `bun test` 中协议映射与实际交给 editor 的模型字段一致。
- [x] 2.3 扩展禁用生命周期脚本的打包 smoke，验证安装产物中模型和 provider 的 SDK package 在真实宿主期望的作用域可解析；运行 `bun run test:package` 并确认 `scripts.build` 等 preparation trigger 不会出现（smoke 不取代真实调用）。
- [ ] 2.4 在用户当前真实后台服务和加载该修复构建的真实 OpenCode v2 宿主手动发送一条 Responses 代表消息，验证 `deepseek-v4.1-flash` 可初始化、经 `/v1/responses` 成功返回，而非只检查模型列表；仅使用已连接的当前用户凭据，由宿主管理，不读取或记录 Key／原始请求响应。

## 3. 审查快照及安全序列化

- [x] 3.1 将同一次 `buildModelSpecs` 结果的注册视图和协议关联成不可变快照，确保 `ProviderEditor.add` 与导出读取同一视图；通过 `test/register.test.ts` 对比完整模型数、排序、ID、package、variants、价格、限制与协议。
- [x] 3.2 扩展发现状态记录和成功时间，覆盖未连接、首次待发现、正常、stale、认证／404 清空、连接切换、成功空清单；在 `test/sync.test.ts` 中验证网络降级、同指纹成功刷新、连接隔离和旧结果不被误标新鲜，同时轮询与 reload 不回归。
- [x] 3.3 实现 `schemaVersion: 1` 的显式 allowlist JSON 投影，验证固定 `/v1/model/info` 样本与 models.dev 数据产生的模型集与注册输出一致，模型名／推理等级原样保留，协议、阶梯价格、单位、无 variants 和缺失／默认字段说明符合 spec；用字符串日期、直接给出的数值日期和缺失日期三个样本验证提交原值及 `unix-ms`／`unknown`／`none` 单位标签，不改写宿主注册日期。
- [x] 3.4 编写负向泄密测试，向连接、原始响应的非注册字段及允许字段以外的可扩展设置注入 Key、Authorization、凭据 ID、私有 URL、路由、prompt；验证文件和命令反馈不会从这些非导出字段复制秘密或序列化完整 snapshot／provider 设置／源响应，同时允许字段中的模型名与推理等级仍与注册输出一致。

## 4. 导出入口、文件与用户体验

- [ ] 4.1 实现 `/litellm-audit-export` 主动命令、同包 TUI 会话结果卡片与 RPC 反馈；验证完整路径可留存、活跃 TUI 在事件丢失／未触发渲染时无需重进也能收敛到最新结果、点击打开和复制、操作失败反馈、迟到 TUI 的最新结果、多会话隔离、不会泄漏到模型请求或影响 provider 注册、poll/reload。
- [x] 4.2 实现私有状态目录中的唯一文件名、排他临时写入和完成后原子提交；测试路径绝对性、连续导出不覆盖、不可写和失败清理、已有报告完整性，并在 Windows 逐条检查实际目录和文件 ACL、拒绝其他显式授权。
- [ ] 4.3 更新 README，给出用户从已连接 OpenCode 调用命令、使用会话卡片复制／打开报告及 RPC 回退、找到文件、schema／字段与单位、各发现状态、路径／权限／覆盖策略、分享前敏感性及新版本升级／回滚说明；核对文档中的操作可在真实 2.0.15 宿主完成。

## 5. 集成门禁与发行验收

- [ ] 5.1 在用户当前连接的真实 OpenCode v2 中手动验证修复构建的命令可见、活跃会话不重进即可即时看到卡片、卡片可复制／打开报告、导出文件与当前注册模型集合一致，并分别检查 stale、空清单、连接切换后的报告状态；验证导出本身不会发模型请求且不包含地址或凭据。发布前的已安装 Git package 另行验收。
- [ ] 5.2 对当前实际部署存在的每种协议各选一个模型完成真实消息及 variant 代表调用，核对 Chat／Responses／Messages 的对应端点与模型初始化；不存在的协议注明未实测并以固定样本覆盖，绝不逐个调用全部模型。
- [x] 5.3 运行 OpenSpec strict validation、`bun run typecheck`、`bun test`、干净 `bun run build:dist`、`dist` 一致性核对和 `bun run test:package`；验证不含 `scripts.build`／lifecycle preparation trigger，真实凭据不进入 CI、fixtures、仓库或日志。
- [ ] 5.4 规划新版本号并在另行获得提交／推送／发布授权后，经新分支 PR 与 required `CI` 合并、按新 tag 发行；分别从默认 GitHub spec 和固定新 tag 安装并验证真实调用和导出，核对 Release 与升级说明。若已发行的 v0.1.1 在活跃 TUI 即时卡片验收发现缺陷，保持该 tag 不变，修复后发行 v0.1.2 并重新验收两种安装入口。未获发行授权或未完成真实安装验收时，明确保持本任务未完成且不宣称已发布可完整交付的修复。

当前环境的部分验收记录（不代替未勾选的完整任务）：在 OpenCode 2.0.16 原后台服务中先以本地修复构建验收，并在 PR #5 及安装缓存说明 PR #6 经 required CI 合并后，改装默认 `github:rpchen/opencode-litellm-provider`。`opencode.jsonc` 中只有该 Git 插件且无冲突的 `litellm` provider；首次 `plugin add` 曾复用旧缓存，经 `plugin update`／`reload` 后确认主分支提交 `37a0e9f` 已加载。目标 Responses 模型默认和 `#low` variant、已部署 Chat 代表模型通过当前后台服务取得真实 `OK` 回复、退出码 0；当前部署没有 Messages 模型。本地修复构建的命令曾在原服务中成功导出，RPC 给出文件绝对路径，报告处于 `ready`，18 个导出模型 ID 与宿主当时注册的 18 个 LiteLLM 模型完全一致，没有禁用字段，实际文件和目录只保留当前用户的显式 ACL。用户已在实际 TUI 确认原 toast 可见，并指出无法复制路径或点击打开；新卡片已实现，OpenTUI 测试渲染器中的首次显示、长路径、鼠标点击和失败反馈通过。ConPTY 自动探测只观察到命令文本进入终端，未得到命令执行或新卡片证据，**不能代替真实宿主 TUI 的视觉／点击验收**。2.0.15 `models --standalone` 未列出 LiteLLM 模型，独立服务的健康检查未通过，均不构成兼容性成功证据。主分支的顺序门禁（含 v0.1.1 tarball smoke、远程 Git package 和干净构建一致性）已通过；尚未捕获代理端点的直接网络证据，也未改变真实连接测试 stale／空清单／切换，或安装正式固定 tag 并验收其导出与卡片。
