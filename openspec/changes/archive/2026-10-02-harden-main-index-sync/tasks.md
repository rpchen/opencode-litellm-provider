## Implementation

- [x] 七类工具链修复及四仓库共有实现/测试同步
- [x] README、协议说明、失败语义与真实门禁边界同步

## Verification

- [x] 当前共享回归、真实 MCP、旧实现负向控制
- [x] 各仓库适用完整校验与精确 head CI
- [x] CLI archive、canonical 同步、strict 与 closure（归档后门禁再次执行）

### Scenario evidence

| Scenario | 自动化入口 |
|---|---|
| CBM-RETARGET、CBM-TOTAL-BUDGET、CBM-NOT-READY | 共享 main.test 的同名用例，含 new/finish 和最终激活前进 |
| CBM-CONCURRENT-CHECKOUT、CBM-PRESERVE-WORK | 真实分支/ref/HEAD、文件字节与 git diff --cached |
| CBM-SHA-QUEUE、CBM-PUBLISH-RACE | 实际 workflow SHA group；独立发布子进程、bare Git API、乱序 CI/幂等 |
| CBM-DIRTY-BUILD、CBM-NATIVE-BASIS | 原始/隔离源码未提交修改、来源标记校验 |
| CBM-PARALLEL-CACHE、CBM-CACHE-RACE | 独立 checkout/process、真实 rename 竞争、有效/损坏/错误身份赢家 |
| CBM-WORKSPACE-BUDGET | Workspace client.test 正数预算过期后不执行下一根目录、不转零预算 |
| CBM-COMMON-MUTEX | main.test 两个实际 linked worktree 共用 common dir 锁、超时与 Git 状态不变 |
| CBM-CACHE-RETRY | main.test 暂时 EPERM 两次后实际 rename 成功，永久 EACCES 失败 |
| CBM-PROJECT-GATE | Workspace client.test 的门禁单测与 CBM-MCP-GATE 真实 native/schema/stdio |
| CBM-SELECTED-METADATA、CBM-MISSING-METADATA、CBM-ALL-RECEIPTS | Workspace client.test 损坏/缺失/外国身份与伪造回执 |

共享实现/测试在四仓库逐字节核对。跨客户端入口由 Workspace 维护，子仓引用其实际 stdio 自动化证据，不把配置存在当作真实宿主任务拦截。

实施源码 CI 已逐个核对：Core ec790ee、OpenCode 20cd9b6、Pi 59037f7 均通过；两个真实宿主 E2E 通过。Workspace 7e9b0e1 的 53 条测试与真实 MCP 热更新通过。最后清理重试/归档提交仍执行最终精确 head CI，不复用旧 head 结果作为最终验收。
