# opencode-litellm-provider

OpenCode v2 插件：通过 `/connect` 填写 LiteLLM 地址和自己的 API Key 后，自动发现并同步当前 Key 实际可用的对话模型。

插件会：

- 以用户自己的 Key 请求 LiteLLM `/v1/model/info`，只注册真实存在且有权访问的对话模型
- 自动选择 OpenAI Chat Completions、OpenAI Responses 或 Anthropic Messages 协议
- 映射上下文窗口、输出上限、输入输出模态、工具调用和价格
- 从 models.dev 精确补充模型元数据并生成 reasoning variants
- 默认按 LiteLLM 的阶梯价格起点截断上下文窗口，避免意外进入高价区间
- 在启动、连接变更和定时轮询时同步模型清单
- 在短暂网络故障、429 或服务端错误时保留上次成功结果；Key 无效或模型接口不存在时撤下旧结果

## 模型调用与审查导出

连接 LiteLLM 后，插件会将当前连接可访问的对话模型加入 OpenCode 的模型列表。选择所需模型后，像平常一样发送消息即可。

在已连接的 OpenCode 会话中输入 `/litellm-audit-export`。每次导出会生成一个新文件，不会覆盖已有报告；导出不会上传报告。反馈方式取决于客户端：

- **终端 TUI**：导出完成后，会话输入框上方显示结果卡片，包含完整路径以及“打开报告”“复制路径”操作。该路径不调用大模型，也不进入模型上下文；若失败，卡片显示原因。
- **Desktop / Web 等非 TUI 客户端**：这些客户端不加载 TUI 卡片，默认情况下看不到导出反馈（文件仍会正常写入）。如需在会话里看到结果，启用下方的对话反馈开关。

### 对话反馈（Desktop / Web）

**这一步是必需的。** Desktop / Web 没有 TUI 卡片通道，如果不开启 `conversationFeedback`，执行 `/litellm-audit-export` 后界面不会有任何反应——报告文件其实已经写好了，但你不会知道它在哪里。

#### 第 1 步：找到配置文件

编辑**全局配置**（如果文件不存在就新建）：

| 平台 | 路径 |
|---|---|
| Windows | `%USERPROFILE%\.config\opencode\opencode.jsonc`（通常是 `C:\Users\<用户名>\.config\opencode\opencode.jsonc`） |
| macOS / Linux | `~/.config/opencode/opencode.jsonc`（若设置了 `XDG_CONFIG_HOME`，则为 `$XDG_CONFIG_HOME/opencode/opencode.jsonc`） |

文件名也可以是 `opencode.json`（不带 c）；两者都支持，带 `c` 的可以写注释。

> 项目级配置（`<项目>/opencode.jsonc` 或 `<项目>/.opencode/opencode.jsonc`）也能设置插件，但插件是全局能力，建议写在全局配置里，避免每个项目重复设置。

#### 第 2 步：修改 `plugins` 字段

找到配置里的 `plugins` 数组，把插件从**字符串写法**改成**对象写法**，加上 `options.conversationFeedback`：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
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

要改的只有这一处：

- **改前**（字符串写法，功能可用但没有对话反馈）：
  `"github:rpchen/opencode-litellm-provider"`
- **改后**（对象写法，开启对话反馈）：
  `{ "package": "github:rpchen/opencode-litellm-provider", "options": { "conversationFeedback": true } }`

如果你用的是固定版本 tag，把 `package` 的值换成对应的 `github:rpchen/opencode-litellm-provider#v0.1.4` 即可，其余不变。

#### 第 3 步：重启 OpenCode

保存文件后重启 Desktop，或执行 `opencode reload`。

#### 第 4 步：验证

再次执行 `/litellm-audit-export`，会话里应出现一条以 `[litellm 插件]` 开头的消息，包含导出状态、报告完整路径、发现状态与模型数，随后宿主会照常产生一次模型回复。

想确认开关是否生效，也可以在配置目录执行 `opencode plugin list`，确认插件处于 active。

开启后，导出的结果会以一条会话消息的形式出现，包含导出状态、报告的完整绝对路径、当前发现状态与模型数，随后宿主会照常产生一次模型回复。该消息文本由插件生成，不依赖模型编写；即使模型回复失败，这条消息仍会保留。

需要注意的事实：

- 开启后每次导出都会产生**一次模型调用**，并消耗相应 token；默认关闭。
- 这条消息包含报告的**本地路径**，因此该路径会进入会话记录和模型上下文，也可能随宿主同步、会话导出或模型服务日志离开本机。
- 收到路径后，模型**可能自行读取该报告文件**并在回复中引用其内容。报告包含模型名、价格与限制等元数据，不包含 API Key 或连接凭据；是否接受这一点由你决定，如不希望模型接触报告内容，请保持该开关关闭。
- 命令写入报告失败时，消息只显示失败原因，不含路径。
- 程序化导出接口（RPC）不会触发对话反馈，也不会产生模型调用。

报告默认保存在以下目录：

- Windows：`%LOCALAPPDATA%\opencode\litellm-audit\`
- macOS/Linux：`${XDG_STATE_HOME:-~/.local/state}/opencode/litellm-audit/`

浅色主题下若看不到结果卡片，请升级至 `v0.1.4` 或更新版本。

报告包含当前插件提供给 OpenCode 的 LiteLLM 模型清单及相关模型信息，不包含 LiteLLM 地址或 API Key。模型名称、价格等内容可能是内部信息，分享前请先检查报告。

连接时使用自己的 LiteLLM 地址和 API Key；无需管理员 Key。

## 要求

- OpenCode `>=2.0.15 <2.1`
- LiteLLM 地址必须使用 `http://` 或 `https://`
- API Key 必须有权访问 `/v1/model/info`（旧版部署也可通过 `/model/info` 回退）及要调用的模型

## 安装

### 安装最新稳定版

仓库的默认分支 `main` 只接收通过 required CI 的 pull request。直接从公开 GitHub 仓库安装：

```bash
opencode plugin add github:rpchen/opencode-litellm-provider
```

OpenCode 会取得 `main` 上的构建；仓库已经包含 `dist`，用户无需 clone、安装依赖或本地编译。**已有相同 Git package spec 时，`plugin add` 可能复用旧缓存**：运行 `opencode plugin check github:rpchen/opencode-litellm-provider` 查看当前提交和更新提示；若显示更新可用，执行 `opencode plugin update github:rpchen/opencode-litellm-provider`，再运行 `opencode reload`。使用 `opencode plugin list` 核对实际加载的提交。不要同时保留本地 `file://.../dist` 和 Git spec 的活动 LiteLLM 插件。

若需要配置插件选项，请在 OpenCode 配置文件中把插件条目改成对象形式，并保留同一个 GitHub package spec：

```jsonc
{
  "plugins": [
    {
      "package": "github:rpchen/opencode-litellm-provider",
      "options": {
        "pollInterval": 300,
        "contextTierCap": true
      }
    }
  ]
}
```

### 锁定版本或回滚

使用 GitHub Release 对应的 tag：

```bash
opencode plugin add github:rpchen/opencode-litellm-provider#v0.1.4
```

固定 tag 不会随 `main` 后续变化。遇到兼容性问题时，也可以把配置中的 tag 改回此前版本；但回滚到 `v0.1.1` 会恢复活跃 TUI 卡片不即时出现的问题，回滚到 `v0.1.0` 还会恢复模型初始化缺陷。项目当前不发布到 npm registry；GitHub Release 的 `.tgz` 与 SHA-256 文件用于审计和归档，默认安装入口仍是 Git package spec。

### 从本地构建产物加载

开发插件时运行：

```bash
npm ci
bun run build:dist
```

然后在 OpenCode 配置文件的 `plugins` 中使用指向 `dist` 目录的绝对 `file://` URL：

```jsonc
{
  "plugins": [
    {
      "package": "file:///absolute/path/to/opencode-litellm-provider/dist",
      "options": {
        "pollInterval": 300,
        "contextTierCap": true
      }
    }
  ]
}
```

Windows 示例：

```jsonc
{
  "plugins": [
    {
      "package": "file:///C:/src/opencode-litellm-provider/dist"
    }
  ]
}
```

本地路径必须指向含有 `index.js` 的 `dist` 目录，而不是仓库根目录。修改源码后重新执行 `bun run build:dist`；OpenCode 会监视本地插件构建产物的变化。

## 连接 LiteLLM

1. 启动 OpenCode。
2. 输入 `/connect`。
3. 选择 **LiteLLM**。
4. 在 **LiteLLM 地址**中填写代理根地址，例如 `https://litellm.example:4000`。填写末尾带 `/v1` 的地址也可以，插件会统一规范化。
5. 在 **API Key** 中填写自己的 LiteLLM Key。
6. 完成连接后，模型选择器中会出现 `LiteLLM` provider 以及该 Key 可见的对话模型。

发现和模型调用始终使用同一活动连接。插件不会把 Key 写入 provider/model 定义、fixtures 或磁盘缓存。

## 配置

所有配置项均为可选项：

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---:|---|
| `pollInterval` | number | `300` | 模型发现轮询间隔，单位为秒；低于 30 时钳制为 30 |
| `contextTierCap` | boolean | `true` | 是否将上下文窗口截断到第一个非零输入价格阶梯起点 |
| `protocolOverrides` | object | `{}` | 按 LiteLLM `model_name` 精确覆盖协议，可选值为 `chat`、`responses`、`messages` |

非法配置会产生警告并回退到默认值，不会阻止插件加载。

### `protocolOverrides` 示例

当 LiteLLM 的 `supported_endpoints` 或 `mode` 与真实路由不一致时，可以逐模型覆盖：

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
          "my-responses-route": "responses",
          "claude-via-proxy": "messages"
        }
      }
    }
  ]
}
```

覆盖键必须与 LiteLLM `/v1/model/info` 返回的 `model_name` 完全一致。插件不会向所有模型发送探测请求；协议声明错误时应使用此选项修正。

## 避免重复的 LiteLLM Provider 配置

插件根据 OpenCode 中保存的 LiteLLM 连接动态注册 ID 为 `litellm` 的 provider 和可用模型，无需在 `opencode.jsonc` 中再维护同 ID 的静态模型列表。

如果配置文件的 `provider` 对象中已经定义了 ID 为 `litellm` 的 provider，就与插件要注册的 provider 重复。请先备份配置，再注释或删除这个 `litellm` 配置项；其他 provider 配置无需改动。然后在 OpenCode 中通过 `/connect` 连接 LiteLLM，并确认模型列表中只出现一个 LiteLLM provider。需要恢复时，移除插件并还原备份的配置项。

插件只读取 OpenCode 保存的活动连接，不会修改 OpenCode 配置文件。

## 发现与同步行为

- `/v1/model/info` 是模型清单的唯一事实来源；models.dev 只用于补缺，不会增加 LiteLLM 未返回的模型。
- embedding、图像生成等非对话模型不会注册。
- 同一 `model_name` 的多个部署会保守合并：布尔能力和模态取交集，数值上限取最小值。
- 模型内容未变化时不会重复 reload。
- 网络错误、超时、429、5xx、无法解析的响应和重定向会保留上次成功结果。
- 401/403、最终 404、成功返回空清单或断开连接会撤下旧模型。
- models.dev 使用六小时进程内缓存；插件不写磁盘缓存。

## 开发

```bash
npm ci              # 本项目 .npmrc 固定使用公网 npm registry
bun run typecheck
bun test
bun run test:tui-render # 在 OpenTUI 测试渲染器中检查卡片及鼠标操作
bun run build:dist        # clean build；生成的 dist 必须随源码提交
bun run test:package # 验证 tarball 在禁用 lifecycle scripts 时可安装并导入
npm run validate:spec
```

开发必须在分支完成，并通过面向 `main` 的 pull request 和 required `CI` check。提交使用 Conventional Commits；完整约定见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

真实宿主验收结果见 [`docs/research/acceptance-notes.md`](docs/research/acceptance-notes.md)。宿主 API 调研见 [`docs/research/opencode-v2-plugin-api.md`](docs/research/opencode-v2-plugin-api.md)。

## OpenSpec

本项目使用 [OpenSpec](https://github.com/Fission-AI/OpenSpec) 管理规格变更：`openspec/changes/` 存放在途变更，`openspec/specs/` 存放已落地能力规格。
