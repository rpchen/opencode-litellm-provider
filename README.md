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

如果你用的是固定版本 tag，把 `package` 的值换成对应的 `github:rpchen/opencode-litellm-provider#v0.2.0` 即可，其余不变。

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

### 已安装插件的升级

先执行 `opencode plugin list`，以 `SOURCE` 列的完整来源为准；`plugin check/update` 不按 ID `litellm` 匹配。配置为 `#v0.1.4` 时，`current` 只表示该固定 tag 无变化，不代表已跟随 main。

升级时编辑原有 plugins 条目，保留全部 options，将旧 tag 改为无后缀来源（跟随 main）或 `#v0.2.0`（固定本次发行）。不要另加第二条，也不要同时启用本地与 Git 两份插件。保存后重载，再用与新配置完全一致的来源执行更新：

```sh
opencode reload
opencode plugin check "github:rpchen/opencode-litellm-provider"
opencode plugin update "github:rpchen/opencode-litellm-provider"
opencode reload
opencode plugin list
```

以上命令用于无后缀来源；固定版本需将 check/update 参数替换为配置中的完整 tag 来源。Git 安装的 VERSION 列显示提交短 SHA，不能仅用 package.json 的版本号判断是否真正更新。

v0.2.0 是共享 discovery core 迁移后的首个发行版；安装方式、宿主契约和配置保持兼容。发行说明、维护者实测范围与 core 溯源见 [v0.2.0](docs/releases/v0.2.0.md)。

### 锁定版本或回滚

使用 GitHub Release 对应的 tag：

```bash
opencode plugin add github:rpchen/opencode-litellm-provider#v0.2.0
```

固定 tag 不会随 `main` 后续变化。遇到兼容性问题时，也可以把配置中的 tag 改回此前版本；但回滚到 `v0.1.1` 会恢复活跃 TUI 卡片不即时出现的问题，回滚到 `v0.1.0` 还会恢复模型初始化缺陷。项目当前不发布到 npm registry；GitHub Release 的 `.tgz` 与 SHA-256 文件用于审计和归档，默认安装入口仍是 Git package spec。

### 从本地构建产物加载

开发插件时运行：

```bash
npm ci
npm run build:fixed  # 按已提交 provenance 构建；显式更新 core 使用 build:dist
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

本地路径必须指向含有 `index.js` 的 `dist` 目录，而不是仓库根目录。修改宿主源码后可执行 `npm run build:fixed`；需要同时取得最新共享 core 时使用 `npm run build:dist`。OpenCode 会监视本地插件构建产物的变化。

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
          // 键 = 模型名（LiteLLM /v1/model/info 里的 model_name），值 = 该模型要用的协议
          "glm-5.3": "chat",
          "gpt-5.5": "responses",
          "claude-sonnet-4-5": "messages"
        }
      }
    }
  ]
}
```

上面三项是**三个示例**，不是固定配置项：

| 键（模型名） | 值（协议） | 含义 |
|---|---|---|
| `glm-5.3` | `chat` | 让这个模型走 OpenAI 兼容的 Chat Completions（`/v1/chat/completions`） |
| `gpt-5.5` | `responses` | 让这个模型走 OpenAI Responses API（`/v1/responses`） |
| `claude-sonnet-4-5` | `messages` | 让这个模型走 Anthropic Messages API（`/v1/messages`） |

键必须与 LiteLLM `/v1/model/info` 返回的 `model_name` 完全一致；写成本地不存在的名字不会生效（插件找不到对应模型，会忽略该项）。值只能是 `chat`、`responses`、`messages` 三者之一。

插件默认会按 LiteLLM 返回的 `supported_endpoints`、`mode` 和模型名自动判断协议，只有**自动判断与真实路由不一致**时才需要在这里逐模型覆盖；不需要覆盖的模型不要写进这张表。插件不会向所有模型发送探测请求。

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

## 共享 core 与交付来源

宿主无关的模型发现与元数据逻辑只在 [rpchen/litellm-discovery-core](https://github.com/rpchen/litellm-discovery-core) 维护。OpenCode 的入口、provider 注册、连接凭据、HTTP、轮询、错误降级、配置、命令及审计仍在本仓库；`ModelSpec.package` 和 SDK 协议映射属于 OpenCode 适配层，不属于中立 core。

用户安装方式和运行时行为不变。core 在插件构建时编译进 `dist`，安装或加载插件不会从 GitHub 下载 core，不要求平级仓库、本机构建缓存或生命周期脚本。**core/main 更新不会改变已经发布的插件；下一次插件更新构建才会纳入新 core。** 本次迁移不包含跨仓库自动触发。

`dist/core-provenance.json` 记录该产物使用的公开 core 仓库、分支和完整 commit SHA。它是自动生成的构建记录，不是每次手工修改的依赖版本；不要把 Git dependency 的 `#main` 当作绕过 lockfile 自动更新的保证。

## 开发

需要 Git、Node.js、Bun 和锁定的开发依赖。普通验收只复验已提交产物，不更新 core/main：

```bash
npm ci                 # 本项目 .npmrc 固定使用公网 npm registry
npm run verify:dist    # 先在外部临时目录重建，对比未覆盖的候选 dist
npm run test:delivery  # 缓存完整性、SHA/provenance 和独立比较回归
npm run typecheck      # 按候选 provenance 准备同一 SHA
npm test               # 包含原 fixtures、快照及宿主测试
npm run test:tui-render
npm run test:distribution # 无预生成源码/缓存的构建及真实 verify CLI 负向测试
npm run test:package   # 工作区外 npm install --ignore-scripts + 真实安装入口初始化
npm run validate:spec
```

### 更新产物与固定复验

```bash
npm run build:dist     # 显式解析当时 core/main，一次 SHA 的 typecheck/test/tsc 编译
npm run verify:dist    # 按刚生成的 provenance 独立复验，不再解析 main
npm run test:package
```

`build:dist` 成功后提交整个 `dist`（包括 provenance），无需手工维护 core 版本。`build:fixed` 则按已有 provenance 重建；诊断特定提交可用 `node scripts/build.mjs --sha=<完整40位SHA>`。`verify:dist` 不覆盖候选产物，内容、缺失或多余文件有差异都失败；provenance 缺失、无效或来源不符时明确失败，不能回退最新 main。CI 和 Release 走固定复验，不先清空 dist，也不在同一 tag 发版时刷新 core/main。

开发缓存位于 `.tmp/discovery-core/<sha>`；生成源码位于 `src/generated/discovery-core/`，兼容转接位于 `src/core/`，后三者均不入库。源码准备拒绝缓存中已暂存、未暂存或未跟踪修改，并从选定 Git commit 的对象导出普通文件，避免工作树污染；不会自动 reset、clean 或 stash。遇到脏缓存请先保留和处理修改，不能用手工编辑生成文件的方式修复 core。完整的干净 SHA 缓存可供固定构建复用；没有缓存时在构建期获取公开仓库，不要求任何平级目录。

隔离安装测试提供实际 `@opencode/plugin` peer 及宿主 SDK，但以模拟宿主 context 和脱敏 HTTP fixtures 验证初始化与清理，不代表真实 OpenCode 会话或真实 LiteLLM 对话验收。迁移验收记录见 [`docs/research/pr3-core-migration-validation.md`](docs/research/pr3-core-migration-validation.md)。

开发必须在分支完成，并通过面向 `main` 的 pull request 和 required `CI` check。提交使用 Conventional Commits；完整约定见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

历史真实宿主验收结果见 [`docs/research/acceptance-notes.md`](docs/research/acceptance-notes.md)，不替代本次迁移的验证记录。宿主 API 调研见 [`docs/research/opencode-v2-plugin-api.md`](docs/research/opencode-v2-plugin-api.md)。

## OpenSpec

本项目使用 [OpenSpec](https://github.com/Fission-AI/OpenSpec) 管理规格变更：`openspec/changes/` 存放在途变更，`openspec/specs/` 存放已落地能力规格。
