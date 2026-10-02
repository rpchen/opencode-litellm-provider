## Context

此前 tracked 原生 artifact 被每次 watcher/refresh 重写；旧快照又只按 Release 分发。合并 SHA 只有合并后才存在，不能让包含快照的源码提交记录自身 SHA。

## Goals / Non-Goals

Goals: 每个 main 合并提交有不可变索引；finish 本地/远端字节一致；新任务先最新代码和对应索引；四客户端共用协议。
Non-goals: 自动选择新仓库、改产品 SDK/dist/Core API、自动合并 source PR、发产品 tag/Release、清理用户工作。

## Decisions

1. Git 专用索引分支持久保存 snapshots/<source-SHA>，避免 Actions 附件过期，源码 main 不混入生成文件。完整 main CI 与成员关系是发布前置条件；API ref 只 fast-forward，有并发重试，不覆盖同 SHA。
2. selection.json 是显式启用标记；artifact/db 是本机工作文件。不可变本地缓存保留云端三文件原始字节，工作图谱可因本机路径和 watcher 变化。
3. prepare 先 fetch 和校验索引，再安全 fast-forward；只有已合并的干净分支可以回 main。未完成工作 mode=resume 保留；new/finish 失败不算 ready。
4. 每个新任务使用 MCP prepare，而非只依赖 MCP 进程初始化；finish 还核对远端 blob 内容。仓库锁避免并发 checkout。
5. 索引分发是开发工具链，不是 discovery Core 业务依赖；插件 dist/provenance 保持现状。

## Migration

迁移前备份并校验 artifact/db，git rm --cached 保留文件；客户端安装副本由现有安装器原始字节备份。新源码 PR 审核、CI 与显式合并授权独立。

## Verification

CI 继续既有测试并对实际审核源码执行原生 build；准确 main CI 后 publish 回读 blob 校验。实现证据以本次 PR CI、实际发布/下载结果、prepare/finish receipt 和真实 MCP tools/list 为准，不以配置存在代替宿主可调用。
