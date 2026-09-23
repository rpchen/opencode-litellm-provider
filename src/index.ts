import { Plugin } from "@opencode/plugin"

export const PLUGIN_ID = "litellm"

/**
 * 占位入口：仅完成插件注册，不做任何发现。
 * 发现 / 协议路由 / 模型能力 / 变更刷新由后续 openspec 变更实现。
 */
export default Plugin.define({
  id: PLUGIN_ID,
  setup() {},
})
