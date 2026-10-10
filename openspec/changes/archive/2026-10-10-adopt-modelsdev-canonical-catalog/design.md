# Design: Adopt the models.dev Canonical Catalog (OpenCode adapter)

> 本 change 是 Core `adopt-modelsdev-canonical-catalog` 的下游适配；业务语义以
> Core 的 design/specs/acceptance 为准，这里只定 OpenCode 宿主边界。

## Context

- Core：`design/adopt-modelsdev-canonical-catalog` 分支（待合入 `main`）；
  OpenCode：`main@6c7818a0`（provenance Core `f07951d7`）。
- OpenCode 通过 `src/core/`（prepare-core 生成、gitignore）消费 Core 公共入口；
  `dist/` 为已提交产物；`modelsDevUrl` 允许自建镜像。

## Goals / Non-Goals

**Goals**

1. 生产默认拉取 `catalog.json`；`modelsDevUrl` 语义更新为 catalog 形状。
2. LKG seeding 走 schema 8 同 resolution 派生；旧条目 fail closed 后重捕获。
3. 诊断/TUI 呈现 Core 新事实；缺失时省略。
4. 用户可见变化进 README（含 `modelsDevUrl`）；纵向链路不断
   （Core → ProviderSnapshot → command/RPC → TUI）。

**Non-Goals**

- 不重测 Core 算法；不新增配置项；不改变 credential/integration、endpoint
  管理、refresh 语义；不在本 PR 重建 `dist`。

## Decisions

### D1 Fetch 与 modelsDevUrl

- `MODELS_DEV_URL = "https://models.dev/catalog.json"`；60 s 超时、6 h TTL、
  60 s retry、失败降级 `{}` 不变。
- `modelsDevUrl` 仍接受自定义 http(s) 镜像，但镜像必须为 catalog 形状；
  provider-only 镜像按 Core D2 fail closed（Pi 无此配置，无需对齐）；
  非法 URL 保持现有 warn+忽略（回退默认）。

### D2 LKG 接线

- `seedPublicationLKG(store, litellmResponse, catalog, options, publishable, now)`：
  逐 `configured` 调 `createLastKnownGoodEntry(group, selected, spec, now,
  captured, catalog, options)`；try/catch best-effort。
- 新 Core 下 capture 与 gate 同源；旧 Core 下多传参数被兼容接受。v7 内存条目
  在新 Core 下判不兼容。OpenCode 不持久化 LKG 条目（per-endpoint 内存 store）。

### D3 Diagnostics/TUI

- 诊断与 TUI 卡片新增（有则显示、无则省略）：`canonical <id>（<evidence>）`、
  `serving <status> [provider → record]`、`levels <unknown|known>`（unknown 附
  `models_dev_provider` 恢复提示）、`operator configuration：<keys>`、
  `candidates`、`catalog <kind>`；`serving-record-unresolved` /
  `declared-unmatched` 给出可操作修复行。

## Risks

- Core 未合入前 `dist` 仍是旧 Core：展示代码对缺失字段省略而非崩溃（新旧两种
  形状测试覆盖）。
- `catalog.json` 体积 +7.7%：超时/缓存不变，可接受。
- 真实宿主 E2E（Real OpenCode 2.0.16）本 PR 以旧 `dist` 验证宿主契约回归；
  新 `dist` 的 E2E 在重建后另行执行（BLOCKED）。

## Migration Plan

1. 本 PR：源码 + 测试 + README + OpenSpec（不碰 `dist/`）。
2. Core 合入 `main` 后：`build:dist` 取稳定 SHA → 全门禁复验 → 另起提交/PR
   （含 Real OpenCode E2E vs 新 dist）。
