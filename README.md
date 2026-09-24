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

## 在途修复与审查导出

旧版 `v0.1.0` 尚未包含此处实现的修复：该版本在某些宿主安装路径中，Responses 模型可能可见却因 SDK package 解析失败而无法调用。切勿将模型可见误认为已修复；请在新版本 `v0.1.1` 完成发行和真实 Git 安装验收后，按下文升级。本节的导出命令也仅在安装包含该功能的新构建后可用。

在已连接的 OpenCode TUI 中输入 `/litellm-audit-export`，插件会将当前内存中的注册视图写成独立 JSON，并在该会话的消息区下方、输入框上方显示结果卡片：完整绝对路径可点击打开，旁边的“复制路径”可复制到剪贴板；点击失败时仍保留完整路径，并提供手动复制入口或简短失败原因。卡片不是可保存在历史中的对话消息，服务端重启后不承诺恢复旧卡片；同一服务下 TUI 晚加载可取回最近一次结果。命令不请求大模型，不上传内容，也不修改 `opencode.jsonc`。无 TUI 的客户端可使用插件的 `litellm-audit-export` RPC `export({ sessionID })` 主动导出并取得包含 `ok`、`path` 或 `error` 的结果；`latest({})` 只查询本进程最近的导出结果，不会再次写文件。

默认目录是 Unix 的 `${XDG_STATE_HOME:-~/.local/state}/opencode/litellm-audit/`，或 Windows 的 `%LOCALAPPDATA%\\opencode\\litellm-audit\\`（未配置时回退到当前用户的 `AppData\\Local`）。每次导出使用 UTC 时间与随机后缀生成新的 `litellm-audit-*.json`，不覆盖已有报告；先排他创建私有临时文件，写入同步后以同目录硬链接原子提交，最后清理临时文件。目录创建模式为 `0700`、文件为 `0600`（在支持 POSIX mode 的平台适用）；Windows 创建时额外撤销报告目录和文件的继承 ACL，仅授予当前用户完全访问权限。分享前请检查实际权限和路径。目录不可写或空间不足时，命令只反馈简短错误，不破坏此前完整的报告。

报告 `schemaVersion: 1`、`scope: "plugin-submitted"`：只表示插件提交给 `ProviderEditor.add` 的 provider／模型允许字段及其协议选择，不表示宿主其后变更的完整运行时配置。模型按注册顺序列出 ID、名称、package、`protocol`（插件自有的选择结果）、模态／工具能力、variant id／已知 settings、价格、上下文／输入／输出上限、状态、enabled 和发布日期。`exportedAt` 与 `lastSuccessfulDiscoveryAt` 为 ISO 8601 UTC；价格单位为 USD／百万 token；每个 `time.released` 保留提交给宿主的数值，其 `unit` 为 `unix-ms`（日期字符串经 `Date.parse`）、`unknown`（上游直接给出的数值，未规范化）或 `none`（没有可用日期，注册值为 0）。零价格／零上限是缺失时的注册默认值，并非上游确认不支持；空 variants 仅表示未取得可用推理档位。

`status` 区分 `disconnected`（无连接）、`pending`（首次待发现）、`switching`（连接切换待发现）、`ready`、`empty`（成功但无对话模型）、`stale`（临时故障，保留旧结果）、`cleared-auth` 和 `cleared-notfound`（认证失败或接口不存在，已清空）。`stale` 的最近成功时间不是此次失败的时间。连接切换或断开不会把旧连接模型导出为当前模型。模型名、variant id 与推理等级是审查目标，按注册值保留，**不会**作为秘密检测或过滤；报告不包含连接 Key、地址、凭据 ID、路由和源响应等非导出字段，但模型命名及价格仍可能是内部信息，分享前请自行检查文件。

升级时先按“安装最新稳定版”获取新构建，并在本机选一个实际存在的模型发起真实消息验证；若出现初始化错误，记录宿主版本与包解析类别而不要复制 Key、完整请求或响应。回滚为 `#v0.1.0` 会恢复该版本已有的模型初始化问题，不能把回滚当作修复。

插件不内置 LiteLLM 地址，也不需要管理员 Key。它用于替代手工生成静态 provider 配置的 `opencode-litellm-config-sync`。

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

OpenCode 会取得 `main` 上的构建；仓库已经包含 `dist`，用户无需 clone、安装依赖或本地编译。**已有相同 Git package spec 时，`plugin add` 可能复用旧缓存**：运行 `opencode plugin check github:rpchen/opencode-litellm-provider` 查看当前提交和更新提示；若显示更新可用，执行 `opencode plugin update github:rpchen/opencode-litellm-provider`，再运行 `opencode reload`。使用 `opencode plugin list` 核对实际加载的版本，确认是 `v0.1.1` 对应的新提交后再验证真实模型调用。不要同时保留本地 `file://.../dist` 和 Git spec 的活动 LiteLLM 插件。

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
opencode plugin add github:rpchen/opencode-litellm-provider#v0.1.1
```

固定 tag 不会随 `main` 后续变化。遇到兼容性问题时，也可以把配置中的 tag 改回此前版本；但回滚到 `v0.1.0` 会恢复该版本的模型初始化缺陷。项目当前不发布到 npm registry；GitHub Release 的 `.tgz` 与 SHA-256 文件用于审计和归档，默认安装入口仍是 Git package spec。

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

## 从 `opencode-litellm-config-sync` 迁移

旧脚本生成三个静态 provider：`litellm`、`litellm-openai` 和 `litellm-anthropic`。迁移步骤：

1. 备份当前 OpenCode 配置文件。
2. 安装本插件，并通过 `/connect` 连接同一个 LiteLLM。
3. 确认 `LiteLLM` provider 中的模型可见，并用所需协议的代表模型完成一次调用。
4. 从 OpenCode 配置的 `provider` 对象中删除旧脚本管理的 `litellm`、`litellm-openai`、`litellm-anthropic` 三个静态块；不要改动其他 provider。
5. 停止定期运行 `opencode-litellm-config-sync`。其 `.env` 中的高权限发现 Key 不再是本插件所需；若没有其他用途，可在确认迁移成功后自行安全清理。

插件只读取 OpenCode 保存的活动连接，不会修改 OpenCode 配置文件。需要回滚时，从 `plugins` 中移除本插件并恢复之前备份的三个静态 provider 块即可。

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
