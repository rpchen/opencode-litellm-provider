## 1. 宿主验证（go/no-go 门禁）

- [x] 1.1 **go/no-go 门禁（已通过，结论 go）**：在真实 OpenCode **2.0.15 与 2.0.16** 各自验证 `ctx.session.prompt` 从命令 execute 上下文调用的可行性：消息出现在会话时间线、delivery 候选（steer/queue/沿用命令 invocation delivery）表现差异、busy 会话重入行为、返回时机与失败语义、命令等待上限；实测结论回写 `docs/research/` 与 design.md 并重新 strict validate。**任一版本不可行且无替代投递时机 → 停止后续任务，修订提案**；只测 2.0.16 不算通过（项目最低支持 2.0.15）。不读取用户 Key、不触发 LiteLLM 请求
- [x] 1.2 实施前固定在途变更 `fix-model-initialization-and-add-audit-export` 的基线 commit 并记录；检查 `audit-command.ts`、`audit-rpc.ts`、`index.ts` 当前状态作为接线基线（基线 = main `e866150`；在途变更尚未 archive，其 4.1/5.1 等任务仍未完成，本变更接线以其现有实现为基线）

## 2. 开关解析与消息构造

- [x] 2.1 在 `src/options.ts` 增加 `conversationFeedback` 布尔选项（默认 false，非布尔值容错为 false），`bun test` 中 options 解析单测覆盖默认、开启、非法取值三例
- [x] 2.2 实现反馈消息构造纯函数（内部导出结果对象 → 确定性文本：插件生成标识、成功/失败结构化字段、发现状态、模型数），单测覆盖：成功、失败（无路径占位符）、内容边界（不含报告内容/凭据）、路径编码安全（空格、引号、反斜杠、换行、控制字符、Unicode）、插件来源标识存在五组
- [x] 2.3 实现反馈提交模块：经 `ctx.session.prompt` 提交（按 1.1 实测的时机与 delivery）、有界等待超时降级、迟到 rejection 捕获；单测用注入的假 session 域断言提交调用、拒绝降级、超时降级三路径
- [x] 2.4 用 `test/fixtures` 中固定 LiteLLM `/v1/model/info` 样本构造审计快照，验证反馈消息中的模型数与状态和导出报告内容一致，且 fixture 中模型名、价格等其余内容不进入消息（config 强制要求）

## 3. 命令接线

- [x] 3.1 扩展 `performExport` 内部导出结果对象：与报告同源原子捕获发现状态与模型数（写文件前一次捕获），反馈消息读内部对象；公开 RPC `latest` schema 保持不变，单测验证
- [x] 3.2 在 `audit-command.ts` 接线：仅命令路径按开关提交反馈，RPC `export` 不触发（负向单测：RPC 路径对 session API 零调用）；开关关闭时命令路径对 session API 零调用、行为与现状逐位一致（回归单测）；新增双通道（开关开）与连接状态边界（切换/清空/stale/空清单）消息单测；快照一致性单测（写入期间状态变化，消息仍对应报告快照）
- [x] 3.3 同步 `dist` 干净构建并通过 `bun run typecheck`、`bun test`、`bun run test:package`

## 4. 宿主验收

- [x] 4.1 真实宿主（2.0.15 或 2.0.16，与 1.1 覆盖版本互补）验收开关关闭回归：执行命令导出两次，确认无对话消息、无模型调用、卡片/RPC 行为与在途变更验收记录一致
- [x] 4.2 真实宿主验收开关开启：TUI 执行导出，对话消息含插件标识、完整路径、发现状态与模型数，卡片照常显示打开/复制，模型回复正常（若模型失败，已提交消息留存）；连续两次导出消息序贯不冲突
- [x] 4.3 **Desktop 准备（已授权）**：从官方分发入口下载并静默安装 OpenCode Desktop **v2.0.16**（`%LOCALAPPDATA%\Programs\@opencodedesktop`）；确认可启动、共用后台服务（127.0.0.1:49374）、可加载本地 dist 插件（`plugin.list` 显示 `litellm` active）、`command.list` 含 `litellm-audit-export`、18 个 LiteLLM 模型可见；安装保留未卸载。注：安装时后台服务在运行导致安装器提示"OpenCode 无法关闭"，已用 `opencode service stop` 解除
- [x] 4.4 **Desktop 真实 e2e**：在 Desktop 中加载构建产物、开启 `conversationFeedback`，执行 `/litellm-audit-export`：会话时间线出现插件生成的反馈消息（状态/完整路径/发现状态/模型数），Desktop 无卡片通道时该消息为唯一反馈；开关关闭时执行导出确认无对话消息、无模型调用；连续两次导出消息序贯正确；失败导出（如目录不可写）消息含原因且无路径。
  - [x] 4.4a **数据层已验证（Desktop 自身服务）**：以 dist 插件 + `conversationFeedback: true` 配置重启 Desktop v2.0.16，创建会话后调用 `session.command`；`session.context` 返回 `type: user` 消息，内容为 `[litellm 插件] LiteLLM 审查报告已导出。\n路径：C:\\Users\\<user>\\AppData\\Local\\opencode\\litellm-audit\\litellm-audit-<UTC>.json\n发现状态：正常\n模型数：18\n说明：本消息由 litellm 插件生成…`，其后跟随 assistant 消息（宿主常规模型回复）。这证明 Desktop 所连接的服务已按预期产生反馈消息，且该消息即 Desktop 时间线的渲染数据源
  - [x] 4.4b **GUI 视觉确认（已通过）**：改用 CDP `Input.dispatchKeyEvent`（真实按键事件，非 DOM 合成）代替全局合成输入，成功在 Desktop v2.0.16 窗口中聚焦输入框、键入 `/litellm-audit-export` 并提交。截图（`docs/research/desktop-feedback-e2e.png`、本地 `.tmp/desktop/submit-result.png`）显示会话时间线渲染出插件消息气泡：`[litellm 插件] LiteLLM 审查报告已导出。/ 路径：C:\\Users\\<user>\\AppData\\Local\\opencode\\litellm-audit\\litellm-audit-2026-09-25T14-32-29-197Z-8e6c8efd57523f04d6b2ccfb18937edc.json / 发现状态：正常 / 模型数：18 / 说明：本消息由 litellm 插件生成…`，随后出现 assistant 回复。命令确实执行：同时刻新增报告文件 `litellm-audit-2026-09-25T14-32-29-197Z-…json`
  - [x] 4.4c **开关关闭对照（已通过）**：同一 dist 构建下把 `conversationFeedback` 置为 `false` 重启，新建会话执行命令后报告文件数 10→11（命令正常执行），而 `session.context` 返回 `messages=0`、`hasFeedbackMarker=false` —— 确认默认关闭时零对话消息、零会话 API 调用，回归符合 spec
  - **附带实测发现（用户已明确接受）**：开关开启时模型收到含报告路径的消息后，主动打开并读取了报告文件，并在回复中复述报告内容（"已打开并核对报告文件…状态 ready…模型数 18"）。这与 design §2/§4 预判一致——插件无法约束模型后续工具行为。**用户于 2026-09-25 明确表示：模型信息进入上下文可以接受（报告不含密钥），不作阻断性风险处理**。README 只做事实性说明（该消息含报告路径、模型可能据此读取报告），不使用告警措辞
- [x] 4.5 **能力验收规则**：Desktop e2e（4.4，经 4.3 准备）为完成本能力的必要门禁；仅当 Desktop 安装或运行本身在当前平台失败时，才允许先以"TUI 实测 + 源码级时间线证据"完成其余任务，并在 README/发布说明中如实标注 Desktop 未经实测、能力验收保持未完成、待补做后勾选；不得声称"所有客户端一致可见"直至完成

## 5. 文档与门禁

- [x] 5.1 更新 README：开关说明（默认关闭、开启成本、失败降级）、隐私逐项披露（路径进入会话记录、可经宿主同步/会话导出/远端模型日志离开本机、可能暴露用户名与目录结构、assistant 可能复述路径、模型可能经文件工具自行读取报告）
- [x] 5.2 更新 `docs/research/opencode-v2-plugin-api.md`：修正分支结论（dev 已为 v2 线），补充本变更核查的源码级证据（时间线渲染、synthetic 投影、prompt 通道）与 1.1 实测记录
- [x] 5.3 运行 OpenSpec strict validation、`bun run typecheck`、`bun test`、TUI 渲染回归、`bun run build:dist`、dist 一致性核对、`bun run test:package`；与在途变更最新基线 rebase 并重跑两变更相关测试、检查两 delta spec 组合无规范冲突（在途"卡片不调模型/路径不进模型"默认条款 + 本变更开关开启例外无矛盾）；经 PR + required CI 合并（在途变更先行），验证合并后 main CI 通过
- [ ] 5.4 **发行**：按不可变新 tag 发行（版本号在实施时与用户另行确定），核对 Release 工作流版本匹配、全部本地门禁重跑、tag Git package smoke、打包 tarball 与 SHA-256 校验；Release 说明如实记录新开关行为、默认关闭、隐私含义与 4.3 的 Desktop 验收状态（未实测即明示，不伪称）
- [ ] 5.5 **安装验证**：发布后从两种安装入口各自在真实宿主验证：默认 GitHub spec（`opencode plugin add github:rpchen/opencode-litellm-provider`，必要时 `plugin update/reload` 确认加载新提交）与固定新 tag（`...#<tag>`）；各自验证插件加载（`plugin list` 提交与来源正确、`plugin check` current）、模型发现与注册不回归、开关关闭时导出/卡片/RPC 与在途变更验收基线一致、开关开启时命令导出产生对话反馈消息且无模型请求外泄；对照在途变更 5.4 既有验收记录，不重复其模型调用验收但确认无回归；真实凭据只在宿主内使用，不读取不记录
