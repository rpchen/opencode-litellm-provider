# PR3 共享 core 迁移验收记录

日期：2026-09-27。范围仅为 `rpchen/opencode-litellm-provider`，PR 为 [#19](https://github.com/rpchen/opencode-litellm-provider/pull/19)。Pi/core 仅只读参考；本次不合并、不打 tag、不创建 Release、不发布 npm。

## 输入与版本

| 输入 | 本次已核验的提交 |
|---|---|
| OpenCode main 基线 | `96b00f5e291bb6b0e407f8bc9fa81de890cb7e79` |
| 独立 core/main 与产物 provenance | `32575d4e0185ebf40fb54aa5b538a22acca4e0d3` |
| Pi PR2 已合并参考 | `83d64946ca1172ae1073b18267a18cf018e64fbb` |
| 完整实现验收提交 | `dc83ecf3e258a156bdc6d65ad5e6d44556018751` |

OpenCode 版本保持 `0.1.4`，依赖与 lockfile 未改。仍使用 tsc，入口为 `dist/index.js` 与 `dist/tui.js`；共享 core 的普通 ESM/声明/许可证随 dist 提交，宿主 SDK 不打包。

## 已执行的 CI 验证

完整实现的 [CI run 36320877915](https://github.com/rpchen/opencode-litellm-provider/actions/runs/36320877915) 已成功，job `108624335889`。执行工具链：Node.js 22.14.0、Bun 1.3.10、锁定的 TypeScript 5.8.2，`npm ci` 安装项目依赖。后续文档和归档提交会重跑同一 CI；其最终状态见 PR checks，不能把本记录中的实现提交成功当作其他提交成功。

| 实际命令 | 结果 |
|---|---|
| `npm run verify:dist` | 54 个已提交文件与按 provenance SHA 独立重建的结果逐字节一致；未先覆盖候选 dist |
| `npm run test:delivery` | 25 通过、0 失败、0 跳过、0 todo |
| `npm run typecheck` | 完整仓库锁定工具链检查通过 |
| `npm test` | 113 通过、0 失败，18 个文件，1 个快照，408 次 expect 调用 |
| `npm run test:tui-render` | 渲染、鼠标操作、latest 恢复和活跃轮询通过 |
| `npm run test:distribution` | 外部干净目录固定构建通过；正常 verify 通过；改动、缺失、多余文件均明确因产物不一致失败，且未修复/覆盖候选 |
| `npm run validate:spec` | 在途变更及主规格严格校验：8 通过、0 失败；归档后由最终提交重验主规格 |
| `npm run test:package` | 外部消费者 tgz 安装、入口初始化、模型契约通过，生命周期脚本禁用 |
| `PACKAGE_SPEC=github:rpchen/opencode-litellm-provider#dc83ecf3e258a156bdc6d65ad5e6d44556018751 npm run test:package` | 远端固定 Git commit 的外部安装与相同初始化契约通过 |
| 最终 Git 检查 | dist、fixtures、快照未被测试改写，无多余 dist 文件，无受 Git 管理的 src/core 或生成 core 源码 |

首轮 CI run `36320682340` 的产物复验及 25 项 Node 回归已通过，但新增适配测试未收窄 `find()` 的空值，完整 typecheck 失败。随后增加显式缺失检查修复，不引入强制类型转换或弱化断言；上述第二轮完整 CI 已通过。

## 行为兼容与本地验证

本地环境没有完整工作区依赖/Bun，终端不能解析 GitHub/npm；经认证 GitHub 连接读取确切源码，并按 Git blob SHA 核对原 core、共享 core 和两个既有 fixtures。未声称完整本地 typecheck/build/Bun/安装通过。

本地可执行的 Node 回归为 25/25 通过。以可用 TypeScript 5.8.3 严格编译纯 core/适配层后，对迁移前后执行以下八个场景：原 fixtures 开启阶梯截断、关闭截断、覆盖三种协议、models.dev 不可用、空 catalog、部署倒序、空部署、异常响应结构。八个场景的模型字段、JSON 属性输出顺序和模型指纹全部一致。该纯逻辑检查不替代 CI 的锁定编译器和完整宿主测试。

原 `test/fixtures` 与 `test/__snapshots__/build.test.ts.snap` 未修改；原有 109 项 Bun 测试保留，新加四项适配边界测试，合计 113。宿主网络/轮询/注册/审计源码未因迁移改写，Protocol 类型来自共享公共入口，package 由宿主薄适配补回。

## 缓存与产物负向验证

测试只污染各自系统临时目录中的 Git fixture，不修改真实 core 工作缓存。覆盖无效 SHA、缺失/无效/符号链接 provenance、固定选择不解析 main、main 前移时选定 SHA 不变、干净缓存、暂存/未暂存/未跟踪修改拒绝、错误 HEAD、未完成缓存拒绝，以及 Git 工作树隐藏标记下仍只导出原 commit 字节。忽略的文件不进入源码导出；受版本控制的符号链接不被接受。

真实集成测试启动独立进程运行 build/verify CLI；干净构建无平级仓库、预生成 core 或已有 core 缓存，但复用本次锁定的开发工具链。修改、删除和添加 dist 文件分别失败，错误必须是 dist mismatch，不能用网络/编译失败冒充负向测试成功。已提交候选产物始终保持原样。

## 安装与真实宿主的验证边界

消费者在源码工作区以外的系统临时目录创建，禁用安装脚本，不继承工作区模块路径/预加载捷径，并在独立进程确认真实模块路径位于消费者。tgz 和远端 Git 两次安装都逐一比对 54 个安装文件的 SHA-256；加载默认/TUI 两个入口，调用 setup/cleanup，检查 10 个模型、三个实际 SDK 入口、协议、能力、价格、限制、推理、连接及清理行为。安装内容不含源码、构建脚本或 core 缓存；加载时不会下载 core。

`@opencode/plugin@2.0.15` 与三个 SDK 均来自实际 npm 安装，**host context 与 HTTP 使用测试替身和原脱敏 fixtures**，且意外网络请求立即失败。这证明外部安装交付及适配初始化契约，不证明真实 OpenCode CLI/Desktop/TUI 会话与真实 LiteLLM 对话。本环境无真实 OpenCode 宿主，此类手动验证未执行；没有读取或要求用户 Key，没有修改用户配置。

## 非迁移范围的提示

锁定依赖安装输出已有的 Node engine/deprecation/audit 警告，但未阻止本次完整 CI。没有为使迁移通过而升级宿主 SDK、改写 lockfile、执行 audit fix 或夹带业务修正。Release workflow 的固定复验逻辑已调整，实际 Release/tag/npm publish 未执行。

## 后续维护者真实宿主反馈（2026-09-27）

PR #19 合并后，维护者在 Windows / OpenCode 2.0.16 上从固定 v0.1.4 切换到无后缀 Git 来源，执行更新后提供 plugin list 输出：

```text
ID       VERSION  SOURCE
litellm  d565084  github:rpchen/opencode-litellm-provider
```

随后维护者针对模型列表、推理档位、常用模型实际对话和 /litellm-audit-export 这些验收项明确反馈“已验证，正常”，并授权按 v0.2.0 发版。实测实现为 d565084c065e048cf53597f9ff9f529107d1a121，core 为 32575d4e0185ebf40fb54aa5b538a22acca4e0d3；合并后的 main CI run 36323934825 也已成功。

这补充了前文实施时未执行真实宿主验证的历史记录；来源是维护者反馈，不是代理亲自操作宿主。没有提供逐模型/逐协议/全平台验证记录，不据此扩大验收范围；没有收集真实服务地址、Key 或私人绝对路径。v0.2.0 准备只更新版本、发行门禁与文档，保留上述源码、dist 和 provenance，不重新取得 core/main。
