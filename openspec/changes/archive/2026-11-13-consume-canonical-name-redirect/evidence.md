# 本地实施证据

- REDIRECT-HOST固定样本：旧943718快照→成功发现→ProviderSnapshot→registration与TUI诊断→持久化393216，context1048576独立于输出。
- 更新构建及单元测试245 pass / 0 fail。verify:dist（109文件）、test:delivery、typecheck、test:e2e-gate（130例）、test:tui-render、test:distribution、test:package、scenario coverage与release metadata通过。
- test:codebase-memory首次41 pass / 1 fail；失败是CBM-TOTAL-BUDGET的fixture.cleanup在Windows删除临时目录时EPERM，而非预算断言。该用例无代码改动单独重跑1/1通过；不声称首次全绿，CI仍需完整42例通过。
- 固定Core SHA为90adfe8b0cde94ece261867997990b6f36d3e984，插件版本0.11.3。真实OpenCode latest E2E、main/索引及Release以PR/工作流实时记录为准，模拟宿主测试不替代真实宿主。

Scenario自动化位于test/canonical-name-redirect.test.ts。README与release notes已更新；算法只在Core，生产adapter源码无复制。Pi对应PR #66使用同一Core SHA。
