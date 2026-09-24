import { mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"

const DIRECT_MODEL_INFO_KEYS = new Set([
  "mode",
  "base_model",
  "litellm_provider",
  "models_dev_provider",
  "supported_endpoints",
  "tiered_pricing",
])

const MODEL_INFO_KEY_PATTERNS = [/^max_/, /^supports_/, /_cost_/]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function keepModelInfoKey(key: string): boolean {
  return DIRECT_MODEL_INFO_KEYS.has(key) || MODEL_INFO_KEY_PATTERNS.some((pattern) => pattern.test(key))
}

function cloneJsonValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value
  }
  if (Array.isArray(value)) return value.map(cloneJsonValue)
  if (!isRecord(value)) return undefined

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key, cloneJsonValue(item)] as const)
      .filter((entry): entry is readonly [string, unknown] => entry[1] !== undefined),
  )
}

export function sanitizeModelInfoFixture(input: unknown): { data: Record<string, unknown>[] } {
  const deployments = isRecord(input) && Array.isArray(input.data) ? input.data : []
  const data: Record<string, unknown>[] = []

  for (const item of deployments) {
    if (!isRecord(item) || typeof item.model_name !== "string") continue

    const output: Record<string, unknown> = { model_name: item.model_name }
    if (isRecord(item.litellm_params)) {
      const litellmParams: Record<string, unknown> = {}
      for (const key of ["model", "custom_llm_provider"] as const) {
        if (typeof item.litellm_params[key] === "string") {
          litellmParams[key] = item.litellm_params[key]
        }
      }
      if (Object.keys(litellmParams).length > 0) output.litellm_params = litellmParams
    }

    if (isRecord(item.model_info)) {
      const modelInfo = Object.fromEntries(
        Object.entries(item.model_info)
          .filter(([key]) => keepModelInfoKey(key))
          .map(([key, value]) => [key, cloneJsonValue(value)] as const)
          .filter((entry): entry is readonly [string, unknown] => entry[1] !== undefined),
      )
      if (Object.keys(modelInfo).length > 0) output.model_info = modelInfo
    }

    data.push(output)
  }

  return { data }
}

async function main(): Promise<void> {
  const [, , inputName, outputName = "test/fixtures/litellm-model-info.json"] = process.argv
  if (!inputName) {
    throw new Error("用法：bun scripts/make-fixtures.ts <原始响应.json> [输出.json]")
  }

  const inputPath = resolve(inputName)
  const outputPath = resolve(outputName)
  const input = JSON.parse(await Bun.file(inputPath).text()) as unknown
  const fixture = sanitizeModelInfoFixture(input)
  await mkdir(dirname(outputPath), { recursive: true })
  await Bun.write(outputPath, `${JSON.stringify(fixture, null, 2)}\n`)
  console.log(`已写入 ${fixture.data.length} 个脱敏部署：${outputPath}`)
}

if (import.meta.main) await main()
