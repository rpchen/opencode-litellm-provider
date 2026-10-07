# Tasks

## 1. 修改前 precondition

- [x] 记录 `Protect main` ruleset 当前状态（id 23915941、enforcement、conditions、4 条 rules、bypass_actors=[]、required checks=[CI]）
  - 证据：before 快照保存于会话记录；`scripts/check-merge-gate.mjs` 在修复前报告 required check 缺失（exit 1）
- [x] 从真实 PR head check runs 确认 exact context：`CI` 与 `Real OpenCode 2.0.16 E2E`（app github-actions，PR #54–#58）
  - 证据：`gh api .../commits/<head>/check-runs` 输出记录；不基于 YAML name 猜测

## 2. ruleset 修改

- [x] 仅在 `required_status_checks` 中追加 `Real OpenCode 2.0.16 E2E`；其余参数与原 payload 逐字段一致
  - 证据：after 快照显示 required checks = [CI, Real OpenCode 2.0.16 E2E]；pull_request/deletion/non_fast_forward 参数逐字段无漂移；`conditions`/enforcement/bypass 不变
- [x] 修改后再次读取 ruleset 验证 postcondition
  - 证据：`node scripts/check-merge-gate.mjs` exit 0（"merge gate ok"）

## 3. 治理漂移自动检查

- [x] 新增 `scripts/check-merge-gate.mjs` 并接入 CI workflow（发布敏感步骤之前）
  - 证据：`npm run test:merge-gate` exit 0；CI workflow step 定义
- [x] 负向验证：脚本对缺失 required check 会失败（修复前真实输出 exit 1）
  - 证据：修复前运行记录
- [x] 脚本不得静默跳过：API 失败、ruleset 缺失、任何漂移都非零退出
  - 证据：脚本实现（execFileSync 抛错即非零退出；failures 列表逐条报告）

## 4. Pi 同类缺口审计（本轮授权的同类修复）

- [x] Pi ruleset id 24010848 存在同类缺口（Real Pi 0.87.1 E2E 未 required），已按同一标准修复为 [CI, Real Pi 0.87.1 E2E]，其余参数无漂移
  - 证据：Pi after 快照 + `pi-litellm-provider/scripts/check-merge-gate.mjs` exit 0
- [x] Pi 仓库的 drift check 在 Pi CI 中接入（随 Pi 集成 PR 提交）
  - 证据：Pi 仓库 CI workflow step

## 5. governance OpenSpec closure

- [x] scenarios 100% 映射自动化证据；`openspec validate --all --strict` 通过后 archive + canonical sync + 重新 strict validate
  - 证据：本地命令输出 + PR CI