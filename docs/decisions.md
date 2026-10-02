# 方案决策记录

记录用户确认的方案与背景。初始 `add-litellm-auto-discovery` 讨论发生于 2026-09-23 ~ 09-24，已归档到 `openspec/changes/archive/2026-09-24-add-litellm-auto-discovery/`；2026-09-27 的共享 core 决策更新了源码来源和交付复验方式，其余业务规则不变。落地规格以 `openspec/specs/` 为准，本文件说明“为什么这样定”，避免重新讨论。

## 已确认的决策

| 主题 | 决策 | 背景 / 理由 |
|---|---|---|
| 接入方式 | 用户通过 `/connect` 填写自己的地址与 Key；插件不内置任何地址（~~只有一个 `litellm` provider，不做多实例~~——初始决策，已被 PR9 多 endpoint 设计取代，见下文「多 endpoint 演进」） | 插件是通用的，不绑定任何特定 LiteLLM 服务 |
| 发现所用的 Key | 用用户自己的 Key 调 `/v1/model/info` | 不同 Key 可见的模型不同；用用户 Key 才能保证列出的都能调用 |
| 模型清单来源 | 只取 `/v1/model/info` 中的真实部署；没有元数据的名字不注册 | `/v1/models`、`/model_group/info` 会列出团队白名单里已删除部署的残留名字（实测 `gpt-5.5`、`gpt-5.3-codex-spark`） |
| 协议判定 | 用户覆盖 → Anthropic 上游 / Claude 家族走 Messages → `supported_endpoints`（多个时 responses 优先）→ `mode: responses` → 其余 Chat；`supported_endpoints` 与 `mode` 冲突时以前者为准 | `supported_endpoints` 是 LiteLLM 官方的端点能力字段 |
| 不做协议探测 | **不对模型发试探请求**，只按规则判定；判错时用 `protocolOverrides` 兜底 | 选对协议只是为了尽量原样透传；LiteLLM 会做协议转换，选得不理想也能调用。逐个探测速度不可接受 |
| 推理档位 | 以 models.dev 为准：原厂记录（含 `-cn` 等备选）→ OpenCode Zen（`opencode`）→ 唯一 provider；不使用 LiteLLM 的 `supports_*_reasoning_effort` | |
| budget 类档位 | 有最大预算时生成 `high`（min(16000, max)）与 `max`；**models.dev 没写上限时也生成 `high` = 16000** | 与旧脚本不同（旧脚本没写上限时不生成）；目前 models.dev 的 Claude 都写了上限，实际不触发 |
| 上下文窗口 | 按 LiteLLM 阶梯价字段（`*_above_<N>k_tokens`、`tiered_pricing`）截断到首个阶梯点，默认开启、可关闭；**不读 Codex `models_cache.json`** | 目的是不越过价格阶梯（如 GPT 超过 272K 价格大涨） |
| 基线规则 | 保留模态信任名单（DeepSeek/Kimi/MiMo/Qwen）、完整家族表与 `-cn` 备选、`models_dev_provider` 覆盖、mode 缺失时按名字排除图像模型 | 继承 `opencode-litellm-config-sync` 行为 |
| 显示名 | 原样使用 `model_name` | 与调用名一致 |
| 验证时机 | **不做前置 spike**；宿主相关假设（协议包能否加载、表单与地址投影、`add` 整体替换、档位参数、连接变更事件）全部在最后的验收阶段确认，不符时调整实现并更新 design | 用户现在手工配置的 litellm provider 已证明 OpenCode 能连 LiteLLM、档位能生效 |
| 真实环境测试凭据 | 使用 `~/.agents/skills/opencode-litellm-config-sync/.env` 的 `LITELLM_BASE_URL` / `LITELLM_API_KEY`，只在内存中使用 | 不读 `~/.config/opencode` 里用户自己的 Key |
| 发行渠道 | 不发布 npm；公开 GitHub 仓库，默认安装 `github:rpchen/opencode-litellm-provider` | OpenCode 明确支持 Git package；普通用户无需 registry 配置或 GitHub 凭据 |
| 稳定版本 | 无 ref 安装跟随默认分支 `main`；`main` 只接受通过 required CI 的 PR；`#vX.Y.Z` 用于锁定和回滚 | 同时兼顾最简安装和可复现部署 |
| 构建产物 | `dist` 和 core provenance 随源码提交；CI 按 provenance SHA 在独立目录重建并比较未覆盖的候选产物；`build:dist` 是另一条显式更新流程，不声明精确 `scripts.build`，不依赖 `prepare` | 防止先覆盖 dist 掩盖漏交/过期产物；OpenCode 2.0.15 的 Git package 安装禁用脚本，精确 `scripts.build` 会触发 Pacote Git preparation |
| GitHub 治理 | 仓库改为 Public；功能分支开发，GitHub 规则强制 PR、required `CI`、禁止 force-push/删除，管理员不绕过 | Public 既满足公众安装，也让 GitHub Free 可启用分支保护；单维护者 approval 设为 0 |
| Release | 首个版本 `v0.1.0`；tag 校验 package version 后按既有 provenance 固定复验，创建 GitHub Release，附 `.tgz` 与 SHA-256，不 `npm publish` | tag 提供固定安装和回滚；同一 tag 不切换到后续 core/main |

## 共享 core 迁移（2026-09-27）

唯一业务维护仓库为 `rpchen/litellm-discovery-core`；Pi 和 OpenCode 是各自独立的宿主适配仓库。不合仓、不采用 submodule、不把 Git dependency `#main` 当作无视 lockfile 的更新保证。本次 PR3 只修改 OpenCode，不加入跨仓库自动触发。

开始时核验 OpenCode main 为 `96b00f5e291bb6b0e407f8bc9fa81de890cb7e79`，core main 为 `32575d4e0185ebf40fb54aa5b538a22acca4e0d3`，Pi main 为 `83d64946ca1172ae1073b18267a18cf018e64fbb`。这些是本次参考点，不是未来 main 不变的承诺。

`npm run build:dist` 解析当时 core/main 的完整 SHA，在独立临时源码目录以同一 SHA 完成类型检查、测试和 tsc 编译，自动记录到 `dist/core-provenance.json`。安装所需的 core ESM、声明及许可证随 dist 提交；宿主 SDK 沿用 peer/external，不编入 core。`prepare:core`、`typecheck`、`test`、`build:fixed` 和 `verify:dist` 使用已有 provenance；固定复验缺少有效 provenance 必须失败，不回退 main。

缓存按 SHA 隔离，拒绝暂存、未暂存和未跟踪修改，核对 Git commit 后从 Git tree/blob 导出受版本控制的源码，不能只看 HEAD 就复制工作树。`src/generated/discovery-core/` 和 `src/core/` 由构建生成并被 Git 忽略；后者只有公共入口或宿主适配转接，不维护业务实现。缓存异常不得自动 reset/clean/stash。

中立 `Protocol` 与 `ModelSpec` 从共享公共入口取得；OpenCode 所需的 `package` 和三个 SDK 路径留在 `src/host/`。HTTP、轮询、模型缓存、凭据、注册、命令和审计不搬入 core。保留旧 fixtures、快照及宿主契约，不夹带行为修改。

用户安装方式和运行时行为保持不变；安装/加载不下载 core，也不依赖平级目录、源码、构建缓存或生命周期脚本。core 更新不会改变已经发布的插件；下一次插件更新构建才纳入新代码。本次保持 OpenCode `0.1.4` 及依赖锁文件不变，不替代之后单独的发版决策。

## 多 endpoint 演进（PR9，2026-09-29）

- **Historical**：初始 `add-litellm-auto-discovery` 决策“只有一个 `litellm` provider，不做多实例”。当时插件处于起步期，先用最小形态验证单 endpoint 的接入、发现与协议判定。
- **Superseded by**：PR9（`openspec/changes/archive/2026-09-29-pr9-multi-endpoint-activation/`）。现行设计支持全局 `endpoints` 配置：每个 endpoint 是独立 integration/provider、credential 与 discovery/cache/snapshot/故障域，并提供 `/litellm-endpoints` activation 管理。
- **Current**：当前行为以 canonical OpenSpec `openspec/specs/multi-endpoint-activation/spec.md` 为最终权威；本文件中的历史决策行仅保留背景，不再代表现状。
- **Legacy 兼容**：legacy 单 endpoint 路径保留为零迁移兼容——仍映射为 endpoint `default`，沿用旧 provider/credential/snapshot identity（见 README「连接 LiteLLM」）。

## 独立审查

初始方案经过一次独立第三方对抗式审查，采纳了除“逐模型发 Responses 请求验证”以外的全部建议（该条与“不做协议探测”决策冲突，不采纳）。审查发现的已核实事实已写入原 design.md 的 Context 部分。

共享迁移另落实 Pi PR2 审查发现的两项风险：不得先覆盖候选 dist 再验收；不得把脏缓存内容与原 SHA 的 provenance 一起交付。相应正负向测试进入本仓库 CI。

## 给实施者的提示

- 先核验当前工作区和远端，再按本次 `tasks.md` 实施；共享业务修改只在独立 core 进行，宿主适配留在本仓库。
- `.tmp/` 下的历史调研文件可能已被清理，不得假设它们存在。需要上游资料时按 `docs/research/opencode-v2-plugin-api.md` 中的明确版本/来源重新获取，不把历史分支名当成永久位置。
- 兼容性验证优先复用现有脱敏 fixtures；本次迁移无需真实 LiteLLM 凭据。必须新增真实响应样本时，遵守 AGENTS 的凭据约定和白名单脱敏规则后才能入库。

## v0.2.0 发行决策（2026-09-27）

维护者在 Windows / OpenCode 2.0.16 上实测 d565084 正常后，明确授权“发版 PR → CI → 合并 → main CI → tag → GitHub Release”。v0.2.0 标记共享 core 迁移的阶段性发行，不表示引入破坏性行为，也不要求与 Pi 版本同步。历史 v0.1.4 不移动、不覆盖；不发布 npm。

发行沿用已实测实现、完整 dist 和 core provenance 32575d4e0185ebf40fb54aa5b538a22acca4e0d3，不执行更新构建。manifest 与锁文件两处根版本统一为 0.2.0，不更新依赖解析。Release 检查既有版本 tag 与三个版本字段一致；显式 dispatch 也不得选择 branch。附件上传后下载复核校验和、归档字节及解包 dist。所有验证仅在执行后记为通过，维护者实测与自动化替身测试分别说明。Pi 与 core 仓库保持不变。

## Discovery quality 与宿主发布边界（2026-09-29）

- 插件的核心目标是让 OpenCode 正确使用模型能力，不承担计费职责。protocol、context/input/output、modalities、tools、reasoning 的正确性优先于价格完整性。
- models.dev provider 选择由共享 Core 维护：canonical 原厂 → OpenRouter → OpenCode → 全局唯一记录；宿主仓库不得复制选择算法，也不得靠新增硬编码模型家族修复新模型。
- OpenRouter/OpenCode 仅作为能力 fallback 时，其价格不得覆盖 LiteLLM deployment price。
- Core 可以保留未知 limits 的 neutral model 用于 diagnostics，但 OpenCode 不得发布 `context <= 0` 或 `output <= 0` 的宿主模型。
- 任何这类边界变更必须有 Core 测试和 Core → OpenCode 纵向 adapter 测试。

## Release 与会话收尾（2026-09-29）

- 用户可见 feat/fix 合入后检查 tag/Release 是否落后于 main；release PR 同步 package/lockfile、README 当前固定版本和 release notes，并通过自动化一致性检查。
- tag 只能在目标 main commit 完整 CI 通过后创建；发布后下载附件验证 SHA-256、归档字节和解包 dist。
- OpenSpec change 只有在 tasks 与证据一致、通过 CLI archive、canonical specs 已同步并再次 strict validation 后才算 Closed。
- 下一会话开工前必须重新读取当前 main、未合并 PR、最新 tag/Release、README、dist provenance、active OpenSpec 与共享 testing-standard，不能只依赖上一会话记忆。
- 会话结束前必须做 retrospective，检查是否把具体症状提升成通用不变量、是否存在文档/代码/Release 漂移、是否残留临时 workflow/branch，并把长期经验写入权威文档。


## 开发代码索引（2026-10-02）

已显式选择索引并入库；结构查询优先使用图谱与 coverage。Release 使用固定 0.11.0/full 从不可变 tag SHA 生成附件并回读验证；用户确认客户端下次启动同步发布快照，工作图谱另按当前源码刷新。新仓库不自动索引，不改变插件运行时依赖、discovery 语义、dist/provenance 或发行授权。详细流程见 docs/codebase-memory.md。

## Claude Code OpenSpec 入口（2026-10-02）

按用户要求使用 OpenSpec CLI 1.13.2 初始化 `.claude/skills/`，提供 propose、explore、apply、update、sync、archive 六个工作流。Claude Code 的项目 skill 发现路径是 `.claude/skills/`；不依赖它识别 `.agents/skills/`。原有共享入口保留，撤销删除 Claude 必要入口的旧规则；两处由 CLI 模板生成，升级时一起审阅，禁止手工分别维护。`CLAUDE.md` 导入 `AGENTS.md`。仅增加开发工具入口，不改变产品规格或运行时行为。

## 每次合并与新任务的索引一致性（2026-10-02）

用户明确要求每次审核通过并合并的 PR 收尾时，本地与远端索引一致；任一客户端新任务先同步最新代码与索引。该要求替代此前“只按 Release 更新共享快照”的日常策略。已审核源码由 PR CI 生成候选索引，准确 merge SHA 的完整 CI 成功后发布到长期 `codebase-memory-index` 分支，以 source SHA 作为不可变目录。source main 只跟踪 selection.json，原生生成文件在移除 Git 跟踪前备份。finish 取得远端同一快照并校验全部字节，ready 才算完成；prepare 每个新任务都执行，MCP 复用连接不豁免。工作目录未完成工作保留，准备失败不冒充最新。Release 附件继续保留，产品 API/dist/provenance、版本/tag/Release 授权边界不变。

## main 索引同步审核修复（2026-10-02）

本轮修复现有四条 PR 的七类安全缺陷：最终 main 再核验、symbolic branch 保护、SHA 隔离排队、固定干净源码、缓存竞争赢家校验、MCP 项目身份门禁和已选子仓完整回执。保持每 SHA 不可变快照、现有仓库合并/保护策略和产品边界；不合并、不发版、不变更 dist/provenance。MCP 能阻止失败项目的图谱工具访问，宿主新任务的 prepare 调用和任意 shell/编辑器行为仍是文档约定，不能伪称强制拦截。详细协议、来源兼容边界与回归入口见 docs/codebase-memory.md。
