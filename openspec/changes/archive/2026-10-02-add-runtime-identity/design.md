## Context

当前 diagnostics 经 `src/host/diagnostics.ts:runtimeBuildInfo()` 分别读取 `package.json` 与 `dist/core-provenance.json`，audit 经 `src/host/audit.ts:createAuditReport()` 不带身份，启动无日志。三处没有共享的 canonical 对象。`dist/` 为已提交的交付产物，经 `scripts/distribution.mjs:verifyDistribution()` 做路径与字节全量比对；`scripts/build.mjs` 做隔离更新构建。不能把插件 Git commit 写进 committed dist（commit 会因该修改本身变化，形成自引用），因此选择 Artifact Digest 而非 Plugin Commit。

## Decisions

### D1 Canonical 对象：`src/host/runtime-identity.ts`
新增唯一 `RuntimeIdentity { pluginVersion, artifactDigest, coreCommit }` 与 `getRuntimeIdentity()`。diagnostics、audit、startup log 只读该对象，不各自拼装。运行时文件位置按现有 provenance 模式解析：`dist/runtime-identity.json`（编译后）回退 `../../dist/runtime-identity.json`（源码/测试）。格式非法时抛出 `RuntimeIdentityError`；diagnostics 降级显示 `unknown` 但正式 verification 必失败（D5），不静默伪造有效值。

### D2 三字段来源
- `pluginVersion`：构建时读取构建根 `package.json:version`，写入 identity；运行时只读 identity 文件。verification 断言 `identity.pluginVersion === package.json:version` 且为非空 semver-like，不在多处手工维护。
- `coreCommit`：复用当次构建的 core selection SHA（与 `core-provenance.json:sha` 同一变量），写入 identity；verification 断言 `identity.coreCommit === provenance.sha` 且为完整 40 位小写 hex。不新增 Core SHA 来源，不运行时执行 Git。
- `artifactDigest`：构建时对输出 `dist/` 计算确定性 SHA-256，存储为 `sha256:<64 hex>`。

### D3 Digest canonical 输入与自引用避免
输入范围：输出 `dist/` 下全部常规文件，递归，相对路径按 POSIX `/` 分隔并按 UTF-8 字节序排序；每个文件取原始字节 SHA-256 hex；manifest 为逐行 `<file-hex>  <relative-path>\n` 的 UTF-8 拼接；`artifactDigest = SHA-256(manifest)`。**排除 `runtime-identity.json` 自身**（它包含 digest，纳入即自引用）；包含 `core-provenance.json`（core 变更应改变 digest）、LICENSE 与全部 JS/d.ts。显式不纳入：绝对路径、构建时间、机器路径、用户名、checkout 目录、Git 状态、`.git`。该规则由 `scripts/` 共享函数实现并有单元测试锁定（顺序稳定、Windows/POSIX 路径归一、自排除不递归）。

### D4 用户可见行为
- diagnostics（`createDiagnosticsLines`）：保留现有 `Core: branch@sha` 行，追加 `Runtime Identity` 块：`Plugin Version <ver>`、`Artifact <digest前8>`、`Core Commit <sha前8>`。未知时显示 `unknown`，不挤满完整值，不泄露凭据/路径。
- audit（`createAuditReport` / multi）：增加 `runtimeIdentity { pluginVersion, artifactDigest, coreCommit }` 完整值；multi 的顶层与每个 endpoint 内层报告均带同一对象（同一 artifact）。schemaVersion 保持 1/2 不变，只做加字段。
- startup log（`setupLiteLLM`）：setup 成功路径记录一行 `LiteLLM Runtime Identity plugin=<ver> artifact=<short> core=<short>`（经注入的 logger，默认 `console`，测试可捕获；不打印凭据、绝对路径、网络/Git 操作）。

### D5 正式验证失败语义
`verify:dist` 与 `test:distribution` 在现有“路径+字节全量比对”之外增加：identity 文件存在且为合法 JSON；三字段存在且格式合法（version 非空且与 `package.json` 一致；digest 为 `sha256:<64hex>` 且与按 D3 重算值一致；core 为 40 位 hex 且与 provenance 一致）；provenance 损坏同样失败。任一失败即抛错，不 fallback、不自动修复。本地开发构建仍经同一生成路径产出完整 identity。

### D6 可重复构建
同一 source + 同一 Core SHA + 同一 package version 的两次构建（不同临时目录、不同时间）digest 必须相同。实现上 digest 只依赖 dist 文件相对路径与字节；verification 用外部临时目录重建并比较；新增 `clean rebuild digest 一致` 与 `artifact 变化导致 digest 变化` 的自动化测试。不削弱现有 committed dist / byte-equivalence 门禁。

### D7 Package / tarball
`test:package` 要求 tarball 包含 `dist/runtime-identity.json`；隔离安装后仍可读取； Lukewarm 断言不依赖 `.git`、源码目录、build workspace；Core provenance 与 identity 的 coreCommit 一致。

### D8 真实宿主 E2E
沿用固定 `Real OpenCode 2.0.16 E2E`（`scripts/e2e-opencode-v2.mjs`，`E2E_PACKAGE_SPEC` 指向不可变 commit）：真实安装 candidate 后断言 diagnostics 含 Runtime Identity 短值且与 candidate artifact 对应、audit 含完整值、startup 日志含同一 identity、不依赖 `.git`、不读取用户真实配置或凭据。

## Differences vs baseline
| 差异 | 理由 |
|---|---|
| 新增 `src/host/runtime-identity.ts` canonical 对象，`runtimeBuildInfo()` 委托其实现 | D1：消除三处分别拼装 |
| 新增构建时 `dist/runtime-identity.json` 与 digest 计算 | D2/D3：artifact 自身不可变身份，无 Plugin Commit 自引用 |
| diagnostics 追加短形式 identity 块，audit 加完整 `runtimeIdentity`，启动加一行日志 | D4：用户可见三处同源 |
| verify/distribution/package 增加 identity ↔ bytes ↔ provenance 一致性断言 | D5/D6/D7：正式交付严格性 |
| E2E 增加 identity 字段断言 | D8 |

## Risks
- digest 输入范围遗漏/多余文件会导致 rebuild 不一致：由 `compareDistributions` 全量比对 + digest 重算双重锁定，测试覆盖。
- diagnostics 快照测试需更新新增行：只追加行，不改现有行语义；fixtures 不盲目刷新。
- 启动日志在测试 mock context 中不得抛错：logger 可注入，默认 console，失败不阻断 setup。
