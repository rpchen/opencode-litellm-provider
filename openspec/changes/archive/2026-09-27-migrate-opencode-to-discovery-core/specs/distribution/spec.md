## MODIFIED Requirements

### Requirement: 仓库包含预构建产物
项目 SHALL 把 package exports 所需的完整 `dist`、core 声明、许可证及 `dist/core-provenance.json` 提交到 Git，保持与插件源码和记录的 core SHA 一致。安装 MUST NOT 依赖生命周期脚本、core 下载、平级源码或构建缓存；manifest MUST NOT 声明触发 Git preparation 的精确 `scripts.build`。固定复验 SHALL 在独立目录按候选 provenance 重建并比较全部路径和字节，不先覆盖候选 dist，不解析更新的 core/main。

#### Scenario: 禁用安装脚本
- **WHEN** 工作区外的独立 consumer 使用 `npm install --ignore-scripts` 安装产物并提供明确的宿主 peer
- **THEN** 独立进程 SHALL 确认 exports 解析自安装包，加载真实入口并执行必要的 setup/cleanup 与模型注册契约；测试替身不等同真实 OpenCode 对话验证

#### Scenario: Git 安装不触发 preparation
- **WHEN** OpenCode 在 Windows 上通过直接 Arborist 调用安装 Git package
- **THEN** package manifest 不含 Pacote 识别为 preparation 触发器的 `scripts.build` 或 lifecycle scripts，安装过程无需启动嵌套的 npm 进程

#### Scenario: 构建产物过期
- **WHEN** CI 在外部临时目录按候选 provenance 的完整 SHA 重建后，发现原 dist 存在内容改变、缺失或多余文件
- **THEN** CI SHALL 失败并保持原 dist 不变；漏交或过期产物不能被先覆盖再测试的流程掩盖

#### Scenario: provenance 无效
- **WHEN** 候选 provenance 缺失、来源不符、不可解析或 SHA 无效
- **THEN** 固定复验 SHALL 明确失败，不回退最新 core/main

### Requirement: PR 与 main 通过统一 CI
项目 SHALL 对面向 `main` 的 pull request 和进入 `main` 的提交运行名称稳定的 `CI` 检查。检查 MUST 包含锁定依赖安装、按候选 provenance 的 TypeScript typecheck 和全部测试、无预生成 core 的隔离构建、原 dist 独立一致性校验、缓存污染和产物篡改回归、OpenSpec strict validation，以及禁用生命周期脚本的外部 pack/install/初始化测试。后续打包安装 MUST 验收原候选 dist，不得改用跟随最新 main 重建的替代品。

#### Scenario: Pull request 验证
- **WHEN** 开发分支创建或更新面向 `main` 的 pull request
- **THEN** GitHub Actions 运行完整 `CI` 检查，只有检查成功才满足合并条件

#### Scenario: main 再验证
- **WHEN** pull request 合并到 `main`
- **THEN** GitHub Actions 对合并后的实际提交重跑完整检查，并验证该远端 Git 提交可安装和初始化

### Requirement: tag 生成 GitHub Release
推送形如 `vX.Y.Z` 的 tag SHALL 触发 Release workflow。workflow SHALL 验证 tag 与 package version 一致，以 tag 内既有 provenance 的 SHA 复验未覆盖的 dist，重跑发行门禁，再打包原候选产物、生成 SHA-256 并创建 GitHub Release。workflow MUST NOT 在同一 tag 发版时刷新 core/main，MUST NOT 执行 `npm publish`，MUST NOT 要求 npm token、个人 PAT 或 LiteLLM 凭据。

#### Scenario: tag 与包版本不一致
- **WHEN** tag 为 `v0.2.0` 而 `package.json.version` 不是 `0.2.0`
- **THEN** Release workflow 失败且不创建 GitHub Release

#### Scenario: 创建首个 Release
- **WHEN** `v0.1.0` tag 的版本一致且全部门禁通过
- **THEN** workflow 创建 GitHub Release，并附加包含 `dist` 的 `.tgz` 与对应 SHA-256 文件，不向 npm registry 发布

#### Scenario: core/main 在 tag 后更新
- **WHEN** 运行或重跑某 tag 的 Release workflow 时 core/main 已前移
- **THEN** workflow SHALL 继续使用该 tag 的 provenance SHA 和原产物；固定复验失败时停止，不以最新 core 重建替换
