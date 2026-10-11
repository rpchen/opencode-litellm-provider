# OpenCode 实施与验收证据

Core #34 squash merge 为 `cf797e953eb1f6de8e7c3e0fd5e98094398c26f9`；Pi #55 与本插件构建、复验和真实安装均固定该完整 SHA。

## 实施结果

Core configured/configured-lkg 分区直接薄映射到 Model.Info。工具/模态、context/input/output、同记录参考价格与声明 variants 保留，注册前沿用通用正有限上限检查。Model.Info 没有 reasoning 布尔字段；RegistrationView/audit 独立保留 Core supported/unsupported。删除本地 tools 再判定、serving/candidate/operator 诊断和旧字段差异 schema/渲染/测试，不复制模型匹配算法。

沿用 endpoint/auth/activation/protocol/sync/storage 入口消费 publication9/snapshot2；坏价归0，contextTierCap接受但忽略，内部route变化不让model_name LKG失效，成功删除和认证失败仍撤下。README、当前ADR/context与publication Purpose同步；历史archive不改。

冻结16项JSON从合并Core逐字节复制，未刷新预期。SHA256：

| 文件 | SHA256 |
|---|---|
| synthetic-discovery.json | C95582D16D23E26D31CA7DE195670832C69B241504F639EAF2319D440CF2D1CD |
| modelsdev-subset.json | 2BC675AC81AFF60DC1D0165F42BBC79E64D96C32A9E443ABD1C27A2785769987 |
| expected-16.json | 653BBC55AE483FD0B198F903094D4E89A4903411E71D2EE999BAE2F6B73E5BCC |

## 已执行本地验证

Windows Node24.13.0 / Bun1.3.10。`npm ci`通过；`node scripts/build.mjs --sha=cf797e953eb1f6de8e7c3e0fd5e98094398c26f9`隔离更新105项dist。以下命令均退出0：

- `npm run verify:dist`、`npm run test:delivery`（38项）、`npm run typecheck`、`npm test`（301/301，28文件，322.31秒）、`npm run test:tui-render`、`npm run test:distribution`。
- `npm run test:package`：外部临时目录的真实2.0.15 peer，tarball禁用lifecycle初始化成功，3模型/3 SDK/双入口；合成完整API记录替代旧era选择，未降低数量/字段断言。
- `npm run validate:spec`（24/24）、`npm run test:scenario-coverage`（43/43）、`npm run test:openspec-closure`（32项门禁测试、36 archives/48 capabilities/178 requirements/409 scenarios、0 mismatches）、`npm run test:release-metadata`（0.10.0）、`npm run test:merge-gate`。

`test/metadata-priority.test.ts`逐16模型检查最终字段与每GPT独立档位，显式false/unknown、无档位、后备整记录、价格错误、模型删除、scope、schema2价格容错与关键完整性负例。`scripts/test-tui-render.ts`以相同16项输入贯穿Core→snapshot→diagnostics command/RPC→实际rendered card，显示16/16、deepseek来源与low/high/max且无proof术语。

## 真实 OpenCode 2.0.16 门禁

Ubuntu CI安装准确2.0.16，OpenCode自身plugin installer安装不可变Git候选，隔离HOME/XDG、两个fake LiteLLM和独立合成credential。未读取用户配置/真实服务凭据；外部catalog不可达，本地独立catalog提供冻结公开记录。catalog失败是实际HTTP500，已安装模块的既有测试入口只清TTL，不mock Core结果。

`/api/model`实际注册/供picker使用的列表逐16字段对oracle；真实session model选择与GET核实，然后prompt发每声明effort。捕获Chat/Responses/Messages请求验证原model_name、路径、有效effort/已有预算；支持无档位与不支持推理分别验证不加参数。复用同一会话覆盖档位切换。

测试环境说明：fake服务只返回普通回复，未实现宿主压缩摘要模板，因此隔离宿主配置设置`compaction.auto=false`，不写插件或用户配置。Responses原生SDK通过`configuration_update`切换同会话effort并保留最初顶层effort以维持prompt cache；断言核对最后update的生效值，无update时核对顶层值。依据已核实`@opencode/ai`的effort-updates/openai-responses实现及实际请求，不改oracle或注册值。

价格错误、catalog outage+内部route变化、恢复、删除、通知跨重启、网络/auth、activation、完整endpoint管理和legacy迁移同脚本自动化验证。真实终端PTY沿用项目Ubuntu门禁，Windows本地未运行该完整native gate；package模拟context不是其替代。

候选`4663f9251113f471d3196b1118ef822174e4d9ef`的[CI 38068474541](https://github.com/rpchen/opencode-litellm-provider/actions/runs/38068474541)为SUCCESS，两个必需job均通过。Linux完整301/301；真实宿主16/16最终注册/picker、63个Chat/Responses/Messages请求全部通过，包含3个无档位实际型号和额外支持/不支持/Messages控制。日志随后确认价格/critical/LKG/恢复/删除/network/auth/通知重启、endpoint完整操作、legacy迁移和ghostless启动均通过。最终文档提交的HEAD仍执行相同门禁，不把旧候选冒充当前HEAD。

## Review 5481244464 最小修复

两个已有失败分支在生成 diagnostics 后，将同次 cache.source 同步到 audit.cacheSource；spread 保留旧 view、配置及 lastSuccessfulDiscoveryAt，不新增状态或缓存策略。README 仅改写 withheld 原因的旧 deployment proof 说明，保留唯一 canonical 匹配失败、关键元数据缺失与非法元数据。

test/sync.test.ts 的既有网络故障断言在旧实现失败（stale/network），修复后与 audit 相关20项通过；既有 reload 失败用例也核对两份当前缓存来源一致。真实 OpenCode 脚本在既有 HTTP500→stale 阶段检查实际导出报告 source=stale。完整门禁及最新不可变候选的真实宿主结果以 PR #63 新 HEAD CI checks 与审查描述为准；冻结16项、variants、请求、快照策略和原 E2E 边界不变。

## Review 边界

PR #63交代码Review；不合并、不打tag、不发布。5.2/5.3等待归档及授权合并/finish，Core涉及宿主关闭任务不提前勾选。最终候选与CI看PR最新HEAD checks，不把历史候选等同后续提交。
