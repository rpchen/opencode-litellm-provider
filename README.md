# opencode-litellm-provider

> 状态：初始化阶段（尚无功能），功能按 openspec 变更逐步交付。

OpenCode v2 插件：像配置其他 provider 一样，只需填写 **LiteLLM 地址** 和 **API Key**，即可自动：

- 发现应注册哪些 provider，以及每个 provider 使用的协议（OpenAI Chat Completions / OpenAI Responses / Anthropic Messages）
- 为每个 provider 注册模型，并填充能力参数（上下文 / 输出上限、模态、工具调用、推理）
- 生成可选的推理档位（variants）
- 跟随 LiteLLM 端的模型增删改自动刷新

目标是取代手工运行的 `opencode-litellm-config-sync` 脚本。

## 开发

```bash
bun install
bun run typecheck
bun test
bun run build
```

## 迭代方式

使用 [OpenSpec](https://github.com/Fission-AI/OpenSpec)：`openspec/changes/` 下是在途变更，`openspec/specs/` 是已落地的能力规格。
宿主接口调研见 `docs/research/opencode-v2-plugin-api.md`。
