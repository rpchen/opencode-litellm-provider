## MODIFIED Requirements

### Requirement: tag 生成 GitHub Release
推送形如 `vX.Y.Z` 的 tag SHALL 触发 Release workflow。workflow MAY 提供显式 `workflow_dispatch` 入口，但该入口 MUST 只接受既有版本 tag，MUST NOT 从分支发布。workflow SHALL 验证 tag、package version、lockfile 顶层及根包版本一致，以 tag 内既有 provenance 的 SHA 复验未覆盖的 dist，重跑全部发行门禁，再打包原候选产物、生成 SHA-256 并创建 GitHub Release。上传后 SHALL 下载附件复核校验和、打包字节与解包 dist。workflow MUST NOT 在同一 tag 发版时刷新 core/main，MUST NOT 执行 `npm publish`，MUST NOT 要求 npm token、个人 PAT 或 LiteLLM 凭据。

#### Scenario: tag 与包版本不一致
- **WHEN** tag 为 `v0.2.0` 而 package.json 或 lockfile 任一根版本不是 `0.2.0`
- **THEN** Release workflow 失败且不创建 GitHub Release

#### Scenario: 创建首个 Release
- **WHEN** `v0.1.0` tag 的版本一致且全部门禁通过
- **THEN** workflow 创建 GitHub Release，并附加包含 `dist` 的 `.tgz` 与对应 SHA-256 文件，不向 npm registry 发布

#### Scenario: core/main 在 tag 后更新
- **WHEN** 运行或重跑某 tag 的 Release workflow 时 core/main 已前移
- **THEN** workflow SHALL 继续使用该 tag 的 provenance SHA 和原产物；固定复验失败时停止，不以最新 core 重建替换

#### Scenario: 显式发布固定 tag
- **WHEN** 维护者对既有版本 tag 显式 dispatch Release workflow
- **THEN** workflow SHALL 使用该 tag 的源码与 provenance，并执行和 tag push 相同的全部门禁

#### Scenario: 显式入口误选分支
- **WHEN** workflow_dispatch 选择 main 或名称看似版本号的分支
- **THEN** workflow SHALL 在发布前失败，不创建或移动 tag，不生成 Release

#### Scenario: 发布附件复核
- **WHEN** Release 附件上传完成
- **THEN** workflow SHALL 下载 `.tgz` 和 SHA-256 文件，核验校验和、与本次打包字节一致、解包 dist 与已验证候选一致；不一致则运行失败
