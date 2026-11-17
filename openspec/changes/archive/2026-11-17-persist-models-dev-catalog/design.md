## Context
现有内存目录跨重启丢失，持久化注册快照不能替代元数据输入。

## Goals / Non-Goals
持久化成功的完整公开目录，避免启动时依赖网络。保持现有名称增量发现、删除与认证边界。

## Decisions
沿用 Core normalizeModelsDevCatalog 校验，不复制模型算法。公开目录保存到用户 .cache/litellm-provider/models-dev，以 URL SHA256 分文件；注入 transport 默认隔离磁盘。临时文件加 rename 发布，磁盘不可写不影响成功发现。目录不含 endpoint 或凭据。新模型本地未命中仍请求最新目录；请求失败保留旧目录；先把本地完整匹配写入既有 LKG，再执行最新请求。失败轮按原 unavailable 路径处理，因此旧模型可由 LKG 保留，新增未命中项仍会重试，不变成稳定 unmatched。

## Risks / Trade-offs
首次安装尚无成功目录仍依赖网络。重启会重新解析本地目录，但已有匹配无需请求网络。镜像按来源隔离，不互相覆盖。
