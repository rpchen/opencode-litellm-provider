## Context

发行基线为 d565084c065e048cf53597f9ff9f529107d1a121；其 main CI 36323934825 成功。实际 core 为 32575d4e0185ebf40fb54aa5b538a22acca4e0d3。维护者确认 OpenCode 2.0.16 在 Windows 上加载该插件提交，并对所列实测项目反馈正常。旧 lockfile 顶层为 0.1.2、根包为 0.1.3，而 manifest 为 0.1.4；只修正自身版本，不重新解析依赖。

## Goals / Non-Goals

- Goals：发行 v0.2.0；保留实测字节与 provenance；通过现有 PR/main/tag 门禁；提供准确的安装说明和附件。
- Non-Goals：不更新 core/main、依赖、宿主逻辑或 fixtures；不发布 npm；不做跨仓库联动；不读取个人凭据。

## Decisions

1. `src`、`dist`（含 provenance）与实测基线保持相同 Git tree；固定复验只重建到独立临时目录。业务行为与原基线无差异，网络降级、缓存、轮询与凭据规则不变。
2. package.json、package-lock.json 顶层和 packages[""] 的 version 统一为 0.2.0。除新增发行验证测试命令外，不修改 manifest 依赖；lockfile 仅两行根版本变化。
3. 新增开发期纯函数校验 release refType/refName 与三个版本字段；Node 正负向测试加入 test:delivery。branch（包括名为 v0.2.0 的 branch）、缺失字段和不一致版本均失败。
4. 现有 tag-push Release 保留；显式 workflow_dispatch 必须选择既有版本 tag，不能选择 main。所有模式使用同一 workflow 的安装、固定 SHA 复验、测试和打包步骤，不刷新 core。
5. 当前已认证连接不能直接创建 tag 或 dispatch，且终端不可联网。只在本仓库一次性隔离分支中使用 Actions 临时 GITHUB_TOKEN 完成获授权的版本编辑 / tag 创建 / dispatch；不导出 token，不要求 PAT。由 GITHUB_TOKEN 创建 tag 不会递归触发 push workflow，因此显式 dispatch 同一 Release workflow。临时辅助 workflow 不合并到 main。
6. Release 上传完成后下载 .tgz 与校验文件，验证 SHA-256、与本次本地打包字节相同、解包 dist 与已验证候选一致。没有额外 npm 发布步骤。

## Risks / Trade-offs

维护者实测反馈不是代理亲自操作宿主，未提供完整日志或每个模型的记录，不能扩大成全协议 / 全平台验收。已存在的 engine/deprecation/audit 警告不在本次升级依赖处理。显式发布入口增加了维护能力，但 ref / version 校验和固定产物门禁不能绕过。若 main 前移或已有 tag 指向其他提交，停止而不是强制覆盖。

## Migration Plan

规格先行 → 版本、文档与门禁实施 → PR CI → 同步主规格并归档 → 最终 PR CI → squash 合并 → main CI → 新建 v0.2.0 → 同一 Release workflow → 校验附件和目标提交。各阶段只在检查成功后继续；发版后不移动 tag。

## Open Questions

无。本次版本与发布操作已获维护者明确授权。
