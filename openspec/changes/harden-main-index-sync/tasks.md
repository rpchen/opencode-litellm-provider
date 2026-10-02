## Implementation

- [x] 七类工具链修复及四仓库共有实现/测试同步
- [x] README、协议说明、失败语义与真实门禁边界同步

## Verification

- [ ] 当前共享回归、真实 MCP、旧实现负向控制
- [ ] 各仓库适用完整校验与精确 head CI
- [ ] CLI archive、canonical 同步、strict 与 closure

### Scenario evidence

| Scenario | 自动化入口 |
|---|---|
| CBM-RETARGET、CBM-TOTAL-BUDGET、CBM-NOT-READY | 共享 main.test 的同名用例，含 new/finish 和最终激活前进 |
| CBM-CONCURRENT-CHECKOUT、CBM-PRESERVE-WORK | 真实分支/ref/HEAD、文件字节与 git diff --cached |
| CBM-SHA-QUEUE、CBM-PUBLISH-RACE | 实际 workflow SHA group；独立发布子进程、bare Git API、乱序 CI/幂等 |
| CBM-DIRTY-BUILD、CBM-NATIVE-BASIS | 原始/隔离源码未提交修改、来源标记校验 |
| CBM-PARALLEL-CACHE、CBM-CACHE-RACE | 独立 checkout/process、真实 rename 竞争、有效/损坏/错误身份赢家 |
| CBM-PROJECT-GATE | Workspace client.test 的门禁单测与 CBM-MCP-GATE 真实 native/schema/stdio |
| CBM-SELECTED-METADATA、CBM-MISSING-METADATA、CBM-ALL-RECEIPTS | Workspace client.test 损坏/缺失/外国身份与伪造回执 |

共享实现/测试在四仓库逐字节核对。跨客户端入口由 Workspace 维护，子仓引用其实际 stdio 自动化证据，不把配置存在当作真实宿主任务拦截。
