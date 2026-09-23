import { expect, test } from "bun:test"
import plugin, { PLUGIN_ID } from "../src/index.js"

test("默认导出符合 v2 Promise 插件形状", () => {
  expect(plugin.id).toBe(PLUGIN_ID)
  expect(typeof plugin.setup).toBe("function")
})
