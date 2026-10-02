## Context

用户授权四客户端日常使用既有索引，选择在工具启动时同步最新 Release。Core 和 adapters 的业务职责不变。

## Goals / Non-Goals

发布图谱必须绑定已检出的不可变 tag SHA；工作图谱必须匹配本地检出代码。不得自动选择新仓库、修改用户 checkout/branch、使用真实服务凭据或给插件添加运行时依赖。

## Decisions

固定工具 0.11.0 和 full 模式；上传原生压缩图谱、metadata、含 SHA-256 的 release manifest。上传后按 GitHub tag 实际 commit 回读校验。同步以仓库/commit 分目录保存，源码与 Release 版本不同也不会互相覆盖。云端不写本机；客户端启动完成在线补齐，离线失败保留旧缓存并重试。

与现有规格差异：只新增开发和发布附件约定，不改变 LiteLLM /v1/model/info fixtures、协议/能力/价格或宿主映射，不重新构建 dist。

## Risks / Trade-offs

旧 Release 没有图谱附件时跳过下载，不回填历史 Release。代码图谱并不保证完整覆盖；代理仍需检查 coverage 和当前源码。云端发布执行须等待本 PR 合入及下一次授权发行。

## Migration Plan

已有索引入库；维护者显式安装用户级四客户端入口。后续 Release 自动带附件。无需真实 LiteLLM 凭据，现有宿主 E2E 继续由 CI 运行。
