# 真实 E2E 输入比较与基线复用判定

本文件说明 `scripts/e2e-inputs.mjs` 的纯比较及 `scripts/e2e-validation.mjs` 的GitHub基线回读。后者用已完成成功CI的完整组与测试步骤验证普通JSON运行记录，不把artifact本身作为最终真源。

实现状态：工作流已接入当前真实交付探针和条件复用，首次无完整基线必跑A–D。集成验收另记录真实完整、metadata-only和故障传播run；先前没有实际安装输入记录的历史run不能追认为新基线。

产品语义、分组场景与断言归属见 OpenSpec change `optimize-real-host-e2e`、`docs/e2e-ci.md` 与 `docs/e2e-validation.md`；本文件不重复这些定义。

## 1. 三个判定函数

| 函数 | 回答的问题 | 输入 |
|---|---|---|
| `compareGitInputs(...)` | 安装的 candidate 与 harness 两对 Git 树是否只差允许的版本/文档字段 | `{ root, baselineCandidate, candidate, baselineHarness, harness }` |
| `checkFullBaseline(...)` | 基线记录本身是否为该仓库一次完整的矩阵成功 | `{ baseline, repository, requiredGroups }` |
| `compareHostInputs(...)` | 两次 run 的宿主输入、宿主锁与固定配置是否同一输入面 | `{ baseline, current }` |

三者都是 fail closed：任何无法核实的输入都得到 `full`（完整跑矩阵），比较错误与缺失对象不会抛异常导致 job 被跳过。

### 1.1 `compareGitInputs`

```js
const result = compareGitInputs({
  root: process.cwd(),           // 持有基线对象的 Git 仓库目录
  baselineCandidate, candidate,  // 安装的产品树：current → baseline
  baselineHarness, harness,      // 脚本/fixture/workflow 树：current → baseline
})
// result: { ok, verdict: "delivery" | "full", reason, failures[], version,
//           candidate: { baseline: {sha, tree}, current: {sha, tree}, changedPaths[] },
//           harness:   { baseline: {sha, tree}, current: {sha, tree}, changedPaths[] } }
```

- 四个输入必须是**完整 40 位小写 commit SHA**：分支名、短 SHA 与 `HEAD` 一律判 `full`，避免分类与执行之间输入漂移。
- 每个 SH 先用 `git rev-parse` 解析为 commit/tree，再用完整 `git ls-tree -r -z` 清单比较 **mode、type、blob 与路径**；新增与删除路径一并比较。**不读工作区**，也不只比较 `artifactDigest`。
- candidate 与 harness 是**两组独立比较**，互不交叉，两对之间不做任何推断。
- `changedPaths` 为可审查输出（`{path, status, before:{mode,type,object}, after:{...}}`），失败时 `reason` 汇总全部公开原因。
- 两树完全相同（同树合并/两次 SHA 同树）也判 `delivery`：这表示"输入没有变化"，但它**不**证明基线本身有效，`checkFullBaseline` 与宿主输入比较仍须分别通过。

### 1.2 允许的输入差异

只有下面这些路径允许不同；其余任何 tracked 路径的内容、模式、类型或增删都判 `full`。

| 路径 | 允许的变化 | 规范化方式 |
|---|---|---|
| `README.md` | 任意文本修改 | 只允许 `modified`，不做内容匹配 |
| `docs/releases/v<当前candidate版本>.md` | 新增或修改 | 路径由 candidate 版本推导；`docs/` 其他文件不放行 |
| `package.json` | 只有根 `version` | 解析 JSON、删掉 `version` 后其余必须 `deepEqual` |
| `package-lock.json` | 只有根 `version` 与 `packages[""].version` | 解析 JSON、删掉这两个字段后其余必须 `deepEqual` |
| `dist/runtime-identity.json` | 只有 `pluginVersion` | 解析 JSON、删掉该字段后其余必须 `deepEqual`（`artifactDigest`、`coreCommit` 必须相同） |

补充规则：

- **mode/type 变化一律 `full`**，即使 blob 相同（例如把脚本改成可执行）。
- 删除任何 `docs/releases/*`（包括旧版本 notes）一律 `full`：不允许靠删除旧 notes 让输入"看起来一致"。
- 新增文件只允许是当前版本的 release notes；其他新增、删除、重命名都 `full`。
- 版本必须自洽：candidate 树内 manifest `version`、lock 的两个根版本、`runtime-identity.json` 的 `pluginVersion` 完全一致；baseline 树（以及 harness 树）同样必须自洽，否则 `full`。版本本身按精确 `x.y.z` 校验。
- README 里固定版本是否与 notes 一致、notes 是否存在、README 链接是否正确，仍由既有 `npm run test:release-metadata` 在常规 CI 验证；本模块**故意不复制**那套内容匹配算法。
- workflow、E2E 脚本、fixture、依赖、锁内其他包、`runtime-identity.json` 其他字段等任何变化都 `full`。

### 1.3 `checkFullBaseline`

```js
const baseline = checkFullBaseline({
  baseline: record,                        // 该仓库保存的基线记录
  repository: "rpchen/opencode-litellm-provider",
  requiredGroups: OPENCODE_REQUIRED_GROUPS, // OpenCode: ["A","B","C","D"]；Pi: ["pi"]
})
// baseline: { ok, failures[], observed }
```

记录必须满足：

- `kind === "full"`：只有完整矩阵成功才能被复用，`smoke`/专项/分组裁剪记录的 `kind` 不同即拒绝。
- `groups` 的键集合**恰好**等于本适配器的 `requiredGroups`：缺组、多组都判负；每个组结果必须是 `"success"`（值可以是字符串，也可以是 `{result: "success"}` 形式的 job 结果）。
- `runId`、`runAttempt` 是正整数；`repository` 与传入的仓库名完全相同（同仓 run，不接受别的仓库或 fork）。
- 记录缺失、不是对象、或 `repository` 参数未提供，一律判负。

**证据限度**：本函数只校验记录自身的结构与完整性。存储 artifact 不是最终真源，接入时必须另行回读 GitHub 上该 run/attempt 的 workflow 成功、各 job 实际执行情况与唯一 required check；也不允许把"只跑了专项验证或 smoke 的 run"递归当成完整基线。这些回读属于 CI/运维层，不在本模块内实现。

### 1.4 `compareHostInputs`

```js
const host = compareHostInputs({
  baseline: { hostInput, lockDigest, config },
  current:  { hostInput, lockDigest, config },
})
// host: { ok, verdict, reason, failures[], compared: { hostPackage, hostVersion } }
```

`hostInput` 就是真实的 `host-input.json`（见 `scripts/e2e-host.mjs`），`lockDigest` 用 `digestHostLock` 计算，`config` 是本次显式安装/运行配置。

必须逐字节或逐值相同：

- `hostPackage`、`hostVersion`；
- `node`、`npm`；
- `os.platform`、`os.arch`；
- `runner.ImageOS`、`runner.ImageVersion`；
- 宿主 `package.json` / `package-lock.json` 的字节 digest；
- `config` 的全部固定字段（例如安装方式与 npm flags）。

明确忽略（每次 run 预期不同的定位信息）：`resolvedAt`、`hostBin`、`candidateSha`、`packageSpec`、`hostLock`、`os.release`。候选定位由 `compareGitInputs` 负责，不在这里重复。

失败边界：必需字段缺失、为 `null` 或空字符串，`lockDigest` 为空，`config` 缺失或为空对象，或出现未声明的额外字段（结构漂移），一律判 `full`。

`digestHostLock({ packageJson, packageLock })` 接受两个文件的字节（`Buffer` 或字符串），返回 `sha256:<hex>`：`sha256(manifest + "\n--e2e-host-lock--\n" + lock)`。它只覆盖**锁文件本身**的字节。

**证据限度**：

- 相同锁与相同记录只说明"声明的输入面相同"，**不**说明两台 runner 的安装目录、下载生成物或整个虚机逐字节相同；本模块不作此声明。
- 根 `package-lock.json` 锁定的是宿主包依赖，不必然覆盖宿主安装器的全部行为，也不覆盖插件 runtime 的传递依赖解析。真实 `opencode plugin add` / loader 仍会解析 candidate 的 plugin 依赖，这部分**不由宿主 lock 或本仓库根 lock 完全约束**；因此不能凭"rootlock 相同"宣称全部实际安装依赖已锁死，仍需父任务侧对安装器的真实行为核实。
- 若宿主安装存在锁外可变下载，或 runner 记录缺失/无法取得，则保持 `full`，不新建证明平台。

## 2. 组合方式（供后续接入使用）

复用只在下面全部成立时成立，任一不成立就完整跑全部组：

1. `compareGitInputs(...).verdict === "delivery"`（candidate 与 harness 各自通过）；
2. `checkFullBaseline(...).ok === true`，且 GitHub 侧已回读该 run/attempt 的完整成功与 required check；
3. `compareHostInputs(...).verdict === "delivery"`。

即使三项都通过，当前 candidate 仍要用真实 installer 安装/加载，并校验 Runtime Identity、provenance、模型注册与一次真实请求；那是当前交付的专项验证，不等同于被复用的完整凭据/生命周期矩阵，汇总也不得声称本轮跑过全矩阵。业务判定之外的一切（CLI 策略、GitHub 查询、artifact 上传下载）都不在本模块内。

## 3. Pi 复用与 Core 边界

模块是 generic node-only，不依赖 OpenCode SDK、`src/`、`dist` 或平级仓库，可直接复制到 Pi 仓库；复制时只需把 `requiredGroups` 换成 `PI_REQUIRED_GROUPS`（`["pi"]`）与对应的宿主包名，逻辑不变。允许差异的路径集合与版本字段属于两仓共享约定，不得只在一侧放宽。

这里没有任何 Core 业务算法：不判定协议、模型能力、价格、限制或推理变体，也不重算 provenance/artifactDigest。Core 共享 `docs/testing-standard.md` 对"准确 main 完整 CI"的措辞若要调整，须在 Core 与 Pi 各自 OpenSpec change 中互引，本文件不改写共享标准。

## 4. 本地验证

```bash
node --test scripts/e2e-inputs.test.mjs
```

测试使用系统临时目录里的**真实 Git 仓库 fixture**（每个用例自己 init/commit，不依赖网络或本仓库历史），覆盖：

- 同树两个 SHA、version-only 提交（README + 新 notes + 三处版本字段）；
- 同一 JSON 路径的额外依赖/script/字段、lock 额外包、`runtime-identity.json` 额外字段；
- `artifactDigest` 未变但其他 dist blob 改变的路径比较，以及 blob 相同仅 mode 改变的判定；
- 删除旧 notes、修改 `docs/` 其他文档、新增/删除 tracked 文件；
- candidate 相同而 harness 变化（两对不混用）、缺失 Git 对象、短 SHA/分支名、空输入、脏工作区不影响判定；
- candidate 或 baseline 版本不自洽；
- 宿主版本/Node/npm/平台/架构/runner image/host lock/config 变化、`null` 元数据、额外字段、缺失比较侧；
- 基线 `kind`、组集合（含 OpenCode 与 Pi）、组结果、`runId`/`runAttempt`/`repository` 各类不满足。

## 5. 尚未覆盖的边界

- CI接入已实现；首次缺基线完整跑，复用是否实际生效需对应运行证据，不能把分类器单测当集成成功。
- 无法证明基线 run 的真实性（artifact 可被改写）；必须以 GitHub 事实为准。
- 未证明宿主安装器对插件 runtime 传递依赖的解析可由根 lock 约束，也未证明不同 runner 的安装目录逐字节一致。
- plan处理基线缺失/过期并回退完整；普通artifact按保留期清理，不建立额外缓存状态。
- 不覆盖 README 文本与 release notes 的语义正确性（由 `test:release-metadata` 与人工 review 负责）。


## GitHub运行记录与当前交付

`e2e-validation.mjs plan`在当前真实探针成功后，搜索同仓最近20个成功运行，要求CI workflow路径、仓库、run/attempt/source head、实际完整组与E2E步骤均成功，并比较Git双输入、宿主锁/环境/配置和实际安装外部依赖。任一步缺失/差异回退full。`record`仅把本轮完整各组的成功报告转成`kind=full`记录；证据不完整时输出不可复用原因，不能伪造full。复用分支不会生成基线。

OpenCode installer的实际npm generation锁独立于宿主锁和仓库根锁；外部依赖条目严格比较，仅剔除安装候选自身的version/Git locator和临时根条目，候选版本/源码由Git与安装身份校验。组环境来自各自runner，不能复制resolve环境；runner image变化即完整跑。Pi采用其实际Git安装与宿主loader提供peer的证据，不声称dev lock约束运行时。


宿主安装补充核查：已读取npm发布的`@opencode/cli@2.2.5/postinstall.mjs`（tarball integrity `sha512-sJAwrwuVa5b+pA3O1UOiSDcC9DgdPVmtkWv6aF6q3+rOiOTCqrE41tkz1kyyE2O8BYPs4eOvBuzkQ6oEm8w5Mw==`）。它会按AVX2/libc选择平台包，缺包时另起npm安装精确平台版本，因此宿主version与根锁相同不足以证明执行了相同二进制。各实际报告在deliveryInputs中记录PATH所选真实可执行文件的SHA-256，基线组和当前探针必须相同；读不到则完整运行。此记录只补实际执行物差异，不声称整个虚机或所有生成物相同。
