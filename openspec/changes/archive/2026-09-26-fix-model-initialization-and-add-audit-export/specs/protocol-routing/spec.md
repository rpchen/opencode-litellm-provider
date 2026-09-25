## ADDED Requirements

### Requirement: 已安装插件的模型初始化与调用
插件 SHALL 在受支持的 OpenCode v2 宿主中，从公开 Git package 安装并连接 LiteLLM 后，使其已注册的模型可初始化并按该模型选定的 Chat、Responses 或 Messages 协议发起调用；模型级与 provider 级所引用的 SDK package MUST 能在实际模型初始化的运行时解析。模型仅在选择器中可见、插件可导入或审查报告成功导出，均不足以视为满足此要求。

#### Scenario: 用户报告的 Responses 模型
- **WHEN** 在用户当前 OpenCode v2 宿主安装 Git package、连接有效 LiteLLM，并选择 `litellm/deepseek-v4.1-flash` 发送一条消息，且该模型被判定为 Responses
- **THEN** 初始化不出现 `Cannot find package '@opencode/ai'`，请求经 LiteLLM Responses 端点发出，且用户收到成功的模型回复

#### Scenario: 其他已部署协议
- **WHEN** LiteLLM 存在已发现且可调用的 Chat 或 Messages 模型，用户选择其代表模型发送消息
- **THEN** 初始化可解析该协议对应的宿主内置 SDK package，请求按“调用端点”要求送往相应 LiteLLM 端点并成功返回

#### Scenario: 推理档位不回归
- **WHEN** 用户选择某已注册模型的推理 variant 并发送消息
- **THEN** 插件保留该 variant 的实际调用设置，模型初始化和调用不因修复 package 解析而失败
