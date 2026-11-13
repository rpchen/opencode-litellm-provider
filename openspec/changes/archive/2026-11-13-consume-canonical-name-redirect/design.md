## Decisions

唯一选择算法来自Core固定SHA。复验只读provenance，版本在更新构建前固定。旧快照可在启动阶段回放；一次成功的新实例网络发现后持久化正确额度。网络失败/认证失败/取消/endpoint隔离沿用现有策略，不新增缓存schema。

## Validation

REDIRECT-HOST固定样本验证context大于output、官方输出393216、旧快照943718被刷新替换，注册/诊断与存储一致；Pi另验证新实例restore。完整真实宿主E2E通过后合并，main CI通过再tag并核对Release附件。本地Pi最后升级发布tag、重建实例并验证真实请求。
