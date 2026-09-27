# 贡献指南

## 开发流程

1. 从最新 `main` 创建 `feat/*`、`fix/*`、`docs/*`、`chore/*` 或 `codex/*` 分支，不直接修改 `main`，不覆盖他人工作。
2. 行为或交付方式变化先建立对应 OpenSpec change，记录范围、设计、兼容边界及验收任务；执行 strict validation。
3. 使用 Conventional Commits，例如 `feat:`、`fix:`、`docs:`、`ci:`、`chore:`。
4. 推送分支并创建面向 `main` 的 pull request。
5. required `CI` check 全部通过并解决 review 对话后才合并；不要绕过分支规则。

## 本地验证

正常复验使用已提交产物记录的 core SHA，不更新 core/main：

```bash
npm ci
npm run verify:dist
npm run test:delivery
npm run typecheck
npm test
npm run test:tui-render
npm run test:distribution
npm run test:package
npm run validate:spec
```

`dist/`（包括 `dist/core-provenance.json`）是 GitHub Git package 的组成部分，必须与插件源码一起提交。`verify:dist` 在独立临时目录重建并比较待交付 dist，内容、缺失或多余文件有差异都会失败；不要先覆盖或删除待验收的产物。

## 更新共享 core 或插件产物

共享业务逻辑只在 `rpchen/litellm-discovery-core` 维护。本仓库 `src/generated/discovery-core/` 与 `src/core/` 是自动生成、被忽略的源码/转接，不手工编辑或提交。宿主映射位于 `src/host/`。

```bash
npm run build:dist       # 显式解析 core/main；一次 SHA 的 typecheck/test/compile
npm run verify:dist      # 按新 provenance 独立复验，不再解析 main
npm run test:package     # 在工作区外安装、加载并初始化候选产物
npm run validate:spec
```

仅重建当前固定输入使用 `npm run build:fixed`。显式选定提交用于诊断时可执行 `node scripts/build.mjs --sha=<完整40位SHA>`；不要修改 provenance 来伪造产物来源。没有本地 core 缓存时会在构建期获取公开仓库，不要求平级源码目录。缓存脏工作树会被拒绝，不自动 reset/clean；手工保留和处理修改后再重试。

core/main 更新不会自动改变已发布插件；下一次插件更新构建才包含新 core。本次不实施跨仓库 CI 触发。包版本和依赖未变时无需改写锁文件，不因 core 更新手工维护一个依赖版本。

## 安全要求

- 不得提交真实 LiteLLM 地址、API Key、GitHub PAT、npm token、`.env` 或包含这些内容的日志。
- fixtures、文档和测试只使用 `https://litellm.example`、`sk-xxx` 等占位值。
- package/CI smoke 禁用安装生命周期，不连接真实 LiteLLM，也不依赖 repository secrets。实际 host peer 与模拟 host context 的验证边界必须说明。
- 真实环境验收必须遵守 `AGENTS.md` 的凭据来源与脱敏规则；未运行项目不得记录为通过。

## 发布

普通变更不创建 tag。只有 `main` 的 CI 成功后才能创建与 `package.json.version` 相符的 `vX.Y.Z` tag。tag 会触发 GitHub Release，但不会执行 `npm publish`。Release 只复验 tag 中已有 provenance 的固定 SHA 和产物，不在同一 tag 下切换到更新的 core/main。

### 发行版本与显式重试

发行准备经 PR 同步 package.json、package-lock.json 顶层和 packages[""] 的 version，不重新解析无关依赖。`test:delivery` 同时覆盖发行 ref/版本正负向检查。已有版本 tag 可显式 dispatch Release workflow；必须选择 tag，选择 main 或其他分支会失败，且不会自行创建 tag。该入口与 tag push 使用相同固定 provenance 门禁，不是跳过测试的捷径。

可在 docs/releases/vX.Y.Z.md 维护发行说明，workflow 会将其与自动变更记录一起发布。上传后 workflow 下载附件核验 SHA-256、打包字节和解包 dist。不要移动旧 tag、覆盖已经发布的不同内容，或把旧提交/维护者单机反馈扩大成新提交/全平台测试证据。
