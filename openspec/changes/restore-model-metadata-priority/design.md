# Design

## Context

续修现有Draft PR。Core同名change的D1–D8是共享语义：model_name唯一产品身份，官方 → OpenCode → OpenRouter整记录选择，选中记录价格或0。实际16名称与59条公开记录保持冻结；不要求读取真实内部路由。

## Goals / Non-Goals

准确把Core结果映射到OpenCode最终注册、picker、请求与诊断。不得在adapter复制匹配/价格算法，不新增字段补齐、身份或协议冲突阻断。本阶段仅设计，不修改源码、dist、用户配置或历史archive。

## Decisions

### 模型与推理映射

OpenCode保留Core tools、input/output与context/input/output；SDK默认值不得扩大能力。
原model_name保持ID、显示名与请求名。映射只消费Core一条记录的完整能力；不取其他provider或LL描述补字段。有限正context/output及既有模态边界继续校验；false、空数组与toggle不是缺失。

variants/settings直接映射Model.Info；支持推理与空variants分别处理。T33通过真实模型初始化、picker及请求确认不添加目录未声明档位，不能用类型强转或仅列表可见代替。
既有Messages控制及SDK协议映射保留，不新增budget推导或控制状态。Chat/Responses/Messages选择、默认行为、mixed-fallback和显式override均保持现状。

### 价格、缓存与诊断

cost只消费Core选中记录有效参考价或0；不补其他来源，价格不改限制、档位、发布或LKG。contextTierCap接受但忽略，实施时README说明。价格显示更新不等于模型能力退化。

保持已有网络刷新、缓存、retry、endpoint/credential/activation边界。消费Core简化LKG，不重复验证内部route/base_model/deployment ID；同model_name内部信息变化不使缓存失效。成功空清单、auth失败和模型删除按原有规则处理。价格坏值归零，关键内容完整性保留。publication9/snapshot2沿既有版本机制阻止旧空档位/价格cap回放，成功发现重建；不新增恢复体系。

默认诊断只呈现配置状态、选中元数据来源、推理支持/档位及实际错误，保留已有endpoint状态。主动audit沿现有allowlist展示公开record/canonical和最终注册值，不加多来源字段证明，不导出敏感原始信息。

## Evidence and retained boundaries

| 机制 | 实际依据 / 简单处理 |
|---|---|
| model_name与整记录 | 用户规则A–C；16条所选记录完整，删除拼字段与内部身份证明 |
| 精确推理映射 | 冻结记录逐模型values不同；现有Model.Info注册接口，以真实宿主测试确认 |
| 价格或0 | 用户规则E与已观察272k截断；彻底移除价格能力耦合 |
| 缓存scope/关键完整性/版本 | 既有隔离机制及旧快照已含错误配置；复用入口，不增加proof |
| 协议与交付 | 用户规则F及现有AGENTS：保持原算法，保留真实宿主、固定Core SHA门禁 |

这些是已确认要求或接口事实，未新增假想冲突和恢复场景。不声称已读取用户OpenCode的模型目录；相同16名称输入经真实OpenCode独立验收。

## Migration Plan

Review后才实施；Core获准合入后，Pi再OpenCode使用同一稳定Core SHA更新dist/provenance。按Core T01–T34（T05/T06撤回）执行适用矩阵与真实OpenCode门禁，保留安装、隔离、SDK初始化、picker/请求、缓存和UI纵向证据。合成fixture不等于真实宿主E2E，也不需要真实服务商证明。

同步README/context/ADR与相关canonical规则须在实施阶段完成。完整Scenario证据后才按CLI归档本change；本轮不合并、归档或发布。
