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
- [ ] 5.4 经已授权的新分支 PR 与 required `CI` 合并后，按不可变新 tag 发行；分别从默认 GitHub spec 和固定新 tag 安装并验证真实调用和导出，核对 Release 与升级说明。已发行的 v0.1.1 在活跃 TUI 即时卡片验收发现缺陷，保持该 tag 不变；修复后发行 v0.1.3 并重新验收两种安装入口。未完成真实安装验收时保持本任务未完成，不宣称修复已完整交付。

当前环境的部分验收记录（不代替未勾选的完整任务）：OpenCode 2.0.16 原后台服务已从默认 Git spec 更新到主分支，通过目标 Responses 默认和 `#low` variant 及已部署 Chat 代表模型的真实调用；当前部署没有 Messages 模型。`v0.1.1` 已经 PR／required CI／Release 流程发行，正式固定 tag 安装下导出报告为 `ready`、18 个 ID 与注册模型一致，路径可在重进相同会话后看到，但**已打开的 TUI 中命令与 RPC 导出都不会即时显示卡片**；已在 Release 标注已知问题。随后在同一原服务安装本地 Git 修复提交 `aa2c0ab`，实际已打开空会话中完成 RPC 导出、卡片即时显示完整路径和“打开报告／复制路径”；另一个空会话中输入并执行 `/litellm-audit-export` 也即时显示完整卡片；没有发送模型请求或读取用户 Key。模拟鼠标交互与 package／组件渲染测试通过，但真实点击打开／复制尚未执行，不能声称已验收。2.0.15 独立服务健康探测返回 401，`models --standalone` 也未列出 LiteLLM 模型，均不构成兼容成功证据；尚无 `/v1/responses` 的独立网络侧证据，亦未对当前真实连接执行 stale／空清单／切换验收。v0.1.2 已经 PR #8／required CI 合并、tag Release 工作流与 SHA-256 校验，并在原服务分别安装默认 Git spec 和固定 `#v0.1.2`：两者均完成目标 Responses 默认／`#low` 及 Chat 代表真实回复、活跃 TUI 命令即时导出并显示完整卡片；固定 tag 报告 `ready` 且 18 个模型 ID 与宿主集合相同。5.4 因后续真实 Windows Terminal 失败而重新打开：以上卡片通过记录来自伪终端，不构成真实窗口通过。v0.1.2 的发布和包校验事实保留，但不能宣称用户体验已修复；其余未勾选任务不能由上述部分证据替代。

## 6. Windows Terminal 活跃更新回归

- [x] 6.1 同版本同服务对照可见 Windows Terminal 的首次导出与重开恢复，定位状态到绘制链路的最早失败环节，记录可证实的代码根因。
- [x] 6.2 针对根因建立失败回归并最小修复；覆盖空结果到首次显示、连续更新、会话隔离与卸载清理，同步 dist 并通过全部本地门禁。
- [x] 6.3 当前环境加载修复构建，在可见 Windows Terminal 实际输入命令连续导出两次，不重进或强制刷新，查看原生窗口截图并核对最新路径；更新真实证据与未完成项。

本轮 6.1／6.3 证据：标题、路径和按钮已布局，但默认白字与宿主浅色背景同为白色；改用宿主主题色后，当前原后台服务配合本地 TUI-only 修复入口，在可见 Windows Terminal 首次导出及连续第二次导出都显示完整路径／按钮；深色窗口重开恢复正常，另一空会话无串卡。仅测试进程加载修复，不代表全局 `v0.1.2` 或已发布 Git package 已修复。详见 `docs/research/acceptance-notes.md`。
