# 方案决策记录

记录 `add-litellm-auto-discovery` 方案讨论中由用户拍板的决策与背景（2026-09-23 ~ 09-24）。规格本身以 `openspec/changes/add-litellm-auto-discovery/` 为准；本文件说明“为什么这样定”，供实施时参考，避免重新讨论。

## 已确认的决策

| 主题 | 决策 | 背景 / 理由 |
|---|---|---|
| 接入方式 | 用户通过 `/connect` 填写自己的地址与 Key；插件不内置任何地址；只有一个 `litellm` provider，**不做多实例** | 插件是通用的，不绑定任何特定 LiteLLM 服务 |
| 发现所用的 Key | 用用户自己的 Key 调 `/v1/model/info` | 不同 Key 可见的模型不同；用用户 Key 才能保证列出的都能调用 |
| 模型清单来源 | 只取 `/v1/model/info` 中的真实部署；没有元数据的名字不注册 | `/v1/models`、`/model_group/info` 会列出团队白名单里已删除部署的残留名字（实测 `gpt-5.5`、`gpt-5.3-codex-spark`） |
| 协议判定 | 用户覆盖 → Anthropic 上游 / Claude 家族走 Messages → `supported_endpoints`（多个时 responses 优先）→ `mode: responses` → 其余 Chat；`supported_endpoints` 与 `mode` 冲突时以前者为准 | `supported_endpoints` 是 LiteLLM 官方的端点能力字段 |
| 不做协议探测 | **不对模型发试探请求**，只按规则判定；判错时用 `protocolOverrides` 兜底 | 选对协议只是为了尽量原样透传；LiteLLM 会做协议转换，选得不理想也能调用。逐个探测速度不可接受 |
| 推理档位 | 以 models.dev 为准：原厂记录（含 `-cn` 等备选）→ OpenCode Zen（`opencode`）→ 唯一 provider；不使用 LiteLLM 的 `supports_*_reasoning_effort` | |
| budget 类档位 | 有最大预算时生成 `high`（min(16000, max)）与 `max`；**models.dev 没写上限时也生成 `high` = 16000** | 与旧脚本不同（旧脚本没写上限时不生成）；目前 models.dev 的 Claude 都写了上限，实际不触发 |
| 上下文窗口 | 按 LiteLLM 阶梯价字段（`*_above_<N>k_tokens`、`tiered_pricing`）截断到首个阶梯点，默认开启、可关闭；**不读 Codex `models_cache.json`** | 目的是不越过价格阶梯（如 GPT 超过 272K 价格大涨） |
| 基线规则 | 保留模态信任名单（DeepSeek/Kimi/MiMo/Qwen）、完整家族表与 `-cn` 备选、`models_dev_provider` 覆盖、mode 缺失时按名字排除图像模型 | 继承 `opencode-litellm-config-sync` 行为 |
| 显示名 | 原样使用 `model_name` | 与调用名一致 |
| 验证时机 | **不做前置 spike**；宿主相关假设（协议包能否加载、表单与地址投影、`add` 整体替换、档位参数、连接变更事件）全部在最后的验收阶段确认，不符时调整实现并更新 design | 用户现在手工配置的 litellm provider 已证明 OpenCode 能连 LiteLLM、档位能生效 |
| 真实环境测试凭据 | 使用 `~/.agents/skills/opencode-litellm-config-sync/.env` 的 `LITELLM_BASE_URL` / `LITELLM_API_KEY`，只在内存中使用 | 不读 `~/.config/opencode` 里用户自己的 Key |
| 发行渠道 | 不发布 npm；公开 GitHub 仓库，默认安装 `github:rpchen/opencode-litellm-provider` | OpenCode 明确支持 Git package；普通用户无需 registry 配置或 GitHub 凭据 |
| 稳定版本 | 无 ref 安装跟随默认分支 `main`；`main` 只接受通过 required CI 的 PR；`#vX.Y.Z` 用于锁定和回滚 | 同时兼顾最简安装和可复现部署 |
| 构建产物 | `dist` 随源码提交并由 CI clean build 后校验一致；不依赖 `prepare` | OpenCode 2.0.15 的 Git package 安装设置 `ignoreScripts: true` |
| GitHub 治理 | 仓库改为 Public；功能分支开发，GitHub 规则强制 PR、required `CI`、禁止 force-push/删除，管理员不绕过 | Public 既满足公众安装，也让 GitHub Free 可启用分支保护；单维护者 approval 设为 0 |
| Release | 首个版本 `v0.1.0`；tag 校验 package version 后创建 GitHub Release，附 `.tgz` 与 SHA-256，不 `npm publish` | tag 提供固定安装和回滚，附件便于审计与归档 |

## 独立审查

方案经过一次独立第三方对抗式审查，采纳了除“逐模型发 Responses 请求验证”以外的全部建议（该条与“不做协议探测”决策冲突，不采纳）。审查发现的已核实事实已写入 design.md 的 Context 部分。

## 给实施者的提示

- 按 `tasks.md` 顺序实施：测试样本 → 核心纯函数 → 网络与宿主适配 → 集成验收。
- `.tmp/` 下的临时调研文件（LiteLLM 实测抓取、上游源码快照、models.dev 快照）不入库、可能已被清理；需要时按 `docs/research/opencode-v2-plugin-api.md` 的来源重新获取。上游 v2 源码在 `anomalyco/opencode` 的 **`beta` 分支**（不是 `dev`）。
- 生成 fixtures 需要真实的 `/v1/model/info` 响应：用上述 `.env` 中的地址和 Key 抓取，按 tasks 1.1 的白名单脱敏后才能入库。
