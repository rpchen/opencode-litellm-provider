## 变更说明

<!-- 说明变更目的、行为差异和必要的迁移步骤。 -->

## Requirement / Scenario → Test Evidence

<!-- 行为变更必须列出 OpenSpec Scenario 与对应自动化测试；纯内部变更可说明不适用。 -->

## 用户文档影响

- [ ] README updated: <!-- 填写章节 -->
- [ ] No README change: no user-visible behavior

> 上面两项必须且只能选择一项。安装、配置、命令、默认行为、缓存/刷新/错误语义等用户可见变化必须在同一 PR 更新 README。

## 验证清单

- [ ] 相关 OpenSpec change 已先更新并通过 strict validation，或本变更不影响规格
- [ ] 每个相关 Scenario 都有可追踪自动化证据
- [ ] 安全/失败边界包含真实负向输入（如适用）
- [ ] `npm run verify:dist` / `npm run test:delivery` / `npm run typecheck` / `npm test` 通过
- [ ] `npm run test:tui-render` / `npm run test:distribution` / `npm run test:package` 通过（如适用）
- [ ] 未提交真实 LiteLLM 地址、API Key、PAT、npm token 或其他秘密
