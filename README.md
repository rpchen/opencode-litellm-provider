# opencode-litellm-provider

OpenCode v2 插件：连接 LiteLLM 后，自动发现当前 API Key 可用的对话模型，并按模型能力选择合适的协议。

它会自动处理：

- 从 LiteLLM `/v1/model/info` 发现当前 Key 可见的对话模型
- 自动选择 Chat Completions、Responses 或 Anthropic Messages
- 分开映射总 context、最大 input、输出上限，以及工具调用、模态和价格
- 用 models.dev 补充元数据和 reasoning variants
- 启动、连接变化和轮询时同步模型清单
- 短暂故障时保留上次成功结果，认证失败等破坏性错误时撤下旧模型

## 快速开始

### 1. 安装

跟随仓库 `main`：

```bash
opencode plugin add github:rpchen/opencode-litellm-provider
```

锁定当前发行版：

```bash
opencode plugin add github:rpchen/opencode-litellm-provider#v0.6.0
```

要求：

- OpenCode `>=2.0.15 <2.1`
- LiteLLM 地址使用 `http://` 或 `https://`
- API Key 能访问 `/v1/model/info`（旧版可回退 `/model/info`）以及实际要调用的模型

### 2. 连接 LiteLLM

在 OpenCode 中：

1. 输入 `/connect`
2. 选择 **LiteLLM**
3. 填写 LiteLLM 根地址，例如 `https://litellm.example:4000`
4. 填写自己的 API Key

地址带不带 `/v1` 都可以，插件会自动规范化。

连接完成后，模型选择器中会出现 **LiteLLM** provider 和当前 Key 可见的模型。发现和模型调用始终使用同一个活动连接。

这是 legacy 单 endpoint 模式；升级到支持 multi-endpoint 的版本后无需迁移：它仍使用原来的 `litellm` integration、credential 和 snapshot namespace。

### 3. 选择模型并使用

像使用其他 OpenCode provider 一样选择 `LiteLLM` 下的模型并发送消息即可。

> 不需要在 `opencode.jsonc` 里再手工维护一个同名 `litellm` provider。若以前配置过，请先备份后移除或注释该静态配置，避免重复 provider。

## 多 endpoint

需要同时维护多个 LiteLLM 时，在插件 options 中配置全局 `endpoints`：

```jsonc
{
  "plugins": [
    {
      "package": "github:rpchen/opencode-litellm-provider",
      "options": {
        "pollInterval": 300,
        "contextTierCap": true,
        "endpoints": {
          "default": {
            "baseUrl": "https://personal.example",
            "protocolOverrides": {}
          },
          "company": {
            "baseUrl": "https://company.example",
            "protocolOverrides": {
              "glm-5.3": "chat"
            }
          }
        }
      }
    }
  ]
}
```

endpoint id 是用户定义的稳定 ASCII slug，必须匹配 `[a-z0-9][a-z0-9-_]*`。`default` 保留 `litellm` identity；其他 endpoint 映射成 `litellm-<id>`，显示名为 `LiteLLM · <id>`。显式 `endpoints` 模式中地址来自配置文件，不存在按 endpoint 动态生成的环境变量。

### 为每个 endpoint 配置 API Key

每个 endpoint 都会作为独立 OpenCode integration 出现在 `/connect` 中：

- `default` → **LiteLLM**（integration id `litellm`）
- `company` → **LiteLLM · company**（integration id `litellm-company`）
- 其他 id 同理映射为 **LiteLLM · <id>**

因此需要分别执行 `/connect` 并逐个选择对应的 LiteLLM integration，分别保存各自的 API Key。显式 `endpoints` 已经在插件 options 中固定 `baseUrl`，所以 `/connect` 只需要输入 API Key，不会再次询问地址。各 endpoint 的 credential 由 OpenCode 按 integration id 独立保存和切换。

在 endpoint 还没有保存 API Key 时，它虽然会出现在 `/connect` 和 `/litellm-endpoints` 中，但不会发布 provider/model；因此此时 `/models` 里看不到对应 LiteLLM 模型是正常状态。完成 `/connect` 后 discovery 成功，模型才会出现。

固定 `baseUrl` 的 endpoint 会向 OpenCode 注册**无附加表单字段**的 key 认证方式；不会发送 `form: []`。这是 OpenCode 2.0.16 的运行时 Schema 要求：认证表单如果存在必须至少包含一个字段。当前仓库 CI 会用真实 OpenCode 2.0.16、固定 Git commit 安装、两个独立 fake LiteLLM endpoint 验证 `/connect` 底层 integration、独立 credential、provider 与 `opencode models`。

每个 endpoint 都是独立 integration/provider、独立 credential、独立 discovery/cache/snapshot/故障域。插件在**同一个 OpenCode V2 plugin 实例**中注册这些 integration/provider；activation 只启停对应 provider/discovery，不会删除 endpoint 定义或已保存 credential。插件不会跨 endpoint 聚合模型、负载均衡或自动故障切换。

### 管理 endpoint（`/litellm-endpoints`）

执行 `/litellm-endpoints` 打开 OpenCode 原生选择框（终端 TUI）：`↑` / `↓` 移动，`Enter` 确认，`Esc` 返回/关闭；鼠标点选由 OpenCode 处理。列表每行显示 `✓`/`○`（启用/未启用）和凭据状态（已连接/未连接）。

| 想做的事 | 怎么做 |
|---|---|
| **新增** | 选 **＋ 新增 endpoint** → 输入 Endpoint ID → 输入 Base URL。新 endpoint **默认未启用、未连接**，不会自动启用 |
| **修改 Base URL** | 选中 endpoint → **修改 Base URL**。ID 不可修改（没有 rename）；`protocolOverrides` 等配置和你的注释原样保留 |
| **连接 / 替换 / 断开 API Key** | 选中 endpoint → **连接 API Key** / **替换 API Key** / **断开凭据**。已保存的 Key 永远不会显示；断开只删除该 endpoint 的 Key |
| **启用 / 停用** | 选中 endpoint → **启用** / **停用**；也可以用 **全部启用** / **全部停用**。立即生效，允许 0 个启用 |
| **删除** | 选中 endpoint → **删除 endpoint**，确认后彻底删除：配置、启用状态、已保存的 Key、模型发现缓存。**取消确认不会留下任何改动**（包括 legacy default 的内部迁移） |

说明：

- 连接 Key、启用/停用互相独立：连接不会自动启用，断开不会自动停用；未启用的 endpoint 也可以连接、替换、断开 Key。
- 管理中心与 `/connect` 操作**同一份** OpenCode 凭据，`/connect` 仍可照常使用。
- endpoint 定义仍只有一份：声明本插件的 OpenCode 配置文件（`OPENCODE_CONFIG` 指向的文件，或全局 `opencode.jsonc`）里的 `plugins[].options.endpoints`。管理中心只做最小改动，保留注释、格式和你手写的其它字段；你也可以继续手工编辑，下次打开会看到文件里的真实状态。配置无法解析，或插件选项来自内联/项目配置（与该文件不一致）时，新增/修改/删除会被拒绝并说明原因，启用和凭据管理仍可用。
- 新增/修改/删除后插件会重新加载 endpoint，各 endpoint 的模型会短暂重新注册。
- 旧的单 endpoint 用法（`/connect` 时填写地址）不在配置文件里：`default` 依然完整可管理——修改/替换 Key 前会先请你确认一次内部迁移，把现有地址迁移到 `options.endpoints.default`（integration、Key 不变，发现缓存重新生成）；删除则把迁移包含在最终删除确认里（确认后先迁移再立即删除），**取消删除不留任何改动**。新增第二个 endpoint 会先请你确认，再做同样的迁移。
- 通过管理中心新增 endpoint 后，启用状态会固定为“明确选择的集合”；之后手工写进文件的新 endpoint 需要在管理中心里启用。
- 仍需手工编辑配置文件：`protocolOverrides`、`pollInterval`、`contextTierCap`。endpoint ID 创建后不能直接改名；要换名请新增新 endpoint 并删除旧的。
- 管理中心依赖终端 TUI；Desktop / Web 不加载 TUI 插件，请用配置文件和 `/connect`。

停用会立即卸载该 endpoint 的运行时 provider/discovery loop，但保留配置、OpenCode 凭据和缓存；activation 是全局插件状态，默认全部启用。

## 常用命令

### `/litellm-endpoints`

打开 endpoint 管理中心（见上文“管理 endpoint”）。该操作本身不会调用模型。若命令恰好在 TUI 插件初始化/订阅事件之前执行，插件会从服务端保存的 state 恢复这次显示请求，不需要再次执行命令。

### `/litellm-diagnostics`

多 endpoint 模式下，不带参数显示 endpoint 总览：

```text
/litellm-diagnostics
```

在命令后直接传 endpoint id 可查看该 endpoint 的详细诊断，例如：

```text
/litellm-diagnostics company
/litellm-diagnostics cd-vpn
```

这里传的是配置中的 endpoint id，不是 provider id；例如应传 `company`，而不是 `litellm-company`。

查看当前插件运行状态，包括：

- 已注册模型数
- 模型配置：可用 / 未完成（含缺失字段） / 已接受降级 / LKG（历史完整快照）数量
- 缓存来源：`snapshot` / `network` / `memory-cache` / `stale`
- models.dev 命中情况
- 协议 fallback 数量
- 当前插件编入的 Core SHA
- Runtime Identity（见下文）：当前运行 artifact 自身的不可变身份

这个命令只读取现有状态，**不会发起模型请求，也不会产生额外 token 消耗**。

endpoint 里发现了模型，不等于模型已经正确配置完成。只有能力信息完整可信（上下文窗口、输出上限、工具调用、reasoning 等足以让宿主正确使用）的模型，才会作为正常模型注册。未完成模型不会伪装成正常模型；元数据获取失败（超时、5xx、网络不可达等）不会用默认值拼出看似正常的配置。元数据暂时失败但存在仍可信的历史完整快照（LKG）时，模型继续可用并在诊断中标注（标注来源与数据年龄；年龄本身不会使快照失效）。

### `/litellm-accept-degraded`

对未完成模型显式接受降级配置。命令后传模型 id（多 endpoint 模式传 `endpoint-id 模型-id`），例如：

```text
/litellm-accept-degraded gap-model
```

只接受身份已确认但能力不完整、或元数据暂时不可用的模型。身份不明、元数据非法、或无法匹配的模型会被拒绝，不会显示接受成功。接受后模型仍标记为降级（不是完整配置），诊断中可查看剩余缺口；接受状态在下次发现刷新时生效，重启后需重新接受。

“最近成功发现”“下次允许重试”等绝对时间按**当前运行 OpenCode 的宿主机器时区**显示，并附带 UTC 偏移；内部 discovery/snapshot/cache 时间仍保持标准 UTC/epoch。

终端 TUI 中的诊断卡片提供 **[关闭]**，关闭只隐藏当前会话里的当前诊断结果；再次执行 `/litellm-diagnostics` 会显示新的结果。当前诊断卡片依赖 OpenCode 终端 TUI；Desktop / Web 等不加载 TUI 卡片的客户端不会显示该卡片。

诊断结果同时保留为可恢复的 latest state：即使命令完成时 TUI 事件监听尚未就绪，TUI 初始化后的同步也会把结果显示出来，不需要重新执行命令。

### `/litellm-audit-export`

导出当前插件提交给 OpenCode 的 LiteLLM 模型视图。每次执行都会生成一个新 JSON 文件，不覆盖已有报告，也不会上传报告。

终端 TUI 会显示结果卡片，并提供“打开报告”“复制路径”和“关闭”。关闭后当前结果不会因 TUI 的 latest 轮询再次弹回；下一次导出产生新结果时会重新显示。

默认报告目录：

- Windows：`%LOCALAPPDATA%\opencode\litellm-audit\`
- macOS/Linux：`${XDG_STATE_HOME:-~/.local/state}/opencode/litellm-audit/`

报告不包含 API Key 或 LiteLLM 地址，但会包含模型名、价格、限制等元数据；分享前请自行检查。报告同时包含完整的 Runtime Identity（见下文），用于把问题对应到具体的运行 artifact。

#### Desktop / Web 需要看到导出结果

Desktop / Web 不加载 TUI 卡片。若希望导出后在会话中看到反馈，可开启：

```jsonc
{
  "plugins": [
    {
      "package": "github:rpchen/opencode-litellm-provider",
      "options": {
        "conversationFeedback": true
      }
    }
  ]
}
```

然后重启 OpenCode 或执行：

```bash
opencode reload
```

注意：

- `conversationFeedback` 默认是 `false`
- 开启后，每次 `/litellm-audit-export` 会向当前会话提交一条插件生成的消息，并触发一次宿主会话/模型处理，因此会产生 token 消耗
- 该消息包含报告的本地路径，该路径会进入会话上下文
- 如果不希望模型接触报告路径，请保持该选项关闭

### Runtime Identity

Runtime Identity 是当前正在运行的插件 artifact 自身的不可变身份，用于把问题对应到具体的构建产物，而不是猜测 Git HEAD、分支或 Release。它包含三个字段：

- `Plugin Version`：插件版本，取自 `package.json`
- `Artifact`：当前 artifact 的确定性 SHA-256 摘要（相同产物相同，不同产物不同）
- `Core Commit`：该 artifact 内嵌的 `litellm-discovery-core` 完整 commit SHA

查看位置：

- `/litellm-diagnostics` 末尾的 `Runtime Identity` 块（短形式，各取前 8 位）
- `/litellm-audit-export` 导出的 JSON 中的 `runtimeIdentity`（完整值）
- 插件启动日志中的 `LiteLLM Runtime Identity plugin=<ver> artifact=<short> core=<short>` 行

```text
Runtime Identity

Plugin Version   0.6.0
Artifact         e5aa34e0
Core Commit      8e155e0e
```

反馈问题时，请附上 `/litellm-diagnostics` 中的 Runtime Identity 段落，或 audit 导出文件中的 `runtimeIdentity` 对象。

## 配置

插件选项都可以省略：

| 选项 | 默认值 | 说明 |
|---|---:|---|
| `pollInterval` | `300` | 模型发现轮询间隔，单位秒；最小 30 |
| `contextTierCap` | `true` | 按第一个非零输入价格阶梯截断上下文窗口 |
| `protocolOverrides` | `{}` | legacy 单 endpoint 模式按 LiteLLM `model_name` 覆盖协议；显式模式放到各 endpoint 内 |
| `endpoints` | 未设置 | 启用显式多 endpoint 模式；对象 key 为 endpoint id，每项至少包含 `baseUrl` |
| `conversationFeedback` | `false` | 为 audit export 向会话提交反馈；开启后会触发一次会话/模型处理 |

示例：

```jsonc
{
  "plugins": [
    {
      "package": "github:rpchen/opencode-litellm-provider",
      "options": {
        "pollInterval": 120,
        "contextTierCap": true,
        "protocolOverrides": {
          "glm-5.3": "chat",
          "gpt-5.5": "responses",
          "claude-sonnet-4-5": "messages"
        }
      }
    }
  ]
}
```

显式 `endpoints` 模式不能与顶层 `protocolOverrides` 混用；每个 endpoint 自己维护 `protocolOverrides`。`protocolOverrides` 只在自动协议判断与真实 LiteLLM 路由不一致时使用。键必须与 `/v1/model/info` 中的 `model_name` 完全一致；值只能是：

- `chat`
- `responses`
- `messages`

没有特殊需要时不要配置它。

## 模型发现与故障行为

| 情况 | 插件行为 |
|---|---|
| 正常启动 | 若有兼容的持久化 snapshot，先恢复上次模型，再联网校正 |
| 模型清单变化 | 整体更新 LiteLLM provider；内容未变化时不重复 reload |
| LiteLLM 暂时不可达 / 超时 / 429 / 5xx | 保留 last-known-good，后续重试；诊断显示 `stale` |
| models.dev 不可达 | 继续使用 LiteLLM 数据；部分补充元数据/reasoning variants 暂缺 |
| Key 无效（401 / 403） | 撤下旧模型 |
| model-info 最终 404 | 撤下旧模型 |
| 成功返回空清单 | 撤下旧模型 |
| 断开 LiteLLM 连接 | 撤下 provider 模型 |

`/v1/model/info` 是模型发现的事实来源；`/v1/models` 不作为发现源。embedding、图像生成等非对话模型不会注册。models.dev 能力补缺优先使用原厂记录；原厂 provider 记录不可用时依次使用 OpenRouter、OpenCode，再考虑全局唯一记录，避免多网关同名模型因为 provider 歧义而丢失 context、输出上限或 reasoning 等关键能力。

模型上限按共享发现规则合并：总 context 与最大 input 分开处理；models.dev 可补充总 context，LiteLLM 的 `max_input_tokens` 仍作为 input 限制。两者冲突时不会再把 input 上限误当成总 context。Core diagnostics 会保留 models.dev 未命中的私有模型用于解释，但若最终仍无法得到正数 context/output，OpenCode 不会把该模型发布成 `context: 0` / `output: 0` 的不可用配置。

## 升级与回滚

查看当前插件：

```bash
opencode plugin list
```

检查和更新跟随 `main` 的安装：

```bash
opencode plugin check "github:rpchen/opencode-litellm-provider"
opencode plugin update "github:rpchen/opencode-litellm-provider"
opencode reload
```

如果配置里使用固定 tag，`check/update` 参数也必须使用完整的固定来源，例如：

```text
github:rpchen/opencode-litellm-provider#v0.6.0
```

需要回滚时，将现有插件来源改回目标 tag 并重新加载即可。不要同时启用 Git 安装和本地 `file://` 两份 LiteLLM 插件。

## 常见问题

### 连接成功但看不到模型

依次检查：

1. 当前 API Key 是否有权访问 `/v1/model/info`
2. `opencode plugin list` 中插件是否 active
3. 终端 TUI 执行 `/litellm-diagnostics` 查看当前状态
4. 是否仍保留了手工配置的同名 `litellm` provider
5. 若刚更新插件，执行 `opencode plugin update ...` 后再 `opencode reload`

### 为什么短暂断网后模型还在？

这是预期行为。插件会保留 last-known-good，避免临时网络波动让模型列表突然消失。诊断中会显示 `stale`。

### 为什么无效 Key 会让模型消失？

401/403 被视为破坏性认证失败，插件会清空旧结果，避免继续展示当前凭据已经无权访问的模型。

### 为什么 Desktop / Web 看不到 diagnostics？

`/litellm-diagnostics` 当前通过 TUI 插件槽位展示；非 TUI 客户端不会显示这张卡片。

## 隐私与安全

- API Key 不会写入 provider/model 定义、diagnostics、audit report 或持久化 discovery snapshot
- diagnostics 不显示 LiteLLM 地址、Key 或原始传输错误
- audit report 不包含 LiteLLM 地址或 Key
- `conversationFeedback=true` 会把报告本地路径写入会话上下文；不希望这样时保持默认关闭

## 开发与架构

普通用户不需要安装 Core、运行构建脚本或维护 provenance。共享发现逻辑已经编译进插件的 `dist`，运行时不会下载 Core。

开发、构建、交付验证、OpenSpec 和共享 Core 说明请看：

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [litellm-discovery-core](https://github.com/rpchen/litellm-discovery-core)
- [v0.6.0 release notes](docs/releases/v0.6.0.md)

## 开发代码索引

已入库的代码图谱使用与跨客户端配置、Release 附件及本地同步方式见 [docs/codebase-memory.md](docs/codebase-memory.md)。索引工具不属于插件运行时依赖。发布索引必须明确成功，降级结果会阻止导出；本地工作索引按当前 Git 根目录识别，并由客户端持久 MCP 会话跟踪修改。

## Claude Code OpenSpec

在本仓库启动 `claude`，可发现 `.claude/skills/` 中的 6 个 OpenSpec skills：propose、explore、apply-change、update-change、sync-specs、archive-change（命令名均以 `openspec-` 开头）。例如 `/openspec-propose "变更目标"` 创建提案；审阅后再用 `/openspec-apply-change <change-name>` 实施。描述供 Claude 按任务匹配，实际是否自动调用以工具记录为准。

入口由 OpenSpec CLI 1.13.2 生成并入库；新 clone 无需重复初始化。新增 Claude 入口用 `openspec init --tools claude --no-animation`；升级用 `openspec update --force` 刷新 `.agents/skills/` 和 `.claude/skills/` 并审阅差异，两处均由 CLI 模板生成。`CLAUDE.md` 导入 [AGENTS.md](AGENTS.md)，不复制项目规则。

## 每次 PR 后的代码索引

已显式选择的仓库在每个 main 提交通过完整 CI 后，将准确 SHA 的索引发布到 `codebase-memory-index` 分支。新任务先用 `prepare_codebase_task` 同步最新 main 和对应索引；授权合并后用 `finish_codebase_task` 验证本地与远端一致。四客户端共用这两个 MCP 工具，原生工作缓存不会进入源码 PR。详见 [代码索引流程](docs/codebase-memory.md)。

### main 索引同步的安全检查

新任务/合并收尾会在索引下载后及返回 ready 前重新核验远端 main，记录最终核验时刻；分支或源码并发变化会保留工作并失败。发布任务按完整 SHA 隔离排队，快照从固定干净检出生成。已选择子仓的损坏 metadata 会阻止整体 ready；缺失工作 artifact 必须成功恢复。共享缓存竞争只复用完整且身份/校验一致的赢家。四客户端共用 MCP 失败门禁；每次新任务调用 prepare 仍需代理遵循 AGENTS，不能把安装配置当作宿主级强制任务拦截。详见 [索引说明](docs/codebase-memory.md#本轮审核后的同步安全边界)。
