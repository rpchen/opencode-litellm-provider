## 1. 宿主 spike（在真实 opencode v2 中验证 design 的前提）

> 所有真实环境验证（第 1 组、5.2、5.3）统一使用 `~/.agents/skills/opencode-litellm-config-sync/.env` 中的 `LITELLM_BASE_URL` 与 `LITELLM_API_KEY`：运行时读取，只在内存中使用，不写入仓库、fixtures、日志或 spike-notes；需要在 `/connect` 中填写时，由测试脚本或用户从该文件取值。

- [ ] 1.1 构建一个最小插件：注册 integration `litellm-spike`（key 方式 + 表单字段 `url`）与一个 provider，provider 下手写一个模型（`package = @opencode/ai/providers/openai-compatible`，`settings.baseURL` 由插件写入）。通过 `plugins: [{ package: "file://…" }]` 加载进 opencode 2.0.15，在连接界面填写地址与 Key 后，发送一条消息成功返回。验证：记录截图或日志到 `docs/research/spike-notes.md`
- [ ] 1.2 在 1.1 基础上验证：表单答案 `url` 不会覆盖 `settings.baseURL`；`apiKey` 由宿主注入；插件在 setup 中能通过 `connection.active/resolve` 读到 Key 与 `url`。验证：把观察结果写入 spike-notes
- [ ] 1.3 验证模型级 `package` 覆盖：同一 provider 下分别用 `openai-compatible-responses`、`anthropic-compatible` 各注册一个模型，确认请求分别打到 LiteLLM 的 `/v1/responses` 与 `/v1/messages`。验证：通过 LiteLLM 请求日志或抓包记录到 spike-notes
- [ ] 1.4 验证推理档位的选项名：Chat / Responses / Messages 各用一个档位发请求，确认请求体中出现 `reasoning_effort` / `reasoning.effort` / `effort` 或 `thinking.budget_tokens`。验证：把最终确定的选项名写入 spike-notes；如果与 design D4 不一致，同步修改 design.md
- [ ] 1.5 验证连接变更感知：确认 Promise API 能否订阅连接或凭据切换事件，以及 `sourceConnection` 能否在换 Key 后隐藏旧模型。验证：spike-notes 记录可用的事件名，或写明退化方案

## 2. 测试样本与配置

- [ ] 2.1 在 `test/fixtures/` 中加入脱敏的 LiteLLM `/v1/model/info` 样本：取自实测数据，Key、内网地址、团队 id 替换为占位值。覆盖 chat / responses / embedding / image_generation、272k 与 512k 阶梯、db 部署（无路由前缀，带 `custom_llm_provider`），并补充手写的 Anthropic 部署、带 `supported_endpoints` 的部署、同名多部署。验证：`grep -rE "sk-[A-Za-z0-9]{6,}|10\.[0-9]+\.|jusda" test/fixtures` 无输出
- [ ] 2.2 在 `test/fixtures/` 中加入精简的 models.dev 样本（openai、anthropic、zai、moonshotai、opencode 等相关条目，包含 effort / toggle / budget_tokens 三类 `reasoning_options`，以及一个多个转售商共有的 id）。验证：文件可解析，且测试中引用到
- [ ] 2.3 实现 `src/options.ts`：解析轮询间隔（下限 30s）、阶梯截断开关、协议覆盖；非法项回退默认值并给出 warn。验证：`test/options.test.ts` 覆盖默认值、下限钳制、非法值回退

## 3. 发现核心（纯函数，不依赖宿主）

- [ ] 3.1 实现 `core/litellm.ts`：地址规范化（`/v1`、末尾斜杠）、部署按 `model_name` 聚合、过滤非对话 mode。验证：单测覆盖 spec“地址规范化”“以真实部署作为模型清单”“只注册对话模型”的场景
- [ ] 3.2 实现 `core/protocol.ts`：按判定顺序输出协议，包括多协议时 responses 优先、`supported_endpoints` 优先于 `mode`、无效声明被忽略、多部署不一致时回退 chat、用户覆盖。验证：单测逐条覆盖 specs/protocol-routing 的全部场景
- [ ] 3.3 实现 `core/capabilities.ts`：能力、模态、上限、价格映射（每 token → 每百万 token），多部署保守合并，阶梯截断（可关闭）。验证：单测覆盖“多部署模型的能力合并”“能力字段映射”“按价格阶梯截断上下文”“显示名与价格”的场景，其中 fixtures 中的 gpt 系列截断为 272000、minimax-m3 截断为 512000
- [ ] 3.4 实现 `core/modelsdev.ts`：家族 → 原厂识别、记录选择（原厂 → opencode → 唯一 provider，禁止模糊匹配）、variants 生成（effort / budget_tokens / toggle，按协议写入字段）。验证：单测覆盖 spec“models.dev 记录选择”“推理档位来源”的全部场景
- [ ] 3.5 实现 `core/build.ts`：组合为 `ModelSpec[]`，输出稳定排序，并提供稳定序列化的指纹函数。验证：基于完整 fixtures 的快照测试；相同输入的指纹相同，改动任一字段则指纹变化

## 4. 网络与宿主适配

- [ ] 4.1 实现 `net/fetch.ts`：带超时的 GET，把错误分类为 network / auth / notfound / server / parse，并统一脱敏（Key → `sk-***`）。验证：单测用 mock fetch 覆盖各分类，并断言错误信息中不含 Key 明文
- [ ] 4.2 实现 models.dev 进程内共享缓存（6 小时有效，失败后 60 秒退避）。验证：单测覆盖缓存命中、失败降级（返回空目录，不抛错）、退避期内不重复请求
- [ ] 4.3 实现 `host/register.ts`：integration 注册（key 方式 + 必填 `url` 字段），以及 `ModelSpec[]` → provider / model 写入（`integrationID`、`sourceConnection`、模型级 `package`、`settings.baseURL`，并删除已不存在的模型）。验证：用手写的 fake `ProviderEditor` / `IntegrationEditor` 做单测，断言写入的字段与删除行为
- [ ] 4.4 实现 `host/sync.ts`：发现循环，包括启动发现、轮询、连接变更触发（按 1.5 的结论）、并发合并、指纹比较后才 reload、失败分类处理（保留 / 清空）。验证：用 fake 时钟 + fake ctx 做单测，覆盖 specs/change-sync 与 litellm-connection 中“切换连接”“断开连接”的场景
- [ ] 4.5 实现 `src/index.ts`：读取 options，启动发现循环，setup 返回的 cleanup 负责停止轮询、释放注册。验证：单测断言 cleanup 后不再发起请求

## 5. 集成验证与文档

- [ ] 5.1 `bun run typecheck && bun test && bun run build` 全部通过。验证：命令输出
- [ ] 5.2 在真实 opencode 2.0.15 中加载构建产物，连接一个真实的 LiteLLM：模型列表与 `/v1/model/info` 中的对话模型一致；chat、responses 协议各发一条消息成功；带档位的模型能切换档位；阶梯截断后的上下文在模型信息中可见。验证：结果记录到 `docs/research/spike-notes.md`
- [ ] 5.3 在真实环境中验证变更同步：临时调短轮询间隔，由 LiteLLM 管理员新增、删除一个模型后，模型选择器在一个间隔内更新；断开网络时模型保留；换成无效 Key 后模型消失。验证：记录到 spike-notes
- [ ] 5.4 更新 README：安装方式、连接步骤、插件配置项说明、从 `opencode-litellm-config-sync` 迁移的步骤。验证：README 包含以上各节
