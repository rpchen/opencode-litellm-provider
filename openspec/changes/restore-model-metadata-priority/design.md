# Design

## Context

基线f3447a3c2187e3cc3c90d1d76b0b28a7c5d79e03 / 插件0.10.0，编入Core a13f16fd983478572502f3896fd5509978027261。Core同名change的audit.md为三仓库审计，design.md D1–D8为元数据语义，test-matrix.md为逐模型/通用/E2E验收。这里仅定义OpenCode边界。

## Goals / Non-Goals

**Goals:** 准确消费Core到Model.Info、variant settings、最终请求和诊断/TUI。
**Non-Goals:** 本地复制resolver、owner表、price规则；新增运行时Core下载或平级依赖；本阶段修改业务与dist。

## Decisions

buildPublicationModels只映射Core publishable；toModelInfo覆盖Model.Info.default中的所有受管capabilities/limits/variants/cost，禁止宿主默认填上未知能力或extra variants。tools=false是完整事实；reasoning支持与variants分别留在Core/审计，不因空variants改为不支持。SDK无独立reasoning位时不造宿主字段。

Chat/Responses用现有OpenAI兼容SDK与路径，Messages用现有Anthropic SDK；Core protocol与variant.settings直接映射。保留model_name为id/modelID/name。通过真实模型初始化、picker和每档请求证明这些配置实际生效，不能靠as unknown as Model.Info或仅列表可见验收。当前源码无法证明OpenCode宿主不再合并默认variants，这属于T33必测边界。

ProviderSnapshot、registrationView、audit、RPC和TUI使用同一捕获结果。用户默认只看发现/已配置/暂不可用、来源、推理支持/档位、实际缺失原因；保留runtime identity和endpoint状态。主动导出追加allowlist的canonical和公开record来源；不泄露真实routes/地址/credentials。对话反馈开关及卡片行为不改。

网络刷新、5分钟默认轮询、Core30秒freshness/force、models.dev6小时TTL维持；LiteLLM瞬时失败保留合法结果，auth/连接切换清除，成功空目录撤下。catalog失败完全消费Core LKG/完整LL/withheld，不另建fallback。durable storage接受Corepublication9/snapshot2；旧schema需成功刷新，不回放错误旧能力。cost损坏归零，价格不影响快照有效性；contextTierCap废弃接受但忽略。

| 与旧规范/fixture差异 | 理由 |
|---|---|
| LL优先、family/unique provider→Core固定三层来源 | 用户明确纠正来源权威 |
| schema8proof、unproven无档位→自动同身份元数据 | 无需实际serving provider证明 |
| tools默认/参数交集→明确Core事实 | unknown不能伪造支持 |
| 价格阶梯与LL价优先→参考价独立 | 价格不影响能力/发布/LKG |
| 旧兼容快照→逐模型公开oracle | 不能把旧错误当永久兼容义务 |

## Risks / Trade-offs

支持区间沿用>=2.0.15 <2.1，固定真实2.0.16验收。integration/provider transforms、Model.Info、commands/RPC/TUI使用experimental宿主接口，需要真实installer与初始化测试；不增加运行时依赖。旧schema离线暂不能恢复，下一次成功刷新重建。真实16名称来自Pi，OpenCode的对应目录必须用相同合成输入以及后续脱敏真实发现独立核验，不声称已读取用户OpenCode配置。

## Migration Plan

设计可与Core同时评审；实施遵守Core→Pi→OpenCode。Core获准合入后一次build:dist固定其完整SHA，生成dist/provenance；verify:dist仅按候选SHA在隔离目录重建，不能覆写候选或跟随新main；脏缓存拒绝，不reset/clean。安装不得依赖lifecycle脚本、缓存、平级目录或运行时下载。

按Core T33的真实OpenCode2.0.16门禁，以自己的installer安装不可变candidate，隔离HOME/XDG、两本地fake endpoints、真实credential isolation；检查16模型Model.Info、picker和逐档请求，以及Chat/Responses/Messages、catalog/price失败、恢复/重启/删除/auth和RPC/TUI一致性。执行verify:dist、test:delivery、typecheck、test、test:tui-render、test:distribution、test:package、strict/closure、test:release-metadata。同步README/context/ADR；完整Scenario证据之后才archive新change。不改历史archive、不自动合并发布。回滚旧固定插件tag并保留用户配置。
