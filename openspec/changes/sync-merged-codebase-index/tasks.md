## Implementation

- [x] 显式 selection 与工作输出迁移，保留原字节备份
- [x] 四仓库 main 快照构建、完整 CI 门禁和不可变索引分支发布
- [x] prepare/finish 同步协议、source 保护、并发锁与字节校验
- [x] Workspace 四客户端 MCP 入口与每任务发现规则
- [x] README、AGENTS 与跨仓库决策同步

## Verification and closure

- [ ] 核对实际完整 main 的发布/下载字节与来源 SHA
- [ ] 核对实际 MCP 新工具发现及未完成工作保护
- [ ] 四份源码 PR 的精确提交 CI 通过
- [ ] CLI archive、canonical 同步、strict 与 closure 核对

证据写入本文件后才能关闭；source PR 合并与最终 main receipt 需要用户明确授权。
