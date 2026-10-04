/**
 * Server-side endpoint management behind `/litellm-endpoints`: Add / Edit / Delete against the OpenCode
 * config file that declares this plugin, plus the legacy → explicit migration. Credentials are handled by
 * the TUI through the host's own client API (keys never pass through this plugin's RPC). See design.md.
 */
import type { EndpointActivation } from "../endpoints.js"
import { activeEndpointIds } from "../endpoints.js"
import { parseOptions, type PluginOptions } from "../options.js"
import {
  ConfigFileError,
  locateConfig,
  mutateEndpoints,
  readPluginOptions,
  type ConfigTarget,
  type EndpointMutation,
} from "./config-file.js"
import {
  canRetry,
  statusLabel,
  userVisibleStatus,
  type EndpointState,
} from "./endpoint-state.js"
import type { EndpointManagement, EndpointViewItem } from "./endpoint-command.js"
import type { ProviderSnapshot } from "./register.js"
import { discoverySnapshotKey } from "./sync.js"

const QUIET = { warn() {} }

export interface ManagerHost {
  env: Record<string, string | undefined>
  options(): PluginOptions
  ids(): string[]
  activation(): EndpointActivation
  /** Persist activation and reconcile the running runtime immediately. */
  setActivation(next: EndpointActivation): Promise<void>
  /** Dispose the running runtime and rebuild it from `next`. */
  rebuild(next: PluginOptions): Promise<void>
  /** Address stored with the active legacy `litellm` connection, if any. */
  legacyBaseUrl(): Promise<string | undefined>
  removeStorage(key: string): Promise<void>
  sourceTarget(): Promise<string | undefined>
  /** Canonical per-endpoint state snapshots, keyed by endpoint id (always defined for configured ids after reconcile). */
  snapshots(): ReadonlyMap<string, ProviderSnapshot>
  /** Reach into the discovery loop and force a refresh for one endpoint (Retry entry). */
  triggerEndpoint(endpointId: string): Promise<{ ok: boolean; message?: string }>
  /** Test seam for the config writer. */
  write?: { rename?: (from: string, to: string) => void; beforeCommit?: () => void }
  /** Injected config file (tests); production locates it from env + host plugin source. */
  target?: ConfigTarget
}

type Outcome = { ok: boolean; code?: string; message?: string; migrated?: boolean; saved?: boolean }

const fail = (code: string, message: string): Outcome => ({ ok: false, code, message })
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createEndpointManagement(host: ManagerHost): EndpointManagement {
  let problem: string | undefined
  let located = false
  /** Legacy default's address (kept in the /connect credential); resolved on every refresh. */
  let legacyUrl: string | undefined

  const normalize = (raw: unknown) => JSON.stringify(parseOptions(raw, QUIET))

  const locate = async (): Promise<ConfigTarget | undefined> => {
    const target = host.target ?? locateConfig(host.env, await host.sourceTarget())
    located = target !== undefined
    return target
  }

  /** Read the canonical file, flag shadowed/unreadable configs, and sync the runtime to hand edits. */
  async function refresh(): Promise<void> {
    problem = undefined
    legacyUrl = undefined
    const target = await locate()
    if (!target) {
      problem = "找不到声明了 LiteLLM 插件的配置文件（OPENCODE_CONFIG 或全局 opencode.jsonc）；请在其中声明插件后再管理 endpoint"
      return
    }
    let fileOptions: Record<string, unknown>
    try {
      fileOptions = readPluginOptions(target, await host.sourceTarget())
    } catch (error) {
      problem = messageOf(error)
      return
    }
    legacyUrl = host.options().endpoints === undefined ? await host.legacyBaseUrl() : undefined
    const running = JSON.stringify(host.options())
    const fromFile = normalize(fileOptions)
    if (running === fromFile) return
    if (!synced) {
      problem = "当前生效的插件 options 与全局配置文件不一致（可能来自内联或项目配置），endpoint 管理为只读"
      return
    }
    await host.rebuild(parseOptions(fileOptions, QUIET))
  }
  // Until the first successful comparison we do not know the file is what the host runs.
  let synced = false
  const initial = async () => {
    if (synced) return
    const target = await locate()
    if (!target) return
    try {
      synced = normalize(readPluginOptions(target, await host.sourceTarget())) === JSON.stringify(host.options())
    } catch {
      synced = false
    }
  }

  const writable = async (): Promise<Outcome | undefined> => {
    await initial()
    await refresh()
    return problem ? fail("readonly", problem) : undefined
  }

  const currentEndpoints = (): EndpointViewItem[] => {
    const options = host.options()
    const snapshotMap = host.snapshots()
    const canonicalFor = (id: string): EndpointState | undefined => snapshotMap.get(id)?.endpointState
    const active = new Set(activeEndpointIds(host.ids(), host.activation()))
    // Legacy default is not a config entry: its address lives in the /connect credential. With no
    // connected address there is no endpoint at all — do not show a ghost "default" row.
    if (options.endpoints === undefined) {
      if (!legacyUrl) return []
      const canonical = canonicalFor("default")
      return [{
        id: "default",
        baseUrl: legacyUrl,
        legacy: true,
        active: active.has("default"),
        state: canonical,
        status: canonical ? userVisibleStatus(canonical) : undefined,
        statusLabel: canonical ? statusLabel(userVisibleStatus(canonical)) : undefined,
        canRetry: canonical ? canRetry(canonical) : false,
      }]
    }
    return Object.entries(options.endpoints).map(([id, definition]) => {
      const canonical = canonicalFor(id)
      const baseUrl = definition.validation?.kind === "invalid"
        ? (definition.invalidBaseUrl ?? definition.baseUrl)
        : definition.baseUrl
      return {
        id,
        baseUrl,
        legacy: false,
        active: active.has(id),
        state: canonical,
        status: canonical ? userVisibleStatus(canonical) : undefined,
        statusLabel: canonical ? statusLabel(userVisibleStatus(canonical)) : undefined,
        canRetry: canonical ? canRetry(canonical) : false,
      }
    })
  }

  /**
   * The endpoint definitions that really exist right now: explicit config entries, or legacy `default`
   * only while its /connect credential carries an address. Runtime-internal ids (always `["default"]`
   * in legacy mode) must NOT drive activation: a ghostless legacy has no `default` to activate.
   */
  const configuredIds = (): string[] => {
    const options = host.options()
    if (options.endpoints !== undefined) return Object.keys(options.endpoints)
    return legacyUrl ? ["default"] : []
  }

  const materializeActivation = async (exclude?: string) => {
    // Pin the active set over the real configured definitions (without the excluded id) so newly added
    // endpoints start inactive and stale/ghost identities are never written into activation.
    const next = activeEndpointIds(configuredIds(), host.activation()).filter((id) => id !== exclude)
    const current = host.activation()
    const same = current.mode === "selected" &&
      current.endpointIds.length === next.length && next.every((id) => current.endpointIds.includes(id))
    if (!same) await host.setActivation({ mode: "selected", endpointIds: next })
  }

  const write = async (target: ConfigTarget, mutation: EndpointMutation) =>
    mutateEndpoints(target, mutation, { sourceTarget: await host.sourceTarget(), ...host.write })

  const afterWrite = async (target: ConfigTarget) => {
    await host.rebuild(parseOptions(readPluginOptions(target, await host.sourceTarget()), QUIET))
  }

  return {
    refresh: async () => { await initial(); await refresh() },
    endpoints: currentEndpoints,
    writable: () => ({
      writable: problem === undefined && located,
      ...(problem ? { problem } : {}),
      legacyMigration: host.options().endpoints === undefined,
    }),

    async add(input) {
      const blocked = await writable()
      if (blocked) return blocked
      const target = (await locate())!
      const previousActivation = host.activation()
      let pinned = false
      let configWritten = false
      try {
        const legacy = host.options().endpoints === undefined
        const address = legacy ? legacyUrl : undefined
        // New endpoints start inactive: pin the current active set (without the new id) before writing.
        await materializeActivation(input.endpointId)
        pinned = true
        const result = await write(target, {
          kind: "add",
          id: input.endpointId,
          baseUrl: input.baseUrl,
          ...(address ? { migrateLegacy: { baseUrl: address } } : {}),
          confirmMigration: input.confirmMigration === true,
        })
        // The config mutation is committed from here on: never roll the activation back.
        configWritten = true
        if (result.migratedLegacy) await host.removeStorage(discoverySnapshotKey("default", true)).catch(() => {})
        await afterWrite(target)
        return { ok: true, migrated: result.migratedLegacy }
      } catch (error) {
        if (!configWritten) {
          // Before commit: a failed Add must not leave the activation permanently materialised as "selected".
          let rollbackFailure = ""
          if (pinned) {
            try {
              await host.setActivation(previousActivation) // also reconciles the runtime back
            } catch (rollbackError) {
              rollbackFailure = `; activation 回滚失败：${messageOf(rollbackError)}`
            }
          }
          const primary = error instanceof ConfigFileError ? fail(error.code, error.message) : fail("error", messageOf(error))
          return rollbackFailure ? { ...primary, message: `${primary.message}${rollbackFailure}` } : primary
        }
        // After commit the endpoint definition is persisted: keep the materialised activation so the new
        // endpoint stays inactive (restoring the previous "all" would auto-activate it on the next rebuild).
        return {
          ok: false,
          saved: true,
          code: "rebuild-failed",
          message: `endpoint 配置已保存，但运行时重新加载失败；新 endpoint 保持未启用，可稍后重试 reload：${messageOf(error)}`,
        }
      }
    },

    async migrate() {
      const blocked = await writable()
      if (blocked) return blocked
      if (host.options().endpoints !== undefined) return { ok: true, migrated: false } // already explicit
      const target = (await locate())!
      try {
        const address = await host.legacyBaseUrl()
        if (!address) return fail("not-found", "没有可迁移的 legacy 地址（当前没有已连接的 LiteLLM endpoint）")
        const result = await write(target, { kind: "migrate", baseUrl: address })
        await afterWrite(target)
        await host.removeStorage(discoverySnapshotKey("default", true)).catch(() => {})
        return { ok: true, migrated: result.migratedLegacy }
      } catch (error) {
        if (error instanceof ConfigFileError) return fail(error.code, error.message)
        return fail("error", messageOf(error))
      }
    },

    async edit(input) {
      const blocked = await writable()
      if (blocked) return blocked
      const target = (await locate())!
      try {
        await write(target, { kind: "edit", id: input.endpointId, baseUrl: input.baseUrl })
        await afterWrite(target)
        return { ok: true }
      } catch (error) {
        if (error instanceof ConfigFileError) return fail(error.code, error.message)
        return fail("error", messageOf(error))
      }
    },

    async prepareRemove(input) {
      const blocked = await writable()
      if (blocked) return blocked
      if (host.options().endpoints === undefined) {
        return fail("legacy-default", "默认 endpoint 仍是 legacy 单 endpoint 配置；请先迁移到可管理配置")
      }
      if (!currentEndpoints().some((entry) => entry.id === input.endpointId)) return fail("not-found", `Endpoint ${input.endpointId} 不存在`)
      try {
        // Stop the endpoint (loop, provider, discovery) and drop its persisted snapshot; definition stays.
        await materializeActivation(input.endpointId)
        await host.removeStorage(discoverySnapshotKey(input.endpointId, false))
        return { ok: true }
      } catch (error) {
        return fail("error", messageOf(error))
      }
    },

    async remove(input) {
      const blocked = await writable()
      if (blocked) return blocked
      const target = (await locate())!
      try {
        await write(target, { kind: "delete", id: input.endpointId })
        await afterWrite(target)
        await materializeActivation(input.endpointId)
        await host.removeStorage(discoverySnapshotKey(input.endpointId, false)).catch(() => {})
        return { ok: true }
      } catch (error) {
        if (error instanceof ConfigFileError) return fail(error.code, error.message)
        return fail("error", messageOf(error))
      }
    },

    async trigger(input) {
      // Retry / 重新应用: only meaningful for enabled endpoints that are not currently active.
      const current = currentEndpoints().find((item) => item.id === input.endpointId)
      if (!current) return fail("not-found", `Endpoint ${input.endpointId} 不存在`)
      const canonical = current.state
      if (canonical) {
        if (canonical.desired !== "enabled") return fail("invalid-state", `Endpoint ${input.endpointId} 未启用，无需重新应用`)
        if (canonical.validation.kind === "invalid") return fail("invalid-state", `Endpoint ${input.endpointId} 配置非法，请先修改 Base URL`)
        if (canonical.applied.kind === "active") return { ok: true, message: `Endpoint ${input.endpointId} 已是已生效状态` }
      }
      const result = await host.triggerEndpoint(input.endpointId)
      if (!result.ok) return fail("error", result.message ?? `重新应用 ${input.endpointId} 失败`)
      return { ok: true }
    },
  }
}
