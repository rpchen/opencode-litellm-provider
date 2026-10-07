# Require Real OpenCode E2E Merge Gate

## Why

OpenCode `Protect main` ruleset（ruleset id 23915941）此前只把 `CI` 作为 required status check，而完整 CI 里早已存在 `Real OpenCode 2.0.16 E2E` job。GitHub 的 required-check 合并门禁只看 ruleset 声明的 context，因此理论上 `CI` 成功而 Real OpenCode E2E 失败的 release PR 仍可能满足合并条件——真实 host 宿主契约门禁形同虚设，不满足共享 testing-standard「Real OpenCode host E2E 是 Host Adapter 的独立契约门禁」的合并前执行意图（release PR 必须在进入 main 之前通过真实 host E2E，而不是 tag 创建后才第一次运行）。

ruleset 属于仓库治理配置，不属于产品 specification；本 change 用独立 OpenSpec 立案（同一仓库治理 capability `release-governance`），与产品 bug 修复 change（`litellm-discovery-core` 的 `fix-canonical-provider-selection-precedence` 及两个 adapter 的集成 change）完全分离。

精确 required context 名称从真实 PR 的 GitHub Actions check runs 确认（不是从 workflow YAML 猜测）：PR #54–#58 的 check runs 均发布 `CI` 与 `Real OpenCode 2.0.16 E2E` 两个 context（app: github-actions）。

## What Changes

- `Protect main` ruleset 的 `required_status_checks` 从 `[CI]` 扩展为 `[CI, Real OpenCode 2.0.16 E2E]`（context 名取自真实 check run，严格策略保持）。
- 其余 ruleset 参数冻结不动：active enforcement、squash-only、无 bypass actor、review-thread resolution、deletion / non-fast-forward 保护。
- 新增治理漂移检查 `scripts/check-merge-gate.mjs`：向 GitHub ruleset API 读取当前 `Protect main`，断言 required checks 恰为 `{ CI, Real OpenCode 2.0.16 E2E }` 且其它保护不变量无漂移；未来 ruleset 被改回只有 `CI` 时 CI 直接变红。
- CI workflow 在发布敏感步骤之前执行该检查。
- 同类审计（本轮授权范围内）：Pi 仓库 ruleset id 24010848 存在完全相同的缺口（`Real Pi 0.87.1 E2E` 未 required），按同一治理标准修复为 `[CI, Real Pi 0.87.1 E2E]` 并加入等价 drift check `pi-litellm-provider/scripts/check-merge-gate.mjs`。

## Impact

- Affected specs: `release-governance`（MODIFIED）
- Affected code: `.github/workflows/ci.yml`（新增 drift check step）、`scripts/check-merge-gate.mjs`（新）。产品源码与 dist 不变。
- 不改变 release workflow 的职责边界：tag validation、package integrity、checksum、release publication 仍由 release workflow 负责；本 change 只加强 merge 前的 required gate。