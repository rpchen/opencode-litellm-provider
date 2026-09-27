## Context

开始时核验：OpenCode main 为 `96b00f5e291bb6b0e407f8bc9fa81de890cb7e79`；core main 为 `32575d4e0185ebf40fb54aa5b538a22acca4e0d3`；Pi main 为 `83d64946ca1172ae1073b18267a18cf018e64fbb`。后二者与已验收参考点一致。

现有编译器为 tsc，两个公开入口为 dist/index.js 与 dist/tui.js，安装依赖预提交 dist。共享 ModelSpec 去掉宿主 package；Protocol 在公共入口导出。宿主网络、刷新、凭据和审计不是 core 责任。

## Goals / Non-Goals

迁移逻辑的唯一维护来源，保持输出兼容并实现可复验交付。非目标：业务规则变化、宿主 SDK 升级、合仓、submodule、Git #main 运行时依赖或跨仓库联动。

## Decisions

### 公共入口与宿主边界

独立 core 的完整 src 在构建时生成到被 Git 忽略的 `src/generated/discovery-core`，不改写源码；消费其 index.js 公共入口。OpenCode 的薄适配器为中立 ModelSpec 增加 SDK package。Protocol 从共享公共入口导入，保留 options 的类型重导出兼容现有调用方。旧本地 core 实现删除。`src/core/*.ts` 仅在准备阶段生成无业务逻辑的转接文件，保持既有宿主和测试导入路径：中立 API 转接公共入口，build/package 转接宿主薄适配器。此目录被 Git 忽略，不维护实现副本；原 fixtures、快照、断言和宿主调用方均无需改动。

### 更新与固定输入

`build:dist` 显式解析 core/main 一次，获取完整 SHA，并在独立临时源码目录以该 SHA 完成类型检查、单元测试及 tsc 编译；防止并行工作区准备改写本次输入。`build:fixed`、`prepare:core` 和 `verify:dist` 读取 dist/core-provenance.json；缺失、无效或来源不匹配直接失败，不回退 main。provenance 仅包含公开仓库 URL、分支与完整 SHA，无时间戳、凭据和本机路径。

### 缓存与源码真实性

每个 SHA 使用独立缓存。任何已有缓存必须先检查 staged、unstaged、untracked 状态，不能用 checkout/reset 清除异常。随后核对 commit，并直接从该 commit 的 Git tree/blob 导出源码，避免工作树污染与检查/复制之间的竞态。只允许普通文件，拒绝符号链接、submodule 及路径越界。源码准备不读取用户 Key。

### 原产物验收

verify:dist 保留候选 dist，在独立临时目录复制插件源码和编译配置，使用 provenance SHA 重新获取 core，沿用锁定的 tsc 和宿主依赖编译。比较完整文件/目录集合及字节；改动、缺失、多余或符号链接均失败。临时目录始终清理，验证不改写候选 dist。CI/Release 随后打包和安装的仍是候选产物。

### 安装与边界

core 作为普通 ESM 和类型声明编进现有 dist 树；宿主 SDK 保持既有 peer/external 约定。无 prepare/install/build 生命周期下载。外部消费者在工作区以外用 npm install --ignore-scripts 安装 tgz，独立进程确认模块解析来自消费者，执行实际入口和初始化契约。测试替身或实际宿主的边界分别报告。

### 与既有行为基线的差异

| 差异 | 理由 |
| --- | --- |
| 无业务行为差异；core ModelSpec 不带 package，宿主薄适配器补回 | 保持共享 core 中立和既有 OpenCode 输出 |
| 开发构建需 Git 访问独立 core；固定缓存可离线复用 | 构建期解析源码，不改变用户安装/运行行为 |
| 固定复验不再跟随 main | 同一提交/tag 的产物必须可复验 |

网络请求、HTTP 降级、模型缓存、轮询/刷新触发和凭据约定均原样保留。本次不修改 fixtures/快照来隐藏不兼容；出现变化必须先解释和修复。

## Risks / Trade-offs

更新构建需要 Git 和可达的 GitHub；固定复验在已有干净 SHA 缓存时不需解析远端 main。core API 后续不兼容会在下次显式更新构建的类型检查/测试中失败，而不会改变已发布插件。

## Migration Plan

先记录本变更，再实施生成源码、宿主薄适配和交付测试。验收后同步主规格并归档。版本保持当前 OpenCode 版本，迁移 PR 不代替独立发版决策；不更改依赖集合或锁文件中的版本。

## Validation Environment

当前对话终端初始没有源码工作区、Bun 或 GitHub CLI，GitHub/npm DNS 解析失败；GitHub 已认证连接可读取仓库。实际执行的本地/远端验证将分别记录，未运行项不能记为通过。
