## 1. 测试样本与配置

- [x] 1.1 编写 fixture 生成脚本 `scripts/make-fixtures.ts`：从实测 `/v1/model/info` 响应中**按白名单**只保留插件读取的字段（`model_name`、`litellm_params.model`、`litellm_params.custom_llm_provider`，以及 `model_info` 中的 `mode`、`base_model`、`litellm_provider`、`models_dev_provider`、`supported_endpoints`、`max_*`、`supports_*`、`*_cost_*`、`tiered_pricing`），把 `model_name` 以外的标识替换为占位值，输出到 `test/fixtures/`。样本覆盖 chat / responses / embedding / image_generation、272k 与 512k 阶梯、db 部署（无路由前缀，带 `custom_llm_provider`）；另手写补充 Anthropic 部署、Bedrock 上的 Claude、带 `supported_endpoints` 的部署、`tiered_pricing` 部署、mode 缺失的图像模型、同名多部署、字段类型异常的部署。验证：测试断言 fixtures 中不存在 `api_base`、`litellm_credential_name`、`tags`、`access_via_team_ids`、`access_groups`、`id`、`api_key` 键，且不含形如 `sk-` 的字符串
- [x] 1.2 在 `test/fixtures/` 中加入精简的 models.dev 样本：openai、anthropic、zai、zhipuai、moonshotai、moonshotai-cn、minimax（含 `MiniMax-M3` 大写 id）、xiaomi、alibaba、opencode 等相关条目，包含 effort / toggle / budget_tokens（有 max 与无 max）三类 `reasoning_options`、`release_date`，以及一个多个转售商共有的 id。验证：文件可解析，且测试中引用到
- [x] 1.3 实现 `src/options.ts`：解析轮询间隔（下限 30s）、阶梯截断开关、协议覆盖；非法项回退默认值并给出 warn。验证：`test/options.test.ts` 覆盖默认值、下限钳制、非法值回退
- [x] 1.4 把 `package.json` 的 `peerDependencies["@opencode/plugin"]` 改为 `>=2.0.15 <2.1`，删除非标准的 `engines.opencode` 字段。验证：`npm install` 通过且 `package.json` 中版本范围与 design 一致

## 2. 发现核心（纯函数，不依赖宿主）

- [x] 2.1 实现 `core/litellm.ts`：地址规范化（`/v1`、末尾斜杠、仅允许 http/https）、部署按 `model_name` 聚合、过滤非对话 mode、mode 缺失时按名字排除图像模型、异常字段按“未提供”处理。验证：单测覆盖 spec“地址规范化”“非 http(s) 地址”“以真实部署作为模型清单”“只注册对话模型”“空结果与异常数据”的场景
- [x] 2.2 实现 `core/protocol.ts`：按判定顺序输出协议，包括 Anthropic 上游与 Claude 家族、多协议时 responses 优先、`supported_endpoints` 优先于 `mode`、无效声明被忽略、多部署不一致时回退 chat、用户覆盖；协议到包名的映射表集中在此（先用 design D3 的首选包）。验证：单测逐条覆盖 specs/protocol-routing 的全部场景
- [x] 2.3 实现 `core/capabilities.ts`：能力、模态、上限、价格映射（每 token → 每百万 token），null 回退规则，模态信任名单，多部署保守合并，阶梯截断（`*_above_Nk_tokens` 与 `tiered_pricing`，可关闭）。验证：单测覆盖“多部署模型的能力合并”“能力字段映射”“按价格阶梯截断上下文”“显示名与价格”的场景，其中 fixtures 中的 gpt 系列截断为 272000、minimax-m3 截断为 512000
- [x] 2.4 实现 `core/modelsdev.ts`：家族 → 原厂及备选识别、`models_dev_provider` 覆盖、候选 id 顺序与大小写不敏感匹配、记录选择（原厂 / 备选 → opencode → 唯一 provider，禁止模糊匹配）、variants 生成（effort / budget_tokens / toggle，按协议写入 D4 的选项键）、`release_date`。验证：单测覆盖 spec“models.dev 记录选择”“推理档位来源”的全部场景
- [x] 2.5 实现 `core/build.ts`：组合为 `ModelSpec[]`，输出稳定排序，并提供稳定序列化的指纹函数。验证：基于完整 fixtures 的快照测试；相同输入的指纹相同，改动任一字段则指纹变化

## 3. 网络与宿主适配

- [x] 3.1 实现 `net/fetch.ts`：带超时的 GET（LiteLLM 15s、models.dev 60s），不跟随重定向，把错误分类为 network / auth / notfound / ratelimit / server / parse / redirect，统一脱敏（Key → `sk-***`），不记录响应体；`/v1/model/info` 返回 404 时回退 `/model/info`。验证：单测用 mock fetch 覆盖各分类与 404 回退，并断言错误信息与日志中不含 Key 明文和响应体
- [x] 3.2 实现 models.dev 进程内共享缓存（6 小时有效，失败后 60 秒退避）。验证：单测覆盖缓存命中、失败降级（返回空目录，不抛错）、退避期内不重复请求
- [x] 3.3 实现 `host/register.ts`：integration 注册（key 方式 + 必填 `url` 字段），以及 `ModelSpec[]` → `ProviderEditor.add` 整体写入（`integrationID`、`sourceConnection`、provider 级 `settings.baseURL`、模型级 `package`、以 `Model.Info.default` 为底合成完整 `Model.Info`）；无连接或首次发现未成功时不写入。验证：用手写的 fake `ProviderEditor` / `IntegrationEditor` 做单测，断言写入字段完整、未写入 Key、旧模型在下一次 `add` 后消失
- [x] 3.4 实现 `host/sync.ts`：发现循环，包括启动发现、轮询、订阅 `credential.switched` / `credential.updated` 并用 `connection.active` 复核、并发合并、指纹比较后才 reload、失败分类处理（保留 / 清空 / 空清单）。验证：用 fake 时钟 + fake ctx 做单测，覆盖 specs/change-sync 与 litellm-connection 中“切换连接”“断开连接”的场景
- [x] 3.5 实现 `src/index.ts`：读取 options，启动发现循环，setup 返回的 cleanup 负责停止轮询、取消事件订阅、释放注册。验证：单测断言 cleanup 后不再发起请求

## 4. 集成验收与文档

> 真实环境验收统一使用 `~/.agents/skills/opencode-litellm-config-sync/.env` 中的 `LITELLM_BASE_URL` 与 `LITELLM_API_KEY`：运行时读取，只在内存中使用，不写入仓库、fixtures、日志或验收记录。不对发现到的模型逐个发请求。
> 验收中发现宿主行为与 design 假设不符时（协议包无法加载、表单字段或地址投影不符、`add` 整体替换不生效、档位参数未进入请求、连接变更事件不可用等），先调整实现使其满足 spec，再同步修改 design.md；只有 spec 本身无法满足时，才暂停与用户确认。

> 2026-09-24 验收范围调整：用户决定本轮不要求管理员实际新增/删除模型，等首次真实发生后如有问题再反馈迭代；本轮以轮询增删单测覆盖该路径，并在真实环境完成断网、无效 Key 与恢复连接验证。验收记录不得把延期项表述为已实测。

- [x] 4.1 `bun run typecheck && bun test && bun run build` 全部通过。验证：命令输出
- [x] 4.2 在真实 opencode 2.0.15 中加载构建产物，通过 `/connect` 连接 LiteLLM：模型列表与 `/v1/model/info` 中的对话模型一致；chat、responses、messages（若有 Claude 部署）协议各发一条消息成功；带档位的模型能切换档位且请求中带上对应参数；阶梯截断后的上下文在模型信息中可见。验证：结果记录到 `docs/research/acceptance-notes.md`
- [x] 4.3 验证变更同步：单测覆盖轮询发现模型新增与删除；真实环境临时调短轮询间隔，验证断开网络时模型保留、换成无效 Key 后旧模型撤下、恢复有效连接后模型恢复。管理员实际增删按上述用户决定延期至首次真实发生。验证：记录到 acceptance-notes
- [x] 4.4 更新 README：安装方式、连接步骤、插件配置项说明（含 `protocolOverrides` 用法）、从 `opencode-litellm-config-sync` 迁移的步骤。验证：README 包含以上各节

## 5. GitHub 可安装包

> 2026-09-24 发行范围更新：用户决定不发布 npm，使用公开 GitHub 仓库分发；无 ref 的 Git package 跟随经过 PR/CI 保护的稳定 `main`，版本 tag 用于锁定和回滚。OpenCode 安装 Git package 时禁用 lifecycle scripts，因此 `dist` 必须随源码提交。

- [x] 5.1 更新 package metadata：版本设为 `0.1.0` 并同步 lockfile；增加跨平台 clean build、package smoke 和全量 OpenSpec strict validation 脚本；OpenSpec CLI 固定为 devDependency，不增加运行时依赖或安装 lifecycle scripts。验证：`npm ci` 通过，package 与 lockfile 根版本、peer 范围一致
- [x] 5.2 调整 `.gitignore` 并从干净目录构建、跟踪完整 `dist/**`；构建必须先清理旧产物。验证：exports 指向的 JS/d.ts 存在，重复 clean build 后 tracked/untracked `dist` 均无差异
- [x] 5.3 实现隔离 package smoke：`npm pack` 文件清单含 package metadata、README、LICENSE 和 dist 入口；consumer 以 `--ignore-scripts` 安装 tarball并通过 package exports import。验证：测试不读取凭据、不连接 LiteLLM，`bun run test:package` 通过

## 6. CI、发布与协作文档

- [x] 6.1 新增 PR/main GitHub Actions CI：锁定 Actions SHA 和 Bun 版本，最小 `contents: read` 权限，稳定 job 名 `CI`，执行 typecheck、tests、clean build、dist 一致性、OpenSpec strict validation 与 package smoke；`push main` 追加远端 Git commit 安装 smoke。验证：workflow 静态检查通过，本地等价命令全部通过
- [x] 6.2 新增 `v*.*.*` Release workflow：tag/package version 必须一致，重跑门禁，生成 `.tgz` 与 SHA-256 并创建 GitHub Release；仅授予 `contents: write`，不执行 `npm publish`、不要求 npm token/PAT/LiteLLM 凭据。验证：workflow 静态检查与本地打包/checksum 等价流程通过
- [x] 6.3 更新 README、`CONTRIBUTING.md`、PR 模板与决策记录：默认 GitHub 安装、tag 固定/回滚、Public 仓库、分支开发、Conventional Commits、OpenSpec-first、required CI、dist 同步和无密钥要求。验证：所有插件配置示例使用 GitHub spec；LICENSE 保持 MIT 且进入 tarball

## 7. 本地与 GitHub 发行验收

- [x] 7.1 运行全部本地门禁：`npm ci`、typecheck、67+ 单测、clean build、package smoke、OpenSpec `--all --strict`、dist diff、pack dry-run、diff check 与完整历史/工作树敏感信息审计。验证：全部通过且未发现需要在公开前处理的秘密
- [ ] 7.2 将仓库改为 Public，推送功能分支并创建 PR；等待 `CI` 通过后配置无管理员绕过的默认分支 ruleset（必须 PR、required `CI`、最新 main、禁止 force-push/删除，approval=0）。验证：API 显示 Public、ruleset active、main protected，PR 受 required check 约束
- [ ] 7.3 required CI 通过后 squash merge；确认 `push main` CI 通过，并在隔离 consumer/隔离 OpenCode 配置中用无 ref GitHub spec 安装和加载插件。验证：`github:rpchen/opencode-litellm-provider` 在禁用 lifecycle scripts 时可用，不读取 LiteLLM 凭据
- [ ] 7.4 在通过 main CI 的提交上创建 `v0.1.0`，确认 Release workflow 成功、`.tgz` 与 checksum 正确，并以 `#v0.1.0` 安装/import。验证：GitHub Release 实际存在，tag 安装可用，npm registry 未发布
- [ ] 7.5 将 CI、ruleset、无 ref 安装、tag 安装和 Release 实测结果写入 `docs/research/acceptance-notes.md`，确认新增任务无延期或伪报后再归档 change。验证：第二轮收尾 PR 通过相同 required CI，OpenSpec strict validation 通过
