# Design

沿用现有 connectionIdentity 判断，在 connectionChanged 撤下模型时将 applied 设置为 not-applied。失败后由已有错误处理设置 error；不改变兼容快照的离线保留逻辑。
