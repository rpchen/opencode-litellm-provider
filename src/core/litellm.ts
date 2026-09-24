export interface LiteLLMAddresses {
  rootURL: string
  apiBaseURL: string
  modelInfoURL: string
  legacyModelInfoURL: string
}

export interface LiteLLMDeployment {
  modelName: string
  litellmParams: Record<string, unknown>
  modelInfo: Record<string, unknown>
  sourceIndex: number
}

export interface DeploymentGroup {
  modelName: string
  deployments: LiteLLMDeployment[]
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

export function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function positiveInteger(value: unknown): number | undefined {
  const number = optionalNumber(value)
  return number !== undefined && number > 0 ? Math.floor(number) : undefined
}

export function stripRoutePrefix(model: string): string {
  const separator = model.indexOf("/")
  return separator === -1 ? model : model.slice(separator + 1)
}

export function normalizeLiteLLMURL(input: string): LiteLLMAddresses {
  const trimmed = input.trim()
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error("LiteLLM 地址必须是有效的 http 或 https URL")
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("LiteLLM 地址必须使用 http 或 https")
  }
  if (url.username || url.password) {
    throw new Error("LiteLLM 地址不得包含用户名或密码")
  }

  url.search = ""
  url.hash = ""
  let pathname = url.pathname.replace(/\/+$/, "")
  if (pathname.toLowerCase().endsWith("/v1")) pathname = pathname.slice(0, -3)
  pathname = pathname.replace(/\/+$/, "")
  url.pathname = pathname || "/"

  const rootURL = url.toString().replace(/\/$/, "")
  return {
    rootURL,
    apiBaseURL: `${rootURL}/v1`,
    modelInfoURL: `${rootURL}/v1/model/info`,
    legacyModelInfoURL: `${rootURL}/model/info`,
  }
}

function isConversational(modelName: string, modelInfo: Record<string, unknown>): boolean {
  const mode = optionalString(modelInfo.mode)
  if (mode !== undefined) return mode === "chat" || mode === "responses"

  const normalizedName = modelName.toLowerCase()
  return !(
    normalizedName.startsWith("gpt-image") ||
    normalizedName.startsWith("dall-e") ||
    normalizedName.includes("image")
  )
}

export function groupLiteLLMDeployments(input: unknown): DeploymentGroup[] {
  if (!isRecord(input) || !Array.isArray(input.data)) return []

  const groups = new Map<string, DeploymentGroup>()
  for (const [sourceIndex, raw] of input.data.entries()) {
    if (!isRecord(raw)) continue
    const modelName = optionalString(raw.model_name)
    if (!modelName) continue

    const litellmParams = isRecord(raw.litellm_params) ? raw.litellm_params : {}
    const modelInfo = isRecord(raw.model_info) ? raw.model_info : {}
    if (!isConversational(modelName, modelInfo)) continue

    const deployment: LiteLLMDeployment = {
      modelName,
      litellmParams,
      modelInfo,
      sourceIndex,
    }
    const group = groups.get(modelName)
    if (group) group.deployments.push(deployment)
    else groups.set(modelName, { modelName, deployments: [deployment] })
  }

  return [...groups.values()]
}
