## Purpose

定义发现结果何时刷新、如何判断 LiteLLM 端发生了变化、网络失败时如何降级，确保 OpenCode 中的模型清单自动跟随 LiteLLM 端变更，同时不因短暂故障丢失可用模型。

## ADDED Requirements

### Requirement: 刷新触发
插件 SHALL 在已连接 LiteLLM 时于以下时机执行发现：插件启动时；连接被创建、替换或激活时（立即执行）；此后按轮询间隔周期执行。轮询间隔 SHALL 默认 5 分钟，可通过插件配置调整，最小 30 秒。

#### Scenario: 管理员新增模型
- **WHEN** LiteLLM 管理员新增一个对话模型部署，且用户的 Key 有权访问
- **THEN** 在一个轮询间隔内，该模型出现在 OpenCode 模型选择器中，无需重启 OpenCode

#### Scenario: 管理员删除模型
- **WHEN** LiteLLM 管理员删除某模型的全部部署
- **THEN** 在一个轮询间隔内，该模型从模型选择器中消失

### Requirement: 仅在内容变化时重载
插件 SHALL 比较本次与上次成功发现的注册结果；结果一致时 MUST NOT 触发宿主的 provider 重载。

#### Scenario: 无变化的轮询
- **WHEN** 连续两次轮询返回的模型与元数据完全一致
- **THEN** 第二次轮询不触发 provider 重载

### Requirement: LiteLLM 不可达时保留上次结果
发现请求失败（网络错误、超时、429、5xx、响应无法解析）时，插件 SHALL 保留上次成功的注册结果，并在下一个轮询周期重试；插件 SHALL 记录一条警告（不含 Key）。

#### Scenario: 短暂网络中断
- **WHEN** 已注册 10 个模型后，下一次轮询请求超时
- **THEN** 10 个模型仍然可用，下个周期继续尝试

### Requirement: 认证失败时撤下模型
发现请求返回 401 或 403 时，插件 SHALL 撤下全部 LiteLLM 模型，并记录明确指出 Key 无效或无权限的错误。

#### Scenario: Key 被吊销
- **WHEN** 用户的 Key 在 LiteLLM 端被删除，下一次轮询返回 401
- **THEN** LiteLLM 模型从模型选择器中消失，日志提示 Key 无效

### Requirement: models.dev 不可达时的降级
models.dev 获取失败时，插件 SHALL 继续仅用 LiteLLM 数据注册模型（不生成推理档位、不补充缺失字段），并在后续刷新中重试获取 models.dev；models.dev 的成功结果 SHALL 被缓存，缓存有效期内不重复请求。

#### Scenario: models.dev 超时
- **WHEN** 首次发现时 models.dev 请求超时，LiteLLM 正常
- **THEN** 模型按 LiteLLM 数据注册且没有推理档位；之后某次刷新成功获取 models.dev 后，推理档位出现

### Requirement: 首次发现完成前的状态
已连接但首次发现尚未成功时，插件 SHALL 不注册任何模型，也 MUST NOT 注册占位模型。

#### Scenario: 启动时 LiteLLM 不可达
- **WHEN** OpenCode 启动时 LiteLLM 不可达且此前没有成功结果
- **THEN** LiteLLM 暂无模型；LiteLLM 恢复后的下一次轮询注册模型
