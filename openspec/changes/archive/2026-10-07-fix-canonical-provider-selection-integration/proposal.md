# Consume Canonical Provider Selection Precedence Fix

## Why

Core 仓库 `litellm-discovery-core` 的 OpenSpec change `fix-canonical-provider-selection-precedence`（Core PR #29 + rule-B 补全 #30，Core main SHA `f07951d7ac85f756bba8cfa64fa5215de0dad664`）修复通用 canonical provider selection：真实回归中 `deepseek-v4.1-flash` 的官方 provider 记录（serving-SKU id + `canonical_model_id` 关系指向 canonical identity）未被识别为 canonical-original，fallback 落到 OpenRouter（943718 reseller serving limit）且被当成 authoritative intrinsic 发布。两个 adapter 都忠实映射 `spec.limit`，因此 OpenCode 宿主同样会暴露错误的 output limit。

Provider selection precedence 修正为：explicit provider proof > canonical-original > OpenCode > OpenRouter > unique trusted match > ambiguous；fallback record（reseller serving metadata）只补缺、不再作为 authoritative intrinsic 事实，与 LiteLLM 描述性声明同级冲突时 withheld。

OpenCode 的职责边界不变：`toOpenCodeModelSpec`/`toModelInfo` 忠实透传 Core spec。本仓库需要拉取修复后的 Core SHA（`build:dist`），并提供「Core publication → OpenCode model config」的 DeepSeek 等价 integration regression，证明最终宿主 model 的 output limit 正确。

## What Changes

- 通过 `build:dist` 把 `dist/` 更新到修复后的 Core SHA（同一解析 SHA 全程复用；更新 `dist/core-provenance.json` 与 runtime identity digest）。
- 新增 integration regression：真实 DeepSeek 形态 → Core `buildPublicationModels` → OpenCode `toOpenCodeModelSpecWithPublication`:
  - canonical identity = `deepseek/deepseek-v4.1-flash`（deployment 声明不被 fallback 改写）、selected provider = `deepseek`、selectionSource = `canonical-original`；
  - 最终 OpenCode model `limit.output = 393216`、`limit.context = 1000000`；强负断言 `!= 943718`；
  - OpenRouter-only fallback 与 endpoint 声明冲突 → 模型 withheld、注册列表不含该模型；
  - OpenCode fallback 先于 OpenRouter；spec id 不被 fallback 改写。
- 不改变 OpenCode 其余行为；Real OpenCode 2.0.16 E2E 继续作为宿主契约门禁。

## Impact

- 关联 change：`litellm-discovery-core` `fix-canonical-provider-selection-precedence`（PR #29 先合入 main）；Pi 仓库对应集成 change。
- Affected specs: `discovery-quality-integration`（MODIFIED）、`publication`（MODIFIED）
- Affected code: 仅 `dist/` 与测试；OpenCode 业务源码 `src/` 零改动。