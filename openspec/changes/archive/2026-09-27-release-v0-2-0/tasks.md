## 1. 准备
- [x] 1.1 核对远端 main、既有分支/PR、发行约定及工具能力。
- [x] 1.2 建立本变更；固定已实测源码、dist 和 core SHA。

## 2. 实施
- [x] 2.1 同步 manifest 与 lockfile 根版本为 0.2.0；依赖解析不变。
- [x] 2.2 更新发行说明、README 和维护者实测记录，不夸大验证范围。
- [x] 2.3 新增固定 tag 显式发行入口、版本元数据检查与九项回归测试、上传附件复核。

## 3. 验证与收尾
- [x] 3.1 完整 CI 通过：原 LiteLLM fixtures/快照、类型检查、固定 dist、干净环境、外部安装、TUI 与 OpenSpec strict。
- [x] 3.2 src/dist/provenance 与实测提交完全相同；lockfile 仅两行根版本变更；一次性准备 workflow 不在最终 diff。
- [x] 3.3 同步 distribution 主规格并归档变更；归档后的最终 CI 由 PR checks 再次验收，成功前不得合并。

## Validation Notes

实现提交 `9f1512b389ddfcf310f3e1a1c3bc0968b9440450` 的完整 CI [36326047391](https://github.com/rpchen/opencode-litellm-provider/actions/runs/36326047391) 成功，已读取 job `108638894423` 的完整日志。Node.js 22.14.0、Bun 1.3.10、锁定的 TypeScript 5.8.2；113 项 Bun 测试、原 1 个快照、408 次断言；34 项 Node 回归（25 项交付 + 9 项版本）、0 失败/跳过/todo；54 个 dist 文件固定复验一致。两种工作区外消费者均禁用生命周期脚本，加载实际 peer/SDK，验证 10 个模型、3 个 SDK 和两个入口。TUI、无缓存外部固定构建及改动/缺失/多余 dist 负向测试均通过。在途变更和主规格 strict 为 9 passed / 0 failed；归档后主规格需由最终 CI 重验。

本地仅运行可用 Node 的九项纯版本检查；完整锁定工具链实际在 GitHub Actions 执行。Windows / OpenCode 2.0.16 实测为维护者反馈，和自动化 host context/HTTP 替身检查分开记录。没有取得逐模型/逐协议或全平台手动验收证据，也没有读取个人凭据。

## Operational Checklist

归档是本次发版准备的源码/规格收尾，不代表尚未发生的外部发布操作已完成。最终提交 CI、合并 PR、main CI、创建 v0.2.0 tag、Release workflow 与附件下载校验的后续实际结果记录在 PR #20 / Release 中；旧提交成功不能替代这些门禁。不得移动旧 tag、不更新 core/main、不发布 npm。
