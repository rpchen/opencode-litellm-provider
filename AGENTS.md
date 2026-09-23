# AGENTS.md

本文件是 AI 编码代理在本仓库工作时必须遵守的约定。变更流程由 openspec 管理（见 `openspec/config.yaml`）。

> 本仓库是独立 git 仓库（remote: `rpchen/opencode-litellm-provider`），物理上嵌套在 LiteLLM 部署仓库目录下，
> 但两者历史互不相干：在本目录内执行的 git 命令只作用于本仓库。

## 目录结构

| 路径 | 用途 |
|---|---|
| `src/` | 插件源码（TypeScript ESM），入口 `src/index.ts` 默认导出 v2 Promise 插件 |
| `test/` | Bun 单元测试；`test/fixtures/` 放脱敏后的 LiteLLM / models.dev 响应样本 |
| `docs/` | 文档；`docs/research/` 放宿主 API、上游行为等调研笔记；`docs/decisions.md` 记录用户拍板的方案决策（实施前必读） |
| `openspec/` | 变更提案、能力规格、归档 |
| `.opencode/`、`.claude/` | openspec 生成的代理 skills（入库，保证协作者可复现） |

## 规则

1. **临时文件**放 `.tmp/`（已 gitignore，可随时清空）。
2. **密钥**：不得在仓库任何文件（含 fixtures、文档示例）写入明文 key 或内网真实地址；用 `sk-xxx`、`http://litellm.example:4000` 之类占位。
3. **依赖**：运行时只允许依赖 `@opencode/plugin`（peer）；新增运行时依赖须在 openspec design.md 说明理由。
4. **真实环境测试凭据**：凡需连接真实 LiteLLM 的验证，统一使用 `~/.agents/skills/opencode-litellm-config-sync/.env` 中的 `LITELLM_BASE_URL` / `LITELLM_API_KEY`。只在运行时读取、只在内存中使用；地址与 Key 不得写入仓库、fixtures、日志或文档。**不要**读取 `~/.config/opencode` 下用户自己的 Key。
5. **验证**：`bun run typecheck && bun test` 必须通过后再提交。
6. **提交**：conventional commits（`feat:` / `fix:` / `chore:` / `docs:`）；openspec 在途变更随实施一起提交，完成后 archive。
