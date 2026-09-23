## 1. 宿主 spike（在真实 opencode v2 中验证 design 的前提）

> 所有真实环境验证（第 1 组、5.2、5.3）统一使用 `~/.agents/skills/opencode-litellm-config-sync/.env` 中的 `LITELLM_BASE_URL` 与 `LITELLM_API_KEY`：运行时读取，只在内存中使用，不写入仓库、fixtures、日志或 spike-notes；需要在 `/connect` 中填写时，由测试脚本或用户从该文件取值。
> spike 只验证宿主机制，每项最多发几条请求；不对发现到的模型逐个发请求。

- [ ] 1.1 **前置门槛（先做）**：验证协议包可加载与端点正确。用最小插件在同一 provider 下注册三个手写模型，`package` 分别为首选包 `openai-compatible`、`openai-compatible-responses`、`anthropic-compatible`，通过 `plugins: [{ package: "file://…" }]` 加载进打包后的 opencode 2.0.15，各发一条消息。确认：两个非内置包能被加载；请求分别打到 LiteLLM 的 `/v1/chat/completions`、`/v1/responses`、`/v1/messages`；LiteLLM 接受 Messages 协议的 `x-api-key` 头。不可加载时改用备选包 `openai/responses`、`anthropic` 重测，并记录请求体差异。验证：结论与最终选定的三个包写入 `docs/research/spike-notes.md`；若与 design D3 首选不同，同步修改 design.md 与 proposal.md；若 Messages 协议不可用，暂停并与用户确认后修改 specs/protocol-routing
- [ ] 1.2 在 1.1 的插件上验证连接：注册 integration `litellm-spike`（key 方式 + 表单字段 `url`），插件在 setup 中通过 `connection.active/resolve` 读到 Key 与 `url`；`apiKey` 由宿主注入；插件写在 provider 级的 `settings.baseURL` 不被覆盖；请求体中不出现 `url` 字段；表单填 `ftp://` 这类地址时宿主表单校验是否放行（决定插件侧 http/https 校验的必要性）。验证：观察结果写入 spike-notes
- [ ] 1.3 验证 `ProviderEditor.add` 整体替换：连续两次 transform 用 `add` 写入不同的模型集合，确认旧模型消失；确认宿主对 `add` 传入的完整 `Model.Info`（`time`、`cost[]`、`status`、`enabled` 等）的校验行为与失败表现。验证：写入 spike-notes
- [ ] 1.4 验证推理档位选项键：Chat / Responses 各用 `Variant.settings = { reasoningEffort }`、Messages 用 `{ effort }` 与 `{ thinking: { type: "enabled", budgetTokens } }` 各发一条请求，抓包确认请求体中分别出现 `reasoning_effort`、`reasoning.effort`、`output_config.effort` 与 `thinking.budget_tokens`，并确认 LiteLLM 接受。验证：最终确定的键写入 spike-notes；与 design D4 不一致时同步修改 design.md
- [ ] 1.5 验证连接变更感知：通过 `ctx.event.subscribe()` 收到 `credential.switched` / `credential.updated`，记录事件到达与 `connection.active` 更新的先后顺序；确认 `sourceConnection` 在换 Key 与断开连接后隐藏旧模型。验证：写入 spike-notes

## 2. 测试样本与配置

- [ ] 2.1 编写 fixture 生成脚本 `scripts/make-fixtures.ts`：从实测 `/v1/model/info` 响应中**按白名单**只保留插件读取的字段（`model_name`、`litellm_params.model`、`litellm_params.custom_llm_provider`，以及 `model_info` 中的 `mode`、`base_model`、`litellm_provider`、`models_dev_provider`、`supported_endpoints`、`max_*`、`supports_*`、`*_cost_*`、`tiered_pricing`），把 `model_name` 以外的标识替换为占位值，输出到 `test/fixtures/`。样本覆盖 chat / responses / embedding / image_generation、272k 与 512k 阶梯、db 部署（无路由前缀，带 `custom_llm_provider`）；另手写补充 Anthropic 部署、Bedrock 上的 Claude、带 `supported_endpoints` 的部署、`tiered_pricing` 部署、mode 缺失的图像模型、同名多部署、字段类型异常的部署。验证：测试断言 fixtures 中不存在 `api_base`、`litellm_credential_name`、`tags`、`access_via_team_ids`、`access_groups`、`id`、`api_key` 键，且不含形如 `sk-` 的字符串
- [ ] 2.2 在 `test/fixtures/` 中加入精简的 models.dev 样本：openai、anthropic、zai、zhipuai、moonshotai、moonshotai-cn、minimax（含 `MiniMax-M3` 大写 id）、xiaomi、alibaba、opencode 等相关条目，包含 effort / toggle / budget_tokens（有 max 与无 max）三类 `reasoning_options`、`release_date`，以及一个多个转售商共有的 id。验证：文件可解析，且测试中引用到
- [ ] 2.3 实现 `src/options.ts`：解析轮询间隔（下限 30s）、阶梯截断开关、协议覆盖；非法项回退默认值并给出 warn。验证：`test/options.test.ts` 覆盖默认值、下限钳制、非法值回退
- [ ] 2.4 把 `package.json` 的 `peerDependencies["@opencode/plugin"]` 改为 `>=2.0.15 <2.1`，删除非标准的 `engines.opencode` 字段。验证：`npm install` 通过且 `package.json` 中版本范围与 design 一致

## 3. 发现核心（纯函数，不依赖宿主）

- [ ] 3.1 实现 `core/litellm.ts`：地址规范化（`/v1`、末尾斜杠、仅允许 http/https）、部署按 `model_name` 聚合、过滤非对话 mode、mode 缺失时按名字排除图像模型、异常字段按“未提供”处理。验证：单测覆盖 spec“地址规范化”“非 http(s) 地址”“以真实部署作为模型清单”“只注册对话模型”“空结果与异常数据”的场景
- [ ] 3.2 实现 `core/protocol.ts`：按判定顺序输出协议，包括 Anthropic 上游与 Claude 家族、多协议时 responses 优先、`supported_endpoints` 优先于 `mode`、无效声明被忽略、多部署不一致时回退 chat、用户覆盖；协议到包名的映射表集中在此。验证：单测逐条覆盖 specs/protocol-routing 的全部场景
- [ ] 3.3 实现 `core/capabilities.ts`：能力、模态、上限、价格映射（每 token → 每百万 token），null 回退规则，模态信任名单，多部署保守合并，阶梯截断（`*_above_Nk_tokens` 与 `tiered_pricing`，可关闭）。验证：单测覆盖“多部署模型的能力合并”“能力字段映射”“按价格阶梯截断上下文”“显示名与价格”的场景，其中 fixtures 中的 gpt 系列截断为 272000、minimax-m3 截断为 512000
- [ ] 3.4 实现 `core/modelsdev.ts`：家族 → 原厂及备选识别、`models_dev_provider` 覆盖、候选 id 顺序与大小写不敏感匹配、记录选择（原厂 / 备选 → opencode → 唯一 provider，禁止模糊匹配）、variants 生成（effort / budget_tokens / toggle，按协议写入 D4 的选项键）、`release_date`。验证：单测覆盖 spec“models.dev 记录选择”“推理档位来源”的全部场景
- [ ] 3.5 实现 `core/build.ts`：组合为 `ModelSpec[]`，输出稳定排序，并提供稳定序列化的指纹函数。验证：基于完整 fixtures 的快照测试；相同输入的指纹相同，改动任一字段则指纹变化

## 4. 网络与宿主适配

- [ ] 4.1 实现 `net/fetch.ts`：带超时的 GET（LiteLLM 15s、models.dev 60s），不跟随重定向，把错误分类为 network / auth / notfound / ratelimit / server / parse / redirect，统一脱敏（Key → `sk-***`），不记录响应体；`/v1/model/info` 返回 404 时回退 `/model/info`。验证：单测用 mock fetch 覆盖各分类与 404 回退，并断言错误信息与日志中不含 Key 明文和响应体
- [ ] 4.2 实现 models.dev 进程内共享缓存（6 小时有效，失败后 60 秒退避）。验证：单测覆盖缓存命中、失败降级（返回空目录，不抛错）、退避期内不重复请求
- [ ] 4.3 实现 `host/register.ts`：integration 注册（key 方式 + 必填 `url` 字段），以及 `ModelSpec[]` → `ProviderEditor.add` 整体写入（`integrationID`、`sourceConnection`、provider 级 `settings.baseURL`、模型级 `package`、以 `Model.Info.default` 为底合成完整 `Model.Info`）；无连接或首次发现未成功时不写入。验证：用手写的 fake `ProviderEditor` / `IntegrationEditor` 做单测，断言写入字段完整、未写入 Key、旧模型在下一次 `add` 后消失
- [ ] 4.4 实现 `host/sync.ts`：发现循环，包括启动发现、轮询、订阅 `credential.switched` / `credential.updated` 并用 `connection.active` 复核、并发合并、指纹比较后才 reload、失败分类处理（保留 / 清空 / 空清单）。验证：用 fake 时钟 + fake ctx 做单测，覆盖 specs/change-sync 与 litellm-connection 中“切换连接”“断开连接”的场景
- [ ] 4.5 实现 `src/index.ts`：读取 options，启动发现循环，setup 返回的 cleanup 负责停止轮询、取消事件订阅、释放注册。验证：单测断言 cleanup 后不再发起请求

## 5. 集成验证与文档

- [ ] 5.1 `bun run typecheck && bun test && bun run build` 全部通过。验证：命令输出
- [ ] 5.2 在真实 opencode 2.0.15 中加载构建产物，连接一个真实的 LiteLLM：模型列表与 `/v1/model/info` 中的对话模型一致；chat、responses 协议各发一条消息成功；带档位的模型能切换档位；阶梯截断后的上下文在模型信息中可见。验证：结果记录到 `docs/research/spike-notes.md`
- [ ] 5.3 在真实环境中验证变更同步：临时调短轮询间隔，由 LiteLLM 管理员新增、删除一个模型后，模型选择器在一个间隔内更新；断开网络时模型保留；换成无效 Key 后模型消失。验证：记录到 spike-notes
- [ ] 5.4 更新 README：安装方式、连接步骤、插件配置项说明（含 `protocolOverrides` 用法）、从 `opencode-litellm-config-sync` 迁移的步骤。验证：README 包含以上各节
