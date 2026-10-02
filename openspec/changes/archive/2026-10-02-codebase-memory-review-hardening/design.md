## Context

CBM 0.11.0 可返回 isError=false 但 status=degraded；index_status 的 ready 仅依据节点数大于零。Release manifest 不能将后者当成本轮成功证据。

## Goals / Non-Goals

目标是发布工具明确失败关闭和本地身份一致。不修改 discovery 业务语义、不升级原生 CBM、不创建产品 tag 或 Release。

## Decisions

先检查原生结果包络，再解析 structuredContent 或 content 中的 JSON；仅 status=indexed 且 project 合法时继续校验 ready 和导出。degraded、error、aborted_previous_preserved、persist_failed、cancelled、未知或缺失状态在 manifest 创建前拒绝。工作刷新以 realpath Git 根为 repo-path，不传快照 name；发布快照身份仍校验仓库/tag/完整 SHA。

## Risks / Trade-offs

严格检查可能拒绝过去被视为可用的部分索引；发布方需处理原生诊断后重新生成。不能以单独的 ready 绕过失败。

## Validation

scripts/codebase-memory.test.mjs 的 [CBM-DEGRADED] 覆盖两种包络、7 类非成功状态、ready=2 且预期节点=200 的输入。旧实现先复现 Missing expected exception，修复后拒绝导出。原有五个 Scenario 测试继续运行。
