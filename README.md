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

OpenCode 会取得 `main` 上最新的稳定构建；仓库已经包含 `dist`，用户无需 clone、安装依赖或本地编译。

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
opencode plugin add github:rpchen/opencode-litellm-provider#v0.1.0
```

固定 tag 不会随 `main` 后续变化。遇到兼容性问题时，也可以把配置中的 tag 改回此前版本。项目当前不发布到 npm registry；GitHub Release 的 `.tgz` 与 SHA-256 文件用于审计和归档，默认安装入口仍是 Git package spec。

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
bun run build:dist        # clean build；生成的 dist 必须随源码提交
bun run test:package # 验证 tarball 在禁用 lifecycle scripts 时可安装并导入
npm run validate:spec
```

开发必须在分支完成，并通过面向 `main` 的 pull request 和 required `CI` check。提交使用 Conventional Commits；完整约定见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

真实宿主验收结果见 [`docs/research/acceptance-notes.md`](docs/research/acceptance-notes.md)。宿主 API 调研见 [`docs/research/opencode-v2-plugin-api.md`](docs/research/opencode-v2-plugin-api.md)。

## OpenSpec

本项目使用 [OpenSpec](https://github.com/Fission-AI/OpenSpec) 管理规格变更：`openspec/changes/` 存放在途变更，`openspec/specs/` 存放已落地能力规格。
