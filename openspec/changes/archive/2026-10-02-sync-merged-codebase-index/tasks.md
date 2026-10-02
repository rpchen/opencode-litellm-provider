## Implementation

- [x] 显式 selection 与工作输出迁移，保留原字节备份
- [x] 四仓库 main 快照构建、完整 CI 门禁和不可变索引分支发布
- [x] prepare/finish 同步协议、source 保护、并发锁与字节校验
- [x] Workspace 四客户端 MCP 入口与每任务发现规则
- [x] README、AGENTS 与跨仓库决策同步

## Verification and closure

- [x] 核对实际完整 main 的发布/下载字节与来源 SHA
- [x] 核对实际 MCP 新工具发现及未完成工作保护
- [x] 四份源码 PR 的精确提交 CI 通过
- [x] CLI archive、canonical 同步、strict 与 closure 核对

证据写入本文件后才能关闭；source PR 合并与最终 main receipt 需要用户明确授权。

实际证据：四个 base main 分别为 6f78d50/78a4204/e9a89eb/6a08cfb，完整 CI 36999584966/36999573239/37001013286/37001048940，真实 native 构建/publish 后回读 blob 成功。MCP 实际 tools/list 为 19，new 在未合并分支拒绝，resume 保留四仓库源代码与分支；Pi 0.99.2 原生 extension loader 发现两新工具且 index_status ready。首轮 PR 精确提交 CI：Workspace 80365a6（37008325677）、Core b9ba6e2（37008344050）、OpenCode fd2f61a（37008357549，真实宿主 E2E 成功）、Pi 81f8a21（37008370017，真实宿主 E2E 成功）。本 change 实施完成；最终授权合并后的 receipt 是每次 PR 的收尾协议，不能以当前 base main 证据替代未来 merge SHA 验证。

归档后 strict validation 成功，closure 在归档入库后以真实 Git ancestry 证明先后顺序，0 mismatches / 0 ambiguous histories。
