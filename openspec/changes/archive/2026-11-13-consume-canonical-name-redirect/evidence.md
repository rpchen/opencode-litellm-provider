# 本地实施证据

- REDIRECT-HOST固定样本：旧943718快照→成功发现→ProviderSnapshot→registration与TUI诊断→持久化393216，context1048576独立于输出。
- 更新构建及单元测试245 pass / 0 fail。verify:dist（109文件）、test:delivery、typecheck、test:e2e-gate（130例）、test:tui-render、test:distribution、test:package、scenario coverage与release metadata通过。
- test:codebase-memory首次41 pass / 1 fail；失败是CBM-TOTAL-BUDGET的fixture.cleanup在Windows删除临时目录时EPERM，而非预算断言。该用例无代码改动单独重跑1/1通过；不声称首次全绿，CI仍需完整42例通过。
- 固定Core SHA为90adfe8b0cde94ece261867997990b6f36d3e984，插件版本0.11.3。真实OpenCode latest E2E、main/索引及Release以PR/工作流实时记录为准，模拟宿主测试不替代真实宿主。

Scenario自动化位于test/canonical-name-redirect.test.ts。README与release notes已更新；算法只在Core，生产adapter源码无复制。Pi对应PR #66使用同一Core SHA。

真实OpenCode 2.2.7 A组两次在新目录尚未创建/打开会话前调用RPC时返回rpc.unavailable（runs/43363320804）。将同一状态断言移至原有新目录会话/TUI打开之后，保持所有启停与跨目录断言，不加重试、不改产品代码；新提交完整CI复验该用户启动顺序。

修正启动顺序后A组已通过原RPC失败点及模型矩阵，随后重启管理用例的菜单恢复超时。日志显示selector请求在04:20:20.439完成，04:20:20.453才config.updated并重建watcher/command。将该用例的手动配置编辑移至重启前，使新实例读取落盘配置；所有新增/删除/旁观endpoint及重启后菜单恢复断言保留，不引入重试或产品状态。
