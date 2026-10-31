# 真实 OpenCode E2E：分组运行、计时与断言映射

`scripts/e2e-opencode-v2.mjs` 是 **Real OpenCode latest E2E** 门禁的唯一入口。它用 OpenCode 自己的
installer 安装固定 candidate、在独立 HOME/XDG 下启动真实宿主、用真实 PTY 驱动 TUI，并以本地
fake LiteLLM / models.dev 目录决定真实网络输入。本文说明该脚本的运行契约、分组职责、计时输出
以及旧断言在新结构中的归属。

本文只覆盖脚本本身。CI 作业划分、宿主版本解析与同名汇总门禁由 CI 变更（`.github/workflows/ci.yml`
与 `scripts/check-merge-gate.mjs`）负责，二者不在此重复定义。

## 1. 环境变量

| 变量 | 必需 | 含义 |
|---|---|---|
| `E2E_OPENCODE_VERSION` | 是 | 精确稳定版本（`x.y.z`）。宿主 `opencode --version` 必须等于 `opencode v<x.y.z>`。 |
| `E2E_PACKAGE_SPEC` | 是 | 固定 candidate：`github:rpchen/opencode-litellm-provider#<40位SHA>`，本地预检可用 `git+file:///<克隆>#<40位SHA>`。一律交给 OpenCode 自己的 `plugin add`/loader，不直接加载工作区 `dist`。 |
| `E2E_GROUP` | 否 | `all`（默认）、`A`、`B`、`C`、`D` 或 `delivery`。未知值在任何安装/宿主/fixture 工作之前立即失败。 |
| `E2E_TIMING_FILE` | 否 | 绝对路径。写入一次运行的分组计时与复用证据 JSON；不传则只输出可采集的 stdout 行。 |
| runner环境 | 自动 | 每组记录自身实际Node/npm、OS/架构与ImageOS/ImageVersion；与resolve记录不同或字段缺失则不能复用，真实E2E结果仍按断言判定。 |

所有组都读取同一个 candidate checkout 的 `dist/runtime-identity.json` 与 `dist/core-provenance.json`
作为 Runtime Identity 期望值，因此脚本本身不携带版本常量。

宿主安装输入由 `scripts/e2e-host.mjs` 生成：`resolve` 只解析一次 `latest`，在私有 npm 项目里生成
`package.json`/`package-lock.json` 与 `host-input.json`；各组用 `install --lock <dir> --prefix <dir>` 执行
`npm ci` 得到自己的宿主。该 helper 的宿主包与命令是显式参数（`--host-package`、`--host-command`），
默认仍是 `@opencode/cli` + `opencode`；Pi 门禁以 `--host-package @earendil-works/pi-coding-agent
--host-command pi` 复用同一实现。

## 2. 分组契约

`all` 保留完整旧串行顺序（安装/激活/快照/模型矩阵/blocked → 价格与 LKG → 元数据恢复 →
通知与网络恢复 → 管理 → legacy → ghostless），是固定 candidate 的单进程对照基准。

`A/B/C/D` 是同一固定 candidate 的独立进程：各自 `mkdtemp` 出 HOME/XDG/config/data/cache/state、
自己的 fake 端点、自己的宿主 server 和自己的 models.dev 目录实例。组间不传可变状态，也不复用
用户目录；组内真实宿主重启仍共享该组自己的目录。

| 组 | 真实建立的前置 | 覆盖场景（全部为真实宿主动作，无状态文件伪造） |
|---|---|---|
| `A` | 真实 `plugin add` → 真实 `serve` → 真实 `/connect` 两条凭据 → 真实 PTY 激活/停用 → 真实冷启动（HTTP 500 注入） | 宿主版本/插件 active、integration+key 方法、命令面（无 degraded、无 ack 斜杠命令）、未连接不发布、诊断最新态恢复、审计导出与 Runtime Identity、PTY 激活位置与会话 location、重新启用发现、冷启快照、异步 trigger 恢复、端点级诊断（不回落 overview、三行 Identity、不泄漏 Key）、启动日志 Identity、**冻结 16+3 注册与 63 次真实 Chat/Responses/Messages 请求**、blocked 20→13 且 default 不变；随后同一 workspace 内 Phase 2 管理链（add/connect/activate/edit/replace/disconnect/deactivate/delete + 重启不复活、旁观端点凭据不受影响）、Phase 3 legacy（真实 `/connect` 带 url answer → 迁移 → replace → edit 用新地址且不再查旧地址 → delete → 重启不复活）、Phase 4 ghostless（首次 Add 不钉旧 default、手工加 default 不被陈旧 activation 自动激活） |
| `B` | 真实 install/connect；**初次发现前**即设置 frozen 16+3 与 baseline catalog；自己断言 19 个注册的 limits/variants/cost 与 controls 变体 | 价格稳定集合复用已注册配置（cost 改动不改变 19 个模型与 limits、`regressions` 为空）；真实 catalog outage + 删除后重加同一 `model_name` 使用 LKG（真实 catalog 请求失败计数增长、publishable 仍 19、ids/limit/variants 与基线一致、`LKG 1` 诊断 TUI）；catalog 恢复后再次删除/重加回到 fresh（publishable 19 且 `lkgIDs` 0） |
| `C` | 同 `B` 的真实 baseline；该组内 `e2e-metadata-recovery` 从未有过成功 LKG | outage 下新身份 `metadata-unavailable` withheld（真实请求失败、既有 19 仍可用）；catalog 恢复后同一集合自动恢复到 20 且 withheld 0；成功 empty 目录删除全部模型；partial catalog 下 `invalid-fields`/`minimax-m3` withheld（诊断 TUI），修复 selected record 后删除/重加自动发布 |
| `D` | 真实 baseline，且 **初次发现前** catalog 已是修复后形态（`minimax-m3` `reasoning=false`）；随后一次真实正常发现并断言 `minimax-m3` 可发布 | unusable 集合 `gap-a`/`gap-b` 出现 `catalog 当前不可用` → 真实宿重启后同问题集合已确认（quiet）→ 加 `gap-c` 后在**产生通知的当轮**观察到 `withheld` 含 gap-c 且 `acknowledgement.notify===true` → 诊断 TUI 显示 gap-c；随后恢复 normal 基线、HTTP 500 保留上次模型（`source==="stale"`）、恢复、401 清空、恢复 |

各组都不重复 A 的 63 次对话请求，也不重复 `A` 的管理/legacy/ghostless 链。`B/C/D` 的 bootstrap
只用真实宿主能力的异步 HTTP（session、connect、provider、model 读取）建立状态，因此同进程 fake
服务不会被 `spawnSync` CLI 挡住；版本探测与 `plugin add` 仍是真实 CLI 契约，TUI 仍是真实 PTY。
同理，等待辅助使用的 `litellm-publication/state` RPC 与已安装候选的 cache reset 走宿主自己的
HTTP RPC 端点（同一路径、同一 Basic 认证），不再在等待循环里用同步 CLI；CLI 契约仍由
`plugin list`、`models`、`reload`、`--version` 与 `plugin add` 覆盖。

### 2.0 `delivery`：候选专项验证（不是矩阵）

`E2E_GROUP=delivery` 只在**已确证输入相同**时替代完整矩阵执行，本身不新增场景、不缩减任何组的断言：

1. 真实 `plugin add` 安装固定 candidate，真实宿主 `serve` 加载并激活；
2. 注册集仍是冻结 16 + 3 controls（limits/variants/cost 与 `B/C/D` 同一 oracle）；
3. 从**已安装副本**（`node_modules/<candidate>/dist`）读取 `runtime-identity.json` 与
   `core-provenance.json`，与本 checkout 逐字段相等，且 `provenance.sha === identity.coreCommit`、
   `package.json` 版本 `=== identity.pluginVersion`；
4. 用该组自己的异步宿主会话完成**一次**真实模型 SDK 请求（chat 协议、无推理变体的冻结模型），
   断言落到 `/v1/chat/completions` 且 `body.model` 为该模型。

它不建立凭据隔离、blocked、价格/LKG、元数据恢复、通知/网络恢复、管理/legacy/ghostless 等前置，
也不断言任何生命周期语义；因此 `delivery` 报告永远不能充当完整基线，完整矩阵只由 `all`/A/B/C/D
产出。`all`/A/B/C/D 的 63 次模型请求保持不变。

### 2.1 复用证据（`deliveryInputs`）

`scripts/e2e-installed-inputs.mjs` 在临时 HOME/XDG 被删除**之前**读取真实安装结果，产出报告里的
`deliveryInputs`：

| 字段 | 含义 |
|---|---|
| `complete` | 只有真实、无歧义、可复现的外部证据才为 `true` |
| `reason` | `complete:false` 时的公开原因（不含路径/URL/凭据） |
| `lockfileVersion`、`packages` | 已安装候选**实际祖先** `package-lock.json` 的外部依赖条目 |

对外接口（Pi 适配层按同一契约实现自己的证据源）：

```js
locateInstalledCandidates({ roots, workspace })        // -> [{ root, distDir, manifestPath }]
readInstalledPackage({ root, packageName })             // -> { manifest, identity, provenance }
findAncestorLock({ root })                              // -> { lockPath, lockDir } | null
normalizeInstalledLock({ lock, packageName, candidateSha }) // -> { lockfileVersion, packages }
collectDeliveryInputs({ roots, workspace, packageName, candidateSha,
                        expectedIdentity, expectedProvenance }) // -> { complete, reason?, ... }
```

规则与失败面：

- 在本次运行自己的目录（HOME/XDG config/data/cache/state）内定位唯一一个含
  `dist/runtime-identity.json` + `dist/core-provenance.json` 的已安装包；不跟随符号链接，不读用户真实 HOME。
- 祖先锁是从该包向上最近的 `package-lock.json`（真实安装命令写出的那份）。缺失则 `complete:false`。
- 规范化只剔除两项：空根条目 `""` 与候选自己的 `node_modules/<candidate>` 条目（它们携带随候选变化的
  `version`/`resolved`）。其余条目**原样保留**，含 `version`、`resolved`、`integrity` 与 `dev`/`optional`
  等模式位。
- 锁必须绑定候选：候选条目存在且 `resolved` 含 `#<candidateSha>`；解析到本地路径的运行时依赖、
  多个已安装代次（无法判断宿主加载了哪一份）、身份/来源不一致，全部 `complete:false` + `reason`。
- 报告里的 `deliveryInputs` 用 `isDeepStrictEqual` 比较，只有 `complete:true` 且各组合相同时才可复用；
  失败只影响复用，不影响本次真实 E2E 结果。

真实限制（不美化）：

- OpenCode 用 `@npmcli/arborist` 在每次安装里重新生成锁，宿主依赖锁定的是宿主，**不锁定插件运行时**。
  因此跨轮次的传递依赖解析漂移会直接让 `deliveryInputs` 不同，此时只能回到完整矩阵。
- `npm ci` 与 arborist 安装的产物逐字节相同无法保证，证据只描述锁描述的外部依赖面。
- 已发布的宿主安装器用 `@npmcli/arborist` 的 `reify` 安装插件且 `ignoreScripts: true`（已在 workspace
  上游审计中核实），因此候选的运行时生命周期脚本不会执行；证据只覆盖包字节与其依赖，不覆盖脚本行为。
- 证据来源按宿主不同而不同：Pi 从 Git clone 安装，不产生 npm 锁，需要它自己的证据来源并沿用同样的
  `{ complete, reason? }` 契约。

### 2.2 断言归属（旧脚本 → 组）

旧串行脚本的行号固定于 `bdd64df`。下表按“旧段 → 组”给出归属，便于 review 与回归比对：

| 旧段（`bdd64df` 行） | 组 | 说明 |
|---|---|---|
| 552-712 安装/激活、integration、命令面 | `A` | 真实 installer + 真实 server |
| 714-733 未连接不发布、诊断最新态 | `A` | 无凭据负向 |
| 735-770 审计导出 + Runtime Identity | `A` | 真实 RPC + 落盘文件 |
| 772-797 PTY 停用 company、两条 `/connect` | `A` | 凭据隔离；后续组的旁观凭据前置 |
| 826-839 provider/CLI 负向 | `A` | 停用端点 0 次发现 |
| 841-892 location 语义 | `A` | 会话 action location + 已加载 location 对齐 |
| 894-928 重新启用、冷启快照 | `A` | 真实 PTY + 真实重启 |
| 930-977 trigger、端点级诊断、日志 Identity | `A` | 异步 trigger + 无泄漏 |
| 979-1095 publication/audit/TUI/cache-reset 辅助 | 共享 | 现为脚本顶层共享函数，逐组独立使用；cache reset 仍必须命中已安装候选的 `dist/net/fetch.js` |
| 1097-1198 冻结 16+3 注册与 63 次请求 | `A` | 对话矩阵只在 A，B/C/D 不复制 |
| 1200-1226 blocked 20→13 | `A` | 真实 registry + 诊断 TUI |
| 1228-1267 价格稳定 + LKG | `B` | 真实 outage、删除/重加、fresh 恢复 |
| 1269-1313 元数据不可用恢复、empty、selected repair | `C` | 新身份在该组无旧 LKG |
| 1315-1350 ack 重启、gap-c 当轮 notify、网络/auth | `D` | 同 endpoint/XDG 贯穿自己的重启链 |
| 1352-1595 Phase 2 管理链 | `A` | 需要旧凭据/activation 因果链 |
| 1598-1764 Phase 3 legacy → 迁移 | `A` | 依赖 Phase 2 留下的 activation selection |
| 1772-1859 Phase 4 ghostless | `A` | 依赖真实存在过的 default activation 与 company 凭据 |

`B/C/D` 新增的只是“本组基线断言”（19 个注册的 id/limit/capabilities/variants/cost，controls 变体）
与真实 bootstrap 步骤，用于替代 A 的对话矩阵前置；不新增产品需求。

### 2.3 不变量

- 全部自然恢复仍走宿主自己的自然调度：`pollInterval: 30`、`trigger(false)`、TTL/backoff 不变；
  没有强刷参数、模拟时钟或 timer 后门。
- 每个 attached TUI 仍使用独立 `XDG_STATE_HOME`，宿主 HOME/data/state 在组内跨重启保持。
- 每次 cache reset 都验证命中的是已安装 candidate 的 `dist/net/fetch.js`；不写 snapshot/ack/credential 文件。
- publication 状态读取与 cache reset 使用宿主自己的 HTTP RPC（与旧 CLI 相同的路径/认证），等待
  循环不回退到同步 CLI；其余 CLI 交互（插件列表、models、reload、版本、安装）保持原样。
- 负向前置（停用端点 0 次发现、旧地址不再被查、删除后不复活、陈旧 activation 不自动激活、
  `invalid-fields`/`minimax-m3` withheld、401 清空）全部保留。
- `scripts/e2e-opencode-v2.mjs` 中的场景 tag 注释（`[REAL-HOST-E2E]`、`[ACT-LOCATION]`、
  `[ACT-IMMEDIATE]`、`[BLOCKED-HOST-*]`、`[STARTUP-SNAPSHOT]`）原样保留，`npm run test:scenario-coverage`
  仍按 `e2e-*.mjs` 扫描该入口。

## 3. 计时输出

计时是纯观测：不改变等待、断言、顺序或注入状态。

stdout（CI 可直接采集）：

```
[E2E-TIMING] phase <group>.<segment> <ms>ms <ok|failed>
[E2E-TIMING] wait <kind> "<label>" <ms>ms attempts=<n>
[E2E-TIMING] summary group=<g> status=<ok|failed> durationMs=<n> phases=<n> waits=<n>
[E2E-TIMING] waits <kind> count=<n> durationMs=<n>
[E2E-TIMING] cli count=<n> durationMs=<n>
[E2E-TIMING] cli-slow "<label>" count=<n> durationMs=<n>
[E2E-TIMING] scope <full|delivery> hostInput=<recorded|missing> deliveryInputs.complete=<true|false> reason="..."
[E2E-TIMING] wrote <absolute path>
```

`wait` 的 `kind`：`refresh`（发现 stamp 推进）、`audit`（audit 状态）、`publication`（publication RPC
状态）、`registry`（宿主模型集合）、`providers`（provider 出现/消失）、`tui`（PTY 屏内文本）、
`plugin`（插件激活）、`host-start`（真实宿主 server 就绪，即一次启动/重启耗时）。

`E2E_TIMING_FILE` 写入的 JSON：

```json
{
  "group": "B",
  "script": "scripts/e2e-opencode-v2.mjs",
  "scope": "full",
  "status": "ok",
  "start": "2026-01-01T00:00:00.000Z",
  "end": "2026-01-01T00:04:12.000Z",
  "durationMs": 252000,
  "hostVersion": "x.y.z",
  "hostInput": {
    "hostPackage": "@opencode/cli",
    "hostVersion": "x.y.z",
    "candidateSha": "<40-hex>",
    "node": "v22.23.4",
    "npm": "10.9.4",
    "os": { "platform": "linux", "arch": "x64", "release": "6.8.0" },
    "runner": { "ImageOS": "ubuntu24", "ImageVersion": "20250101.1.0" },
    "resolvedAt": "...",
    "packageSpec": "github:rpchen/opencode-litellm-provider#<40-hex>",
    "hostBin": "...",
    "hostLock": ["package.json", "package-lock.json"]
  },
  "deliveryInputs": { "complete": true, "lockfileVersion": 3, "packages": { "node_modules/<dep>": { "version": "..." } } },
  "phases": [{ "label": "B.baseline", "start": "...", "end": "...", "durationMs": 42000, "status": "ok" }],
  "waits": [{ "kind": "refresh", "label": "the price-only error", "durationMs": 33000, "attempts": 34 }],
  "waitsByKind": { "refresh": { "count": 6, "durationMs": 198000 } },
  "cli": [{ "label": "models", "durationMs": 820, "status": "ok" }],
  "cliByLabel": { "models": { "count": 3, "durationMs": 2100 } },
  "counters": { "pluginInstalls": 1, "credentialConnects": 1, "hostServerStarts": 2, "tuiAttached": 3, "catalogCacheResets": 3 }
}
```

- `scope` 由 `E2E_GROUP` 决定：`delivery` 组为 `"delivery"`，`all`/A/B/C/D 为 `"full"`；`group` 保留原值，
  `all` 仍不可作为可复用基线。
- `hostInput` 是该组自己观测的宿主版本、Node/npm、OS/架构与runner image；不复制resolve所在runner的环境。
  与resolve或基线不同、字段缺失时，该运行不能作为可复用基线。
- `deliveryInputs` 见 2.1，另含PATH实际所选宿主可执行文件的SHA-256；平台包选择不同会导致不匹配。只有 `complete:true` 才可能被比较。
- 报告在临时 HOME/XDG 被删除**之前**写入（先在仍然存在的已安装副本上采集证据），仍为 best effort：
  写失败只告警，绝不影响 E2E 真实结果或退出码。
- `all` 的 `phases` 包含外层七个串行段，`A`/`B`/`C`/`D` 的段内还含更细的分段标记；嵌套段的
  `durationMs` 与所在外层段重叠，计算关键路径时应按最长段而非相加。
- 标签只含公开信息：CLI 的 `--server` 值替换为 `<host>`、URL 替换为 `<url>`、`--data` 替换为
  `<data>`，工作区路径替换为 `<e2e>`；不写 Key、完整 URL 或原始请求体。
- 计时与证据写入失败只打印一行告警，绝不影响 E2E 的真实结果或退出码。

## 4. 本地与 CI 的限制

- 真实 TUI 需要 POSIX PTY：Windows 上 `startAttachedTui` 直接失败，因此本地只能做静态与小型
  验证（`node --check`、未知 `E2E_GROUP` 立即拒绝、错误路径的计时与证据输出）。真实全组必须在
  Ubuntu runner 上执行。
- 各组仍需同一个已解析的精确宿主版本和同一份宿主安装输入；解析、锁安装与同名汇总 check
  由 CI 变更实现，组脚本只消费环境变量。
- `scripts/e2e-host.mjs` 与 `scripts/e2e-installed-inputs.mjs` 的单元测试是纯本地可跑的：
  `node --test scripts/e2e-host.test.mjs scripts/e2e-installed-inputs.test.mjs`。
- 达成“目标墙钟”不是本文件的结论：性能数字来自实际 CI 运行，未达到时需报告实测瓶颈，
  不以计时输出代替提速结论。
