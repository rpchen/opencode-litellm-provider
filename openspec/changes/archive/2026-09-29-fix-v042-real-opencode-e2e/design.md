# Design

## Root cause

OpenCode 2.0.16 runtime schema:

- `IntegrationKeyMethod.form?: Form.Fields`
- `Form.Fields = NonEmptyArray(Form.Field)`

v0.4.1 对已固定 `baseUrl` 的 endpoint 仍输出 `form: []`。TypeScript 没拦住它，是因为本仓库手写的 `IntegrationEditorLike` 把 `form` 声明成普通 `Array`，绕开了宿主真实类型。

## Fix

当 endpoint 有固定 `baseUrl`：

```ts
{
  type: "key",
  label: "API Key"
}
```

当 legacy endpoint 仍需要用户输入 URL：

```ts
{
  type: "key",
  label: "API Key",
  form: [/* exactly one non-empty URL field */]
}
```

`IntegrationEditorLike` 不再复制 method schema，而从 `Plugin.Context["integration"]["transform"]` 的 callback 参数推导。

## Real host E2E

CI 固定安装 `@opencode/cli@2.0.16`，并使用隔离 HOME/XDG 状态。测试：

1. 创建两个本地 HTTP fake LiteLLM endpoint，各自只接受自己的 Bearer Key。
2. 生成显式 `default` / `company` endpoint options。
3. 用 `opencode plugin add github:<repo>#<full-sha>` 预安装当前 Git 交付物。
4. 启动单一前台 `opencode serve`，所有后续 CLI/API 请求都显式连接该 server。
5. 等待 `litellm` plugin 进入 active/failed。
6. 验证真实 `integration.list` 中两个 LiteLLM integration 的 key method 不含空 form。
7. 通过真实 integration key API 分别写入两个 credential。
8. 验证每个 integration 有独立 connection。
9. reload 后等待两个 provider 可用，并要求两个 fake LiteLLM 都收到认证 discovery 请求。
10. 执行真实 `opencode models --server ...`，要求同时出现 `litellm/*` 和 `litellm-company/*`。
11. 通过真实 `command.list` 验证三个 LiteLLM 命令均已注册。

## Security

所有 key 均为测试假值；日志输出经过 secret scrub。测试不访问用户 HOME、不读取真实 LiteLLM 或用户 OpenCode 凭据。