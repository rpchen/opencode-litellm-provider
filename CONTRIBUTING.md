# 贡献指南

## 开发流程

1. 从最新 `main` 创建 `feat/*`、`fix/*`、`docs/*` 或 `chore/*` 分支，不直接修改 `main`。
2. 行为或交付方式变化先更新对应 OpenSpec change，通过 strict validation 后再实现。
3. 使用 Conventional Commits，例如 `feat:`、`fix:`、`docs:`、`ci:`、`chore:`。
4. 推送分支并创建面向 `main` 的 pull request。
5. required `CI` check 全部通过并解决 review 对话后才合并；不要绕过分支规则。

## 本地验证

```bash
npm ci
bun run typecheck
bun test
bun run build:dist
bun run test:package
npm run validate:spec
```

`dist/` 是 GitHub Git package 的组成部分，必须与 `src/` 一起提交。`bun run build:dist` 会先清理再生成 `dist`；提交前确认重新构建不会改变已暂存的产物，也不会产生遗漏的未跟踪文件。

## 安全要求

- 不得提交真实 LiteLLM 地址、API Key、GitHub PAT、npm token、`.env` 或包含这些内容的日志。
- fixtures、文档和测试只使用 `https://litellm.example`、`sk-xxx` 等占位值。
- package/CI smoke 不连接真实 LiteLLM，也不依赖 repository secrets。
- 真实环境验收必须遵守 `AGENTS.md` 的凭据来源与脱敏规则。

## 发布

普通变更不创建 tag。只有 `main` 的 CI 成功后才能创建与 `package.json.version` 相符的 `vX.Y.Z` tag。tag 会触发 GitHub Release，但不会执行 `npm publish`。
