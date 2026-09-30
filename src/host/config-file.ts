/**
 * Comment-preserving mutation of the OpenCode configuration file that declares this plugin's options
 * (`plugins[].options.endpoints`). Only the keys this module owns are edited (jsonc-parser `modify`
 * produces minimal text edits), so comments, formatting, unknown options and unrelated config survive.
 * See design.md D2/D3.
 */
import { chmodSync, existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { validateBaseUrl, validateEndpointId } from "../endpoint-input.js"

export type ConfigErrorCode =
  | "no-file" | "no-entry" | "parse" | "shape" | "duplicate" | "invalid-id" | "invalid-url"
  | "not-found" | "conflict" | "legacy-conflict" | "needs-migration" | "legacy-default"

export class ConfigFileError extends Error {
  constructor(readonly code: ConfigErrorCode, message: string) {
    super(message)
    this.name = "ConfigFileError"
  }
}

export interface ConfigTarget {
  file: string
}

const PLUGIN_NAME = "opencode-litellm-provider"

export function configCandidates(env: Record<string, string | undefined> = process.env): string[] {
  const list: string[] = []
  if (env.OPENCODE_CONFIG) list.push(env.OPENCODE_CONFIG)
  const base = env.XDG_CONFIG_HOME || join(env.HOME || env.USERPROFILE || homedir(), ".config")
  for (const name of ["opencode.jsonc", "opencode.json"]) list.push(join(base, "opencode", name))
  return [...new Set(list)]
}

type Json = unknown
const isRecord = (value: Json): value is Record<string, Json> => typeof value === "object" && value !== null && !Array.isArray(value)

/** Does this plugin entry refer to this plugin? Uses the host-reported source when available. */
export function entryMatches(spec: string, sourceTarget?: string): boolean {
  const strip = (value: string) => value.replace(/#[^#]*$/u, "").replace(/\\/gu, "/").toLowerCase()
  const normalized = strip(spec)
  if (sourceTarget && normalized === strip(sourceTarget)) return true
  return normalized.includes(PLUGIN_NAME)
}

interface Loaded {
  text: string
  root: Record<string, Json>
}

function load(file: string): Loaded {
  if (!existsSync(file)) throw new ConfigFileError("no-file", "找不到 OpenCode 配置文件")
  const text = readFileSync(file, "utf8")
  const errors: ParseError[] = []
  const root = parse(text, errors, { allowTrailingComma: true, disallowComments: false })
  if (errors.length > 0) throw new ConfigFileError("parse", "OpenCode 配置文件无法解析，已拒绝修改以免覆盖其中的内容")
  if (!isRecord(root)) throw new ConfigFileError("shape", "OpenCode 配置文件顶层不是对象，已拒绝修改")
  return { text, root }
}

function findEntry(root: Record<string, Json>, sourceTarget?: string): { index: number; isString: boolean; entry: Json } | undefined {
  const plugins = root.plugins
  if (!Array.isArray(plugins)) return undefined
  for (const [index, entry] of plugins.entries()) {
    if (typeof entry === "string" && entryMatches(entry, sourceTarget)) return { index, isString: true, entry }
    if (isRecord(entry) && typeof entry.package === "string" && entryMatches(entry.package, sourceTarget)) return { index, isString: false, entry }
  }
  return undefined
}

/** First candidate file that contains an entry for this plugin. */
export function locateConfig(
  env: Record<string, string | undefined> = process.env,
  sourceTarget?: string,
): ConfigTarget | undefined {
  for (const file of configCandidates(env)) {
    try {
      if (findEntry(load(file).root, sourceTarget)) return { file }
    } catch {
      // unreadable candidate: try the next one
    }
  }
  return undefined
}

export function readPluginOptions(target: ConfigTarget, sourceTarget?: string): Record<string, Json> {
  const { root } = load(target.file)
  const found = findEntry(root, sourceTarget)
  if (!found) throw new ConfigFileError("no-entry", "配置文件里找不到 LiteLLM 插件条目")
  return !found.isString && isRecord((found.entry as Record<string, Json>).options)
    ? ((found.entry as Record<string, Json>).options as Record<string, Json>)
    : {}
}

export type EndpointMutation =
  | { kind: "add"; id: string; baseUrl: string; migrateLegacy?: { baseUrl: string } | undefined; confirmMigration?: boolean }
  | { kind: "edit"; id: string; baseUrl: string }
  | { kind: "delete"; id: string }

export interface MutationResult {
  migratedLegacy: boolean
}

function formatting(text: string) {
  const tab = /^\t/m.test(text)
  const space = /^( +)\S/m.exec(text)?.[1]?.length ?? 2
  return { insertSpaces: !tab, tabSize: tab ? 1 : space, eol: text.includes("\r\n") ? "\r\n" : "\n" }
}

export interface WriteOptions {
  sourceTarget?: string
  rename?: (from: string, to: string) => void
  /** Test seam: runs after edits are computed and before the conflict check. */
  beforeCommit?: () => void
}

export function mutateEndpoints(target: ConfigTarget, mutation: EndpointMutation, options: WriteOptions = {}): MutationResult {
  if (mutation.kind === "add") {
    const idProblem = validateEndpointId(mutation.id)
    if (idProblem) throw new ConfigFileError("invalid-id", idProblem)
  }
  let baseUrl = ""
  if (mutation.kind !== "delete") {
    const check = validateBaseUrl(mutation.baseUrl)
    if (!check.ok) throw new ConfigFileError("invalid-url", check.message)
    baseUrl = check.value
  }

  const { text, root } = load(target.file)
  const found = findEntry(root, options.sourceTarget)
  if (!found) throw new ConfigFileError("no-entry", "配置文件里找不到 LiteLLM 插件条目；请把 LiteLLM 插件声明在该配置文件中")
  const fmt = formatting(text)
  let edited = text
  const apply = (path: (string | number)[], value: Json) => {
    edited = applyEdits(edited, modify(edited, path, value, { formattingOptions: fmt }))
  }
  const base: (string | number)[] = ["plugins", found.index]

  // A bare string entry becomes {package, options}; nothing else about it changes.
  if (found.isString) apply(base, { package: found.entry, options: {} })
  const optionsPath = [...base, "options"]
  const currentOptions = !found.isString && isRecord((found.entry as Record<string, Json>).options)
    ? ((found.entry as Record<string, Json>).options as Record<string, Json>)
    : {}
  const explicit = "endpoints" in currentOptions
  if (explicit && !isRecord(currentOptions.endpoints)) throw new ConfigFileError("shape", "options.endpoints 必须是对象，已拒绝修改")
  const endpoints = explicit ? (currentOptions.endpoints as Record<string, Json>) : {}
  let migrated = false

  if (mutation.kind === "add") {
    if (mutation.id in endpoints) throw new ConfigFileError("duplicate", `Endpoint ID ${mutation.id} 已存在`)
    if (explicit) {
      apply([...optionsPath, "endpoints", mutation.id], { baseUrl })
    } else {
      const legacy = mutation.migrateLegacy
      if (legacy && !mutation.confirmMigration) throw new ConfigFileError("needs-migration", "需要把现有单 endpoint 配置迁移为 endpoints.default")
      if (isRecord(currentOptions.protocolOverrides) && Object.keys(currentOptions.protocolOverrides).length > 0 && !legacy && mutation.id !== "default") {
        throw new ConfigFileError("legacy-conflict", "配置含有没有地址的顶层 protocolOverrides，无法安全迁移；请先手工修正")
      }
      const created: Record<string, Json> = {}
      if (legacy) {
        if (mutation.id === "default") throw new ConfigFileError("duplicate", "Endpoint ID default 已存在（现有单 endpoint 配置）")
        created.default = {
          baseUrl: legacy.baseUrl,
          ...(currentOptions.protocolOverrides !== undefined ? { protocolOverrides: currentOptions.protocolOverrides } : {}),
        }
        created[mutation.id] = { baseUrl }
        migrated = true
      } else {
        created[mutation.id] = {
          baseUrl,
          ...(mutation.id === "default" && currentOptions.protocolOverrides !== undefined ? { protocolOverrides: currentOptions.protocolOverrides } : {}),
        }
      }
      if ("protocolOverrides" in currentOptions) apply([...optionsPath, "protocolOverrides"], undefined)
      apply([...optionsPath, "endpoints"], created)
    }
  } else {
    if (!explicit) {
      throw new ConfigFileError("legacy-default", "默认 endpoint 来自单 endpoint 连接配置（/connect 时填写的地址）；请用 /connect 重新连接来更换地址，或先新增一个 endpoint 迁移为多 endpoint 配置")
    }
    if (!(mutation.id in endpoints)) throw new ConfigFileError("not-found", `Endpoint ${mutation.id} 不存在`)
    if (mutation.kind === "edit") {
      if (!isRecord(endpoints[mutation.id])) throw new ConfigFileError("shape", `Endpoint ${mutation.id} 配置不是对象，已拒绝修改`)
      apply([...optionsPath, "endpoints", mutation.id, "baseUrl"], baseUrl)
    } else {
      apply([...optionsPath, "endpoints", mutation.id], undefined)
    }
  }

  const errors: ParseError[] = []
  parse(edited, errors, { allowTrailingComma: true })
  if (errors.length > 0) throw new ConfigFileError("parse", "生成的配置无法解析，已中止写入")

  options.beforeCommit?.()
  const latest = existsSync(target.file) ? readFileSync(target.file, "utf8") : ""
  if (latest !== text) throw new ConfigFileError("conflict", "配置文件在读取后被外部修改，已中止写入以免覆盖；请重试")

  const mode = statSync(target.file).mode & 0o777
  const tmp = `${target.file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`
  try {
    writeFileSync(tmp, edited, "utf8")
    try { chmodSync(tmp, mode) } catch { /* best effort on platforms without POSIX modes */ }
    ;(options.rename ?? renameSync)(tmp, target.file)
  } catch (error) {
    rmSync(tmp, { force: true })
    throw error
  }
  return { migratedLegacy: migrated }
}

export { dirname }
