# opencode-litellm-provider

> 状态：方案已定稿（openspec 变更 `add-litellm-auto-discovery`），待实施。

OpenCode v2 插件：用户通过 `/connect` 选择 LiteLLM，填写**自己的 LiteLLM 地址**和 **API Key**，插件即自动：

- 用这把 Key 从 LiteLLM 发现它实际可调用的对话模型，注册到 OpenCode 的 `LiteLLM` provider 下
- 为每个模型判定原生协议（OpenAI Chat Completions / OpenAI Responses / Anthropic Messages）
- 填充能力参数（上下文 / 输出上限、输入输出模态、工具调用、价格），并按阶梯价截断上下文窗口，避开高价区间
- 按 models.dev 生成可选的推理档位（variants）
- 定时刷新，跟随 LiteLLM 端的模型增删改

插件不内置任何 LiteLLM 地址，适用于任意 LiteLLM 部署。目标是取代手工运行的 `opencode-litellm-config-sync` 脚本。

## 开发

```bash
npm install          # 本项目 .npmrc 固定使用公网 npm registry
bun run typecheck
bun test
bun run build
```

## 迭代方式

使用 [OpenSpec](https://github.com/Fission-AI/OpenSpec)：`openspec/changes/` 下是在途变更，`openspec/specs/` 是已落地的能力规格。

- 在途变更：`openspec/changes/add-litellm-auto-discovery/`（proposal / specs / design / tasks）
- 宿主接口调研：`docs/research/opencode-v2-plugin-api.md`
- 方案讨论过程中的决策记录：`docs/decisions.md`
