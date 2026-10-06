# Tasks

## 1. 删除 accept-degraded 与 RPC acceptance

- [x] 删除 `/litellm-accept-degraded` 命令（`audit-command.ts` / `multi-audit-command.ts`）
- [x] 删除 `litellm-publication` 的 `accept` 方法与 `accepted` 事件，`state` schema 改为新事实面
- [x] 删除 `acceptDegradedForSnapshot` / `acceptDegradedForSummary` / `splitAcceptArgs` / `degradationReasonFor` 与 `acceptedDegradedIDs`
- [x] 更新 `installed-consumer.mjs` 命令清单与 `audit-command.test.ts`
- [x] 证据：`test/publication.test.ts`「no accept-degraded command or RPC exists; withheld stays withheld」；`grep -r "accept-degraded\|acceptDegraded" src scripts README.md` 无结果

## 2. Partial catalog / withheld / regression / recovery / 0-N

- [x] `PublicationSummary` 与 `summarizePublication` 改为 Core catalog 事实面
- [x] diagnostics 输出 partial / unusable / regression / withheld reasons / discrepancy / conflict / LKG
- [x] regression 与 unusable catalog 生成一次性提醒；withheld 恢复自动发布
- [x] 证据：`test/publication.test.ts`（partial catalog、regression、unusable、recovery 用例）

## 3. Acknowledgement

- [x] `decideAcknowledgement` 接入刷新路径，`previouslyPublished` 改为只增基线
- [x] 不新增命令/RPC/交互动作（记录在 design D4）
- [x] 证据：`test/publication.test.ts`「previously published model becoming withheld is a regression and a loud notice」

## 4. 文档与治理

- [x] README 重写模型可用性章节并删除 accept-degraded 章节
- [x] `npm run validate:spec` / `test:openspec-closure` / `test:scenario-coverage` 通过
- [x] Real OpenCode v2 E2E 覆盖 partial catalog / withheld reasons / LKG / 自动恢复 / 无确认路径
