# Tasks

## 1. Core 依赖更新

- [x] Core PR rpchen/litellm-discovery-core#29+#30 合入 main 后，解析该 main SHA 并用 `npm run build:dist` 一次性更新 `dist/`（同一 SHA 全程复用，写入 `dist/core-provenance.json` 与 runtime identity digest）
  - 证据：`npm run verify:dist` 按 provenance SHA 重建并逐字节比较
- [x] `npm run typecheck` / `npm test` 在新 Core SHA 上全绿
  - 证据：本地命令输出 + PR CI

## 2. DeepSeek 等价 integration regression（OpenCode 最终宿主 config）

- [x] 新增 `test` 用例：真实 DeepSeek 形态 → Core publication → `toOpenCodeModelSpecWithPublication`，断言最终 host model `limit.output=393216`、`limit.context=1000000`，强负断言 `!= 943718`，selectionSource = canonical-original
  - 证据：`npm test`
- [x] OpenRouter-only fallback 冲突 → 模型 blocked、注册列表不含该模型；OpenCode fallback 先于 OpenRouter 且 spec id 不改写
  - 证据：同上
- [x] fixture 复用 Core sanitized 数据形态；无模型特判
  - 证据：grep OpenCode `src/` 无模型名/`393216`/`943718` 硬编码（fixture/测试数据除外）

## 3. Real OpenCode 2.0.16 E2E

- [x] 完整 CI 里 Real OpenCode 2.0.16 E2E 继续 Green（不因 dist 更新漂移），且该 check 已成为 merge gate required check（见 `require-real-opencode-e2e-merge-gate`）
  - 证据：PR CI `Real OpenCode 2.0.16 E2E`

## 4. OpenSpec closure

- [x] scenarios 100% 自动化证据；`npm run validate:spec`、`test:scenario-coverage`、`test:openspec-closure` 全绿后 archive + canonical sync + 重新 strict validate
  - 证据：本地命令输出 + PR CI

## 5. 用户文档

- [x] README 旧优先级描述更新为新 precedence
  - 证据：grep 无旧顺序残留