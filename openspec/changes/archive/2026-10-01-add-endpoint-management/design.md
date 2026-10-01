## Context

OpenCode 2.0.16 状态分布（已核对类型与运行行为）：

| 状态 | 位置 | 所有者 |
|---|---|---|
| endpoint 定义（canonical） | 声明本插件的配置文件里 `plugins[].options.endpoints`（JSONC，`OPENCODE_CONFIG` 或全局 `opencode.jsonc`） | 用户 + 本插件 |
| legacy 单 endpoint 地址 | `/connect` 时保存在宿主凭据的 `configuration.url` | 宿主 |
| activation | 宿主 plugin storage `litellm.activation.v1` | 本插件 |
| 凭据 | 宿主 credential store；integration id `litellm` / `litellm-<id>` | OpenCode（`/connect`） |
| discovery snapshot | plugin storage `litellm.discovery.snapshot.v1[.<id>]` | 本插件 |
| backoff / coordinator | 进程内存 | 本插件 |

OpenCode V2 server 插件没有配置写入 API（`config.update` 只支持 `shell`），没有运行期 child-plugin 变更；`context.options` 只在 setup 时给出。TUI 的 `client` 暴露 `integration.connect.key`、`credential.{update,activate,remove}`；server 插件 context 没有凭据删除接口。

## Decisions

### D1 交互：TUI 原生对话框
`/litellm-endpoints` 触发 TUI（沿用 PR9 的 `shown` 事件 + `state` 轮询恢复）打开 `dialog.select` 主列表（新增 / 全部启用 / 全部停用 / 每个 endpoint）→ endpoint 详情 `select`（启用|停用 / 修改 Base URL / 连接|替换 API Key / 断开凭据 / 删除 / 返回）；输入用 `dialog.prompt`，确认用 `dialog.confirm`。这些全是宿主原生可键盘/鼠标操作的对话框。桌面/Web 不加载 TUI 插件，管理 UI 仍是 TUI-only（README 说明，与 PR9 一致）。

### D2 写配置：jsonc-parser 最小编辑
配置是 JSONC（README 示例带注释），JSON.stringify 会丢注释与格式。使用 `jsonc-parser`（`modify` + `applyEdits`）只改目标路径：新增 `options.endpoints.<id>`、改 `…<id>.baseUrl`、删 `…<id>`。其它文本逐字节保留（测试断言“仅一个 URL 字面量变化”）。新增运行时依赖 `jsonc-parser@3.3.1`：MIT、零依赖、Microsoft 维护；自己写 JSONC 编辑器风险更高。写入前解析校验，读-改-写之间做内容比对（冲突检测），临时文件 + `rename` 原子替换并保留文件权限位。

### D3 定位配置文件与“被遮蔽”保护
候选：`OPENCODE_CONFIG` → `$XDG_CONFIG_HOME/opencode/opencode.{jsonc,json}` → `~/.config/opencode/…`；取第一个含本插件条目的文件（用 `plugin.list()` 给出的 source 与包名匹配）。启动后首次比较“文件里解析出的 options”与 `context.options`：不一致（内联配置、项目配置胜出）→ **只读**，Add/Edit/Delete 拒绝并说明；activation 与凭据不受影响。一致后，文件视为 canonical，之后手改会在下次打开时被同步（rebuild）。

### D4 Supervisor：endpoint 集合变化 → 重建 runtime
audit/diagnostics/integration/provider 注册都按静态 id 列表创建。为避免改动这些已验证代码，`setupLiteLLM` 改成 supervisor：常驻 `/litellm-endpoints` 命令 + RPC（`endpointIds` 改为惰性读取），endpoint 集合变化时 `dispose` 当前 runtime 再按新 options `buildRuntime`（legacy / explicit 两种 builder 逻辑不变）；重建失败回滚到上一份 options。代价：每次 Add/Edit/Delete 会让所有 provider 短暂重新注册（discovery 有 snapshot 恢复）；换来注册逻辑零分叉。

### D5 凭据：TUI 经宿主 client 操作
Connect/Replace = `integration.connect.key` 后对新凭据 `credential.activate`，并移除此前已有的 credential（overwrite 语义）；Disconnect = 移除该 integration 下所有 `type:"credential"` 连接，env 连接只显示不删除。API Key 不经插件 RPC、不进日志/toast；失败信息里会把 key 字面量替换为 `***`。

**表单校验（review 修正）**：legacy integration 的 key method 带必填 `url` form，OpenCode 会在认证前校验 form；漏传 `answer.url` 会被宿主拒绝。`saveKey` 先读取该 integration 的 key method：有 `url` 表单时必须带上 `answer: { url }`（地址来自 endpoint 定义/迁移），拿不到地址时直接拒绝并提示，绝不发送不完整的 connect。

### D6 activation 与 Add / Delete
- Add：新 endpoint 必须 inactive。先把当前已激活集合物化为 `selected`（排除新 id）再写配置。**物化只针对真实存在的 configured/managed endpoint 定义**（review 2 修正）：explicit 模式取 `Object.keys(options.endpoints)`；legacy 有已连接地址取 `["default"]`；legacy 无地址取 `[]`——runtime 内部 legacy id（永远是 `["default"]`）不得写进 activation，否则 ghostless 首次 Add 会留下 stale `default` 激活，日后手工加入 `endpoints.default` 会被自动启用。取舍：此后手工新增的 endpoint 不会自动激活。**Add 失败必须回滚 activation**（review 修正）：记录 previous activation，写配置失败（conflict / 写失败 / 外部并发修改）时 best-effort 恢复 previous 并 reconcile runtime；回滚自身失败时不吞掉，primary + rollback 错误一并报告。
  - **rollback 只发生在配置写入 commit 之前**（review 2 修正）：配置已成功写入、但随后 rebuild 失败时，**保留物化后的 `selected`**（绝不恢复 `all`，否则新 endpoint 下次 rebuild 会被自动激活），新 endpoint 保持 inactive，结果用 `saved: true` + `code: "rebuild-failed"` 明确报告“配置已保存、运行时重新加载失败”，TUI 用 warning（而非 error）展示。
- Delete（先清理、最后删定义，可重试）：**最终 Delete 确认必须发生在任何 migration/cleanup 之前**（review 2 修正）——legacy default 的删除用一条合并确认（说明确认后先内部迁移再立即删除），Cancel = 不调用 `rpc.migrate` / `prepareRemove` / `remove` / credential 移除。确认后：RPC `prepareRemove`（取消激活、reconcile 停掉该 endpoint 的 loop/provider、删除 snapshot 存储）→ TUI 移除该 endpoint 所有 credential → RPC `remove`（改配置、rebuild、从 activation 剔除、再次清 snapshot）。任一步失败，定义仍在。

### D7 legacy 单 endpoint（review 修正）
legacy 模式下 `default` 的地址在 `/connect` 凭据里，不在配置文件。**不做产品例外**：详情页对 legacy default 同样提供 Edit / Delete / Connect / Replace。Edit / Connect / Replace 第一次执行时先提示迁移——把凭据里的地址与顶层 `protocolOverrides` 写入 `options.endpoints.default`（endpoint id、integration id、已保存 credential、activation 全部不变；旧 legacy snapshot key 清除，因为 fingerprint 身份变化会重新发现），随后动作照常执行；**Delete 不单独提示迁移**（review 2 修正）：最终 Delete 确认合并说明迁移+删除，Confirm 后先迁移再删除，Cancel 不留任何迁移副作用。若 legacy 模式下没有已连接的地址，则不存在可管理的 `default`：列表不显示幽灵行，用户直接 Add。

迁移与“新增第二个 endpoint 时的迁移”共用同一写入路径（`kind: "migrate"` / add 的 `migrateLegacy`），单次原子写入，失败不留半份配置。

### D8 E2E 环境
真实 OpenCode TUI 需要 PTY：CI 在 Ubuntu，本地在 WSL 里跑；本地 E2E 使用仅含配置文件（不设 `OPENCODE_CONFIG_CONTENT`）的隔离 HOME/XDG，使配置文件是 options 的唯一来源。

## Differences vs baseline
| 差异 | 理由 |
|---|---|
| 主列表选中 endpoint 进入详情而非直接 toggle | D1 |
| 通过 UI 新增后 activation 由 `all` 变为 `selected` | D6 |
| `setupLiteLLM` 内部改为 supervisor + 可重建 runtime | D4；外部签名保持兼容 |
| 新增运行时依赖 jsonc-parser | D2 |
| 新增 `endpoint-management` 能力；core 无变更 | 逻辑属于 OpenCode 宿主边界 |

## Risks
- 重建会重新注册全部 endpoint 的 provider；已用 snapshot 恢复缓解，真实 E2E 验证 Add/Edit/Delete 后其它 endpoint 仍可见。
- 定位配置文件依赖 `OPENCODE_CONFIG`/XDG 约定与 `plugin.list()` source 匹配；不确定时 fail closed（只读并说明）。
