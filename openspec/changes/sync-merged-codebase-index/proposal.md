## Why

用户要求每次审核通过并合并 PR 后，本地与远端索引一致；下一客户端新任务先取得最新代码与同一源码 SHA 的索引。现有 Release-only 分发和入库工作输出不能满足。

## What Changes

- 显式选择改为入库 selection.json，原生 artifact/database 作为被忽略的工作输出，原文件备份后仅解除 Git 跟踪。
- 准确 main SHA 的完整 CI 成功后生成索引，长期追加到 codebase-memory-index 专用分支；不可覆盖已有 SHA。
- prepare/finish 协议及四客户端 MCP 工具校验源码、远端快照和本地字节；准备失败不冒充 ready。
- 保留 Release 附件流程与未完成工作，不改变产品 runtime、公共 API、dist/provenance 或版本。

## Capabilities

### Modified Capabilities
- codebase-memory: 从按 Release 下载扩展到每个合并 SHA 的索引分发与任务准备/收尾。

## Impact

四仓库的开发脚本、CI、AGENTS、文档；客户端入口由 workspace 维护。其他三个仓库同名 change 互相引用；脚本各仓库独立运行。
