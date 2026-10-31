# 真实 OpenCode E2E 门禁与基准

本文件说明 CI 中真实宿主 E2E 的作业结构、分组入口和手动基准。产品语义、分组场景与断言映射由 OpenSpec change `optimize-real-host-e2e` 与 `scripts/e2e-opencode-v2.mjs` 维护；这里只描述如何调度与解读结果。

## 作业结构（`.github/workflows/ci.yml`）

| Job id | 名称 | 作用 |
|---|---|---|
| `verify` | `CI` | 常规门禁，保持不变 |
| `resolve-host` | `Resolve real host input` | 每轮只解析一次 `latest`，生成并验证共享宿主锁 |
| `e2e-group-a` | `Real OpenCode latest E2E group A (host, models, management)` | 组 A |
| `e2e-group-b` | `Real OpenCode latest E2E group B (prices, last-known-good)` | 组 B |
| `e2e-group-c` | `Real OpenCode latest E2E group C (metadata, deletion repair)` | 组 C |
| `e2e-group-d` | `Real OpenCode latest E2E group D (notifications, failure recovery)` | 组 D |
| `real-opencode-v2-gate` | `Real OpenCode latest E2E` | 唯一 required check，汇总上述 1+4 个结果 |
| `e2e-serial-baseline` | `E2E serial baseline (manual benchmark)` | 仅手动基准模式的旧串行对照 |

四组各有独立 runner、独立 HOME/XDG、独立 fake endpoint 与真实宿主进程，并在自己组内重建真实前置。push/PR 必跑全部四组。

### 汇总门禁语义

- `real-opencode-v2-gate` 使用 `if: always()`，`needs` 显式列出 `resolve-host` 与四个固定组 job id。
- `scripts/check-e2e-groups.mjs` 完整模式按固定 job id 逐一要求 `result === "success"`：失败、取消、意外跳过、超时、缺失与载荷异常全部判负。复用模式要求resolve内当前真实交付验证成功、有效完整基线run/attempt和四组明确skipped，拒绝混合执行或失败状态。
- 全链路没有 `continue-on-error`；required check 名称与 ruleset 基线不变。

### 宿主输入

`resolve-host` 在全新临时目录创建私有 npm 项目，只执行一次 `npm view @opencode/cli@latest version`，要求精确 semver，然后 `npm install --prefix … --save-exact @opencode/cli@<version>`（不使用 `--global`）生成普通 `package.json` / `package-lock.json`，并核验实际命令路径与 `--version`。普通 manifest/lock 作为 artifact `e2e-host-lock` 上传，四组各自下载后 `npm ci --prefix <独立 prefix>`，把该 prefix 的 `node_modules/.bin` 置于 PATH 最前，并断言 `command -v opencode` 指向该 prefix。插件仍由 OpenCode 自己的 installer 从固定 candidate Git SHA 安装。

同一份锁只保证锁定输入一致，不代表各 runner 的安装目录逐字节相同；宿主安装脚本或平台包若存在锁外可变下载，属于未经真实 CI 验证的边界。

手动调试可用同样两个命令：`node scripts/e2e-host.mjs resolve --output <dir> --candidate <40-hex> --repository <owner/repo>` 与 `node scripts/e2e-host.mjs install --lock <dir> --prefix <dir>`。

`host-input.json` 记录 candidate SHA、精确宿主版本、Node/npm、OS/arch 与 runner `ImageOS`/`ImageVersion`，供实际输入分流核对；各组另记录自身实际Node/npm、OS/runner环境，不能用resolve记录冒充组环境。

### 计时

每组通过 `E2E_GROUP` 与 `E2E_TIMING_FILE`（绝对路径）输出计时 JSON，并以 `e2e-timing-group-<x>` artifact 上传。计时是尽力而为的证据：只在 E2E 成功时检查该文件；文件缺失只发 warning、不影响真实场景结论，文件存在但无法解析则视为 harness 缺陷而失败（否则基准证据不可用）。工作流不假设计时 JSON 的内部结构，只打印其顶层键，避免与脚本实现耦合。

## 本地运行

`npm test`只执行固定Core输入下的产品单元测试；索引工具回归与OpenSpec闭环测试分别由CI已有的`test:codebase-memory`和`test:openspec-closure`必跑步骤执行，避免原先在`npm test`内部又跑一遍。日常完整复验仍须执行这两个命令，以及`npm run test:e2e-gate`；没有删除这些测试。

分组与 `all` 串行入口由 E2E 脚本自身提供（默认 `all`）：

```bash
E2E_OPENCODE_VERSION=<resolved-exact-version> \
E2E_PACKAGE_SPEC=github:rpchen/opencode-litellm-provider#<40-hex-sha> \
E2E_GROUP=A \
E2E_TIMING_FILE="$PWD/.tmp/e2e-timing-a.json" \
npm run test:e2e:opencode-v2
```

`E2E_GROUP` 取 `A|B|C|D|all|delivery`；`E2E_PACKAGE_SPEC` 必须是固定 Git commit，`E2E_OPENCODE_VERSION` 必须是精确 semver，两者都会被脚本拒绝。Windows 不支持 PTY，真实 E2E 只在 Ubuntu CI 验证。

## 手动基准

三种手动入口都在同一个 `CI` workflow 的 `workflow_dispatch` 中，不新增一次性 workflow。未合并时须加 `--ref ci/optimize-real-host-e2e`：

```bash
# 常规分组调度（满足实际输入条件时可复用完整基线）
gh workflow run ci.yml -f e2e_mode=groups

# 完整四组与旧串行共用当轮同一host lock；适合性能对照
gh workflow run ci.yml -f e2e_mode=benchmark

# 旧串行对照（导出固定 harness commit，安装同一 candidate 与同一宿主锁）
gh workflow run ci.yml -f e2e_mode=serial-baseline
```

可选 `-f e2e_candidate_sha=<40-hex>` 指定安装的 candidate；省略时使用 PR head SHA 或 `github.sha`，分支名与短 SHA 会被拒绝。指定候选的dist必须与当前harness checkout的dist完全一致，否则在resolve阶段拒绝，防止以当前身份期望错误验证另一份交付。

`benchmark`运行完整四组，required check仍只在全部组成功后成功；额外串行job独立记录旧harness结果。该run总历时会包含串行对照，不能拿它当优化后常规CI历时；E2E分支提速按resolve开始至aggregate完成比较。不同run宿主锁若不同，不能声称同输入的第二次性能复测。

`serial-baseline` 模式的行为：

- 用 `git archive` 把固定 harness commit `bdd64df970a6001b35f55ecee6b2efb25d3a0324` 导出到 `RUNNER_TEMP` 的独立目录，不在错误相对路径下复用当前 checkout。
- 用当轮共享宿主锁安装宿主，用同一 `E2E_PACKAGE_SPEC` 安装 candidate；导出树里的 `dist/` 换成当前 candidate 的 `dist/`，因为 Runtime Identity 期望属于被安装的 candidate。
- 只报告基准结果（run/attempt、开始时间、结果、完整轮墙钟）；四组不会运行，因此 **`Real OpenCode latest E2E` 汇总 job 会显式判负**，`scripts/check-e2e-groups.mjs` 的 `serial-baseline` 分支不会把基准 run 说成完整分组门禁成功。

## 输入复用与证据

resolve job用自己已安装的真实宿主执行当前candidate的delivery探针：真实安装/加载、注册与价格基线、安装副本Runtime Identity/provenance、一次真实模型请求。探针失败阻断；缺安装锁或环境证据不影响完整测试结论，但不能复用。随后e2e-validation.mjs从同仓成功CI中回读完整run/attempt、组及完整测试步骤，只在candidate/harness完整Git比较、精确宿主锁、实际安装外部依赖和运行配置一致时选择delivery。其他情况全跑。

完整A–D成功才生成`e2e-full-validation/validation.json`；复用运行只上传本轮plan与探针，不成为新基线。失效/过期artifact回退完整，不建立独立缓存服务。常规CI与准确main索引仍每次执行；Release步骤不减少。详见[e2e-input-reuse.md](e2e-input-reuse.md)。

## 验证边界

- `resolve-host` 中先运行 `npm run test:e2e-gate`，覆盖命令拼装、版本/锁校验、失败路径与全部门禁状态；这些单测不需要网络，也不安装宿主。
- 普通锁安装能否完整覆盖宿主安装脚本与平台依赖，需要真实 Ubuntu CI 运行证明；本仓库的单测只用 mock 执行器与临时目录验证命令、版本与失败路径。
- artifact 上传/下载、`GITHUB_PATH` 顺序、`command -v opencode` 指向、aggregate 的真实 check-runs 名称与 ruleset 一致性，需在真实 CI 上回读确认。

性能改造两轮真实通过数据见[e2e-performance.md](e2e-performance.md)。输入复用接入后的完整基线、metadata-only与故障传播集成证据单独回填；不能用之前性能run追认为新证据格式的完整基线。
