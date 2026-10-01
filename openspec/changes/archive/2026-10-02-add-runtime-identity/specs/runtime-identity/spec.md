## ADDED Requirements

### Requirement: Runtime Identity 定义
插件 SHALL 提供当前运行 artifact 自身的不可变身份 Runtime Identity，只包含三个核心字段：`pluginVersion`、`artifactDigest`、`coreCommit`。它 MUST NOT 表示 Git HEAD、main、最新 Release、`.git` 推断状态或 cache 路径推断结果。第一版 MUST NOT 包含 `Plugin Commit` 与 `builtAt`。

#### Scenario: [IDENTITY-FIELDS] 三字段完整
- **WHEN** 读取已构建 artifact 的 Runtime Identity
- **THEN** `pluginVersion` 为插件 canonical package metadata 的版本，`artifactDigest` 为 `sha256:<64位hex>` 的确定性 artifact 摘要，`coreCommit` 为完整 40 位 Git SHA

#### Scenario: [IDENTITY-NO-GIT] 无运行时 Git 与 cache 推断
- **WHEN** 插件在无 `.git`、无源码 checkout、隔离安装目录中运行
- **THEN** Runtime Identity 仍可读取，不执行 `git rev-parse`，不读取 `.git`，不从安装路径或分支名推断版本

### Requirement: Artifact digest 计算语义
`artifactDigest` SHALL 为固定 SHA-256，canonical 输入为 `dist/` 下全部常规文件（递归、POSIX 相对路径排序、原始字节），manifest 为逐行 `<file-sha256>  <relative-path>\n` 的 UTF-8 拼接后再 SHA-256。计算 MUST 排除 `runtime-identity.json` 自身以避免自引用，MUST 包含 `core-provenance.json`。结果 MUST NOT 依赖构建时间、本机路径、用户名、checkout 目录、Git 状态。相同输入 MUST 产生相同结果。

#### Scenario: [DIGEST-DETERMINISTIC] 输入顺序与路径归一
- **WHEN** 以不同文件枚举顺序或 Windows/POSIX 路径分隔计算 digest
- **THEN** 结果相同

#### Scenario: [SELF-EXCLUSION] 自排除无递归
- **WHEN** `runtime-identity.json` 自身内容变化（仅换行或字段排序）而不改变其他 dist 文件
- **THEN** 按 canonical 输入重算的 digest 不变，不形成 hash 递归

#### Scenario: [DIGEST-SENSITIVE] artifact 变化敏感
- **WHEN** 任一被纳入输入的 dist 文件字节变化
- **THEN** digest 变化

### Requirement: Canonical 来源
插件内部 SHALL 有且只有一个 canonical Runtime Identity 对象。diagnostics、audit export、startup log MUST 读取同一对象，MUST NOT 三处分别拼装（例如 diagnostics 读 package.json、audit 读另一 JSON、startup 硬编码 SHA）。

#### Scenario: [CANONICAL-SINGLE] 三处同源
- **WHEN** diagnostics、audit export、startup log 输出 identity
- **THEN** 三者的 `pluginVersion`、`artifactDigest`、`coreCommit` 完全一致且来自同一读取入口

### Requirement: Diagnostics 短形式
`/litellm-diagnostics` SHALL 增加人类可读的 Runtime Identity 块：`Plugin Version <ver>`、`Artifact <digest前8>`、`Core Commit <sha前8>`。完整值 MUST NOT 挤满 diagnostics UI。现有 diagnostics 其他信息与 endpoint detail 行为 MUST 不被破坏，不泄露凭据、URL、原始错误。

#### Scenario: [DIAG-SHORT] 短形式显示
- **WHEN** 用户执行 `/litellm-diagnostics`
- **THEN** 输出包含 Runtime Identity 三行短形式，且短值与完整值的对应前缀一致

### Requirement: Audit 导出完整值
`/litellm-audit-export` SHALL 导出完整值：`runtimeIdentity { pluginVersion, artifactDigest: "sha256:<完整>", coreCommit: "<完整40位>" }`。多 endpoint 导出中顶层与每个 endpoint 内层报告 SHALL 带同一对象。

#### Scenario: [AUDIT-FULL] 完整值导出
- **WHEN** 用户执行 audit export
- **THEN** 报告中的 `runtimeIdentity` 三字段均为完整值，且与 diagnostics 短值对应、与构建产物一致

### Requirement: Startup log 同源
插件启动 SHALL 记录同一份 Runtime Identity，不泄露 credential，不打印本机敏感路径，不为取得 identity 访问网络或执行 Git。

#### Scenario: [STARTUP-LOG] 启动记录同一 identity
- **WHEN** 插件 setup 成功
- **THEN** 启动日志包含与 diagnostics / audit 相同的 `pluginVersion`、`artifactDigest` 短值、`coreCommit` 短值

### Requirement: 正式交付严格验证
正式 distribution / release verification SHALL 要求三字段全部存在并有效，否则失败且不做 silent fallback：`pluginVersion` 为空或与 `package.json` 不一致则失败；digest 非 `sha256:<64hex>` 或与重算不一致则失败；Core SHA 非完整 40 位 hex 或与 provenance 不一致则失败；provenance 缺失/损坏则失败。

#### Scenario: [VERIFY-STRICT] 缺失与非法被拒绝
- **WHEN** identity 缺失、字段为空、digest 非法、Core SHA 非法或 provenance 损坏
- **THEN** `verify:dist` / distribution verification 失败

### Requirement: 可重复构建
同一 source + 同一 Core SHA + 同一 package version 的两次构建（`build A` / `build B`）SHALL 得到相同的 `artifactDigest`。时间戳、临时目录、Windows 路径、HOME、cache 路径 MUST NOT 改变 digest。现有 committed dist / clean rebuild / byte comparison 语义 MUST 保持并强化，MUST NOT 为通过测试而削弱。

#### Scenario: [REPRODUCIBLE-BUILD] clean rebuild 一致
- **WHEN** 在不同临时目录执行两次固定 SHA 构建
- **THEN** 两次的 `artifactDigest` 完全一致

### Requirement: Package 与 tarball 行为
打包产物 SHALL 包含 `dist/runtime-identity.json`；安装后仍可读取；MUST NOT 依赖 `.git`、源码目录、build workspace；Core provenance 与 identity 的 `coreCommit` SHALL 一致。

#### Scenario: [PACKAGE-IDENTITY] tarball 可验证
- **WHEN** 对真实 tarball 执行 package test 并隔离安装
- **THEN** identity 可读、三字段有效、coreCommit 与 provenance 一致

### Requirement: 真实宿主 E2E
Real OpenCode 2.0.16 E2E SHALL 真实安装 candidate 后验证：插件加载成功；diagnostics 显示 Runtime Identity 且短值与 candidate 对应；Core Commit 与 provenance 一致；audit 含完整值；startup 含同一 identity；不依赖 `.git`；不读取用户真实配置或 credential。

#### Scenario: [REAL-HOST-E2E] 真实宿主闭环
- **WHEN** 在隔离 HOME/XDG 与本地 fake LiteLLM 中用宿主 installer 安装不可变 commit
- **THEN** 上述 diagnostics / audit / startup / provenance 断言全部通过

### Requirement: Out of scope
本 change MUST NOT 引入 `Plugin Commit`、`builtAt`、运行时 `.git` 读取、`git rev-parse`、cache 路径解析、分支推断、latest release 推断、全错误消息注入、telemetry / crash report。

#### Scenario: [OUT-OF-SCOPE] 无时间戳与 Git 依赖
- **WHEN** 检查构建产物与运行时行为
- **THEN** 产物中无 `builtAt`，运行时无 Git 子进程与 `.git` 读取
