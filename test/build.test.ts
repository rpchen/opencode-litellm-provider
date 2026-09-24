import { describe, expect, test } from "bun:test"
import litellm from "./fixtures/litellm-model-info.json" with { type: "json" }
import modelsDev from "./fixtures/models-dev.json" with { type: "json" }
import { buildModelSpecs, modelFingerprint } from "../src/core/build.js"

const options = { contextTierCap: true, protocolOverrides: {} }

describe("模型构建", () => {
  test(
    "完整 fixture 输出稳定排序并形成快照",
    () => {
      const models = buildModelSpecs(litellm, modelsDev, options)
      expect(models.map((model) => model.id)).toEqual([...models.map((model) => model.id)].sort())
      expect(models).toMatchSnapshot()
    },
    15000,
  )

  test("显示名原样使用 model_name", () => {
    const models = buildModelSpecs(litellm, modelsDev, options)
    const model = models.find((item) => item.id === "gpt-5.5")
    expect(model?.name).toBe("gpt-5.5")
  })

  test("相同输入指纹相同，任一字段变化则不同", () => {
    const models = buildModelSpecs(litellm, modelsDev, options)
    const first = modelFingerprint(models)
    expect(modelFingerprint(structuredClone(models))).toBe(first)

    const changed = structuredClone(models)
    changed[0]!.name = "changed"
    expect(modelFingerprint(changed)).not.toBe(first)
  })
})
