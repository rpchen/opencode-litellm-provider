# 验证证据

## 当前候选与 CI

- 源码候选：`11c6425c3807b65b8158381e8b5f90e96708c627`。
- [CI run 44051166991](https://github.com/rpchen/opencode-litellm-provider/actions/runs/44051166991) 常规 CI、真实宿主输入解析、四组 Real OpenCode latest E2E 与汇总门禁均成功。已回读 A/B/C/D 与 aggregate job，非只验证安装探针。
- CI 覆盖 typecheck、verify:dist、全部产品测试、TUI 渲染、隔离分发、打包、远端固定 Git 安装、严格 OpenSpec/closure、release metadata、场景覆盖及原生索引。
- 本地产品测试 252 pass；本地 codebase-memory 42 pass。typecheck、固定产物、TUI、package 验证通过。本地隔离分发曾因 GitHub TLS/fetch 失败，远端此候选的隔离分发 CI 已通过。

## Scenario 对应

- 成功公开目录跨重启保留：`test/catalog-persistence.test.ts` 的 restart reads the successful disk catalog without contacting models.dev；`test/sync.test.ts` 的 `[CATALOG-RESTART]` 贯穿磁盘目录 → Core → ProviderSnapshot/注册。
- 最新请求失败保留完整目录：failed latest request preserves disk catalog across another restart；invalid latest catalog cannot replace the previous complete catalog。
- 无效缓存与来源隔离：invalid disk content is ignored and mirror URLs do not reuse another source。
- 重启后新增模型元数据暂不可用：`[CATALOG-RESTART-NEW]` 确认旧模型由完整本地匹配/LKG 保留，新模型在源恢复后重试成功。
- LKG 独立负向边界：explicit E2E eviction removes both cache layers to exercise genuine LKG fallback；真实宿主 B/C 组的故障注入显式移除两个测试缓存层，保留原 LKG/withheld 断言。
- 原有成功空清单、删除和认证失败撤销由完整产品测试与真实宿主矩阵覆盖。
- 旧实现负向回放 `.tmp/catalog-negative/result.txt`：新缓存测试 3 fail / 1 pass。

## 范围与复盘

根因机制为跨重启丢失公开目录，非具体模型特例；只改 adapter 的网络缓存与既有 LKG 捕获时机。沿用 Core 形状校验、匹配算法与发布门槛，Core SHA 保持 `90adfe8b0cde94ece261867997990b6f36d3e984`。

公开目录按来源 URL 隔离，不保存 LiteLLM 数据或凭据；重启仍解析本地目录，本地命中无需网络。首次安装无缓存仍需联网。README 与正式规格同步；未合并、未发版，不把单元测试或本机恢复当作真实宿主候选验收。

Pi 对应 PR：https://github.com/rpchen/pi-litellm-provider/pull/68，两个 adapter 独立交付，无 Core 合入依赖。
