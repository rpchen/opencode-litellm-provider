## Why

Core PR #41 已修复同名记录显式canonical关系的选型，但插件必须更新提交的dist才会生效。用户授权两个插件更新、合并及发版，并升级本地Pi验证。

## What Changes

编入Core main `90adfe8b0cde94ece261867997990b6f36d3e984`，不复制选择算法；新增真实公开形态的刷新/旧快照回归，同步版本、README、release notes与同类官方pro记录的冻结oracle。

## Impact

Core→adapter顺序；Pi使用现有refreshModels/registerProvider/credential和diagnostics接口，OpenCode使用现有sync/registration/diagnostics接口，不改变SDK契约。真实宿主以本轮CI解析并固定的latest版本为准，无新增运行时依赖。
