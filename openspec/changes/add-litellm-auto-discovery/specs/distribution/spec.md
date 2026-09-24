## Purpose

定义插件如何仅通过公开 GitHub 仓库分发：默认分支提供最新稳定、可直接安装的构建产物，版本 tag 提供可复现安装与回滚，PR/CI 和 GitHub 分支规则共同保护 `main`，GitHub Release 提供可校验的归档附件。

## ADDED Requirements

### Requirement: 从公开 GitHub 仓库安装
项目 SHALL 支持使用 Git package spec `github:rpchen/opencode-litellm-provider` 安装插件，无需 npm registry 或私有 GitHub 凭据。未指定 ref 时 SHALL 使用默认分支 `main`，且 `main` SHALL 只包含已经通过项目 CI 的稳定、可安装内容。项目 SHALL 支持以 `#vX.Y.Z` tag 锁定版本和回滚。

#### Scenario: 安装最新稳定版
- **WHEN** 用户执行 `opencode plugin add github:rpchen/opencode-litellm-provider`
- **THEN** OpenCode 从公开仓库默认分支 `main` 安装插件，并能加载 package exports 指向的插件入口

#### Scenario: 锁定发布版本
- **WHEN** 用户执行 `opencode plugin add github:rpchen/opencode-litellm-provider#v0.1.0`
- **THEN** OpenCode 安装 `v0.1.0` tag 对应的不可变版本，后续 `main` 变化不影响该安装目标

### Requirement: 仓库包含预构建产物
项目 SHALL 把 package exports 所需的 `dist` 构建产物提交到 Git，并确保 `main` 与每个发布 tag 都包含与当前 TypeScript 源码一致的完整产物。安装 MUST NOT 依赖 `prepare`、`preinstall`、`postinstall` 或其他 lifecycle script；安装器禁用脚本时，包入口仍 SHALL 可导入。干净重建改变已提交产物或产生额外未跟踪产物时，CI SHALL 失败。

#### Scenario: 禁用安装脚本
- **WHEN** 隔离 consumer 使用 `--ignore-scripts` 安装打包产物
- **THEN** `dist/index.js` 与 `dist/index.d.ts` 已存在，package exports 可直接解析并导入

#### Scenario: 构建产物过期
- **WHEN** CI 清理 `dist`、从源码重新构建后发现 tracked 或 untracked 文件与提交内容不一致
- **THEN** CI 失败，PR 不满足合并条件

### Requirement: PR 与 main 通过统一 CI
项目 SHALL 对面向 `main` 的 pull request 和进入 `main` 的提交运行名称稳定的 `CI` 检查。检查 MUST 包含依赖锁定安装、TypeScript typecheck、全部测试、干净构建、`dist` 一致性、OpenSpec strict validation，以及不执行 lifecycle scripts 的 pack/install/import smoke test。

#### Scenario: Pull request 验证
- **WHEN** 开发分支创建或更新面向 `main` 的 pull request
- **THEN** GitHub Actions 运行完整 `CI` 检查，只有检查成功才满足合并条件

#### Scenario: main 再验证
- **WHEN** pull request 合并到 `main`
- **THEN** GitHub Actions 对合并后的实际提交重跑完整检查，并验证该远端 Git 提交可安装

### Requirement: main 由 GitHub 规则保护
公开仓库 SHALL 为默认分支启用 GitHub ruleset 或 branch protection，MUST 要求变更经 pull request 且通过 required `CI` check，MUST 禁止删除和 force-push，并 MUST 对仓库管理员生效。单维护者仓库 SHALL NOT 要求无法由提交者自己满足的 approval 数量。

#### Scenario: CI 未通过
- **WHEN** pull request 的 required `CI` check 失败或尚未完成
- **THEN** GitHub 阻止该 pull request 合并到 `main`

#### Scenario: 直接修改 main
- **WHEN** 维护者尝试绕过 pull request 直接更新、force-push 或删除 `main`
- **THEN** GitHub 分支规则阻止该操作

### Requirement: tag 生成 GitHub Release
推送形如 `vX.Y.Z` 的 tag SHALL 触发 Release workflow。workflow SHALL 验证 tag 去掉 `v` 后与 `package.json.version` 完全一致，重跑发行门禁，生成 npm tarball 与 SHA-256 checksum，并创建含这些附件的 GitHub Release。workflow MUST NOT 执行 `npm publish`，MUST NOT 要求 npm token、个人 PAT 或 LiteLLM 凭据。

#### Scenario: tag 与包版本不一致
- **WHEN** tag 为 `v0.2.0` 而 `package.json.version` 不是 `0.2.0`
- **THEN** Release workflow 失败且不创建 GitHub Release

#### Scenario: 创建首个 Release
- **WHEN** `v0.1.0` tag 的版本一致且全部门禁通过
- **THEN** workflow 创建 GitHub Release，并附加包含 `dist` 的 `.tgz` 与对应 SHA-256 文件，不向 npm registry 发布

### Requirement: 发行过程不接触服务凭据
CI、安装 smoke 和 Release workflow MUST NOT 读取 LiteLLM API Key、真实 LiteLLM 地址、个人 GitHub PAT 或 npm token，MUST NOT 把此类凭据写入日志、artifact、Release notes 或仓库文件。Release workflow MAY 使用 GitHub Actions 自动提供的最小权限 `GITHUB_TOKEN` 创建 Release。

#### Scenario: 无 secrets 的公开 PR
- **WHEN** 公开仓库收到一个不提供任何 Actions secret 的 pull request
- **THEN** 完整 CI 仍可完成 package 构建和安装 smoke，且不会访问真实 LiteLLM 服务
