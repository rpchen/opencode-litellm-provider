# 修复 OpenCode 2.0.16 integration schema 并建立真实宿主 E2E

## Why

v0.4.1 在真实 OpenCode 2.0.16 中为固定 baseUrl endpoint 注册了 `form: []`。OpenCode 2.0.16 的 `Integration.KeyMethod.form` 是可选的非空字段数组（NonEmptyArray）；空数组会导致 `Integration.Info` Schema validation failed，继而使 `opencode.config.provider` 失败、`/connect` 看不到 LiteLLM、`/models` 没有 LiteLLM 模型。

此前模拟 host context 与 package probe 未经过真实 OpenCode 运行时 schema，因此没有捕获该问题。

## What Changes

- 固定 baseUrl endpoint 的 key auth method 省略 `form`，不再输出非法 `form: []`。
- integration editor 类型直接从 `Plugin.Context.integration.transform` 推导，减少本地影子类型漂移。
- CI 永久安装并运行真实 `@opencode/cli@2.0.16`。
- 真实 E2E 使用固定 Git commit spec，通过 OpenCode 自己的 `plugin add` 安装当前交付物。
- E2E 使用两个隔离 fake LiteLLM endpoint，分别验证 integration、credential、provider、model 与 command registry。
- 真实 E2E 不读取用户配置、真实 LiteLLM 地址或真实 API Key。

## User impact

修复后，显式多 endpoint 用户应能在 `/connect` 中看到 `LiteLLM` / `LiteLLM · <id>`，分别保存 API Key，并在 `/models` 中看到对应 provider namespace 的模型。