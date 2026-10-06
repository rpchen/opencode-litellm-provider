import type { ConnectionInfo } from "@opencode/client"
import type { ModelSpec } from "../core/build.js"
import { buildModelSpecs, hasOperationalLimits, modelFingerprint, toOpenCodeModelSpec } from "../core/build.js"
import {
  createDiscoveryCacheDiagnostics,
  diagnoseModelSpecs,
  type DiscoveryDiagnostics,
} from "../core/diagnostics.js"
import {
  buildPublicationResult,
  classifyMetadataFailure,
  capturedPublicationVerdict,
  createLastKnownGoodEntry,
  decideAcknowledgement,
  groupLiteLLMDeployments,
  lastKnownGoodKey,
  nextPublishedBaseline,
  parsePublicationMemory,
  serializePublicationMemory,
  PUBLICATION_MEMORY_SCHEMA_VERSION,
  type LastKnownGoodStore,
  type PublicationMemory,
  type MetadataFailure,
  type PublishableEntry,
} from "../generated/discovery-core/index.js"
import { normalizeLiteLLMURL } from "../core/litellm.js"
import { createDiscoveryCoordinator } from "../core/refresh.js"
import {
  compareDiscoverySnapshots,
  createDiscoverySnapshot,
  endpointFingerprint,
  inspectDiscoverySnapshot,
  type DiscoverySnapshot,
} from "../core/snapshot.js"
import type { PluginOptions } from "../options.js"
import { endpointIdentity, type EndpointIdentity } from "../endpoints.js"
import type { AppliedState, ApplyErrorCategory, CredentialState } from "./endpoint-state.js"
import {
  DiscoveryError,
  fetchLiteLLMModelInfo,
  getModelsDevCatalog,
  redact,
  type FetchLike,
} from "../net/fetch.js"
import { createRegistrationView, type ProviderSnapshot, type DiscoveryStatus } from "./register.js"
import {
  catalogFactsFor,
  createPublicationState,
  summarizePublication,
  type PublicationState,
  type PublicationSummary,
} from "./publication.js"
import { buildPublicationModels } from "./models.js"

interface KeyCredential {
  type: "key"
  key: string
  configuration?: Record<string, string | number | boolean | string[]>
}

interface EventLike {
  type: string
  data?: unknown
}

export interface SyncContext {
  integration: {
    connection: {
      active(integrationID: string): Promise<ConnectionInfo | undefined>
      resolve(connection: ConnectionInfo): Promise<unknown>
    }
  }
  provider: {
    reload(): Promise<void>
  }
  event: {
    subscribe(options?: { signal?: AbortSignal }): AsyncIterable<EventLike>
  }
  storage?: {
    get(key: string): Promise<unknown>
    set(key: string, value: unknown): Promise<void>
    remove?(key: string): Promise<void>
  }
}

export interface SyncLogger {
  warn(message: string): void
  error(message: string): void
}

export interface Scheduler {
  setTimeout(callback: () => void, milliseconds: number): unknown
  clearTimeout(handle: unknown): void
}

export interface DiscoveryDependencies {
  fetchImpl?: FetchLike
  fetchLiteLLM?: typeof fetchLiteLLMModelInfo
  getModelsDev?: typeof getModelsDevCatalog
  buildModels?: typeof buildModelSpecs
  fingerprint?: typeof modelFingerprint
  logger?: SyncLogger
  scheduler?: Scheduler
}

export interface DiscoveryLoop {
  start(): Promise<void>
  trigger(forceRefresh?: boolean): Promise<void>
  dispose(): Promise<void>
}

const DISCOVERY_SNAPSHOT_STORAGE_KEY = "litellm.discovery.snapshot.v1"
const PUBLICATION_MEMORY_STORAGE_KEY = "litellm.publication.memory.v1"
const DEFAULT_ENDPOINT = endpointIdentity("default", undefined, true)

/** Storage key of an endpoint's persisted discovery snapshot (legacy default keeps the unsuffixed key). */
export function discoverySnapshotKey(endpointId: string, legacy: boolean): string {
  return legacy ? DISCOVERY_SNAPSHOT_STORAGE_KEY : `${DISCOVERY_SNAPSHOT_STORAGE_KEY}.${endpointId}`
}

/** Storage key of an endpoint's persisted publication memory (acknowledgement + regression baseline). */
export function publicationMemoryKey(endpointId: string, legacy: boolean): string {
  return legacy ? PUBLICATION_MEMORY_STORAGE_KEY : `${PUBLICATION_MEMORY_STORAGE_KEY}.${endpointId}`
}

const defaultScheduler: Scheduler = {
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** Record complete configured models as Last Known Good for future outages. */
function seedPublicationLKG(
  store: LastKnownGoodStore,
  litellmResponse: unknown,
  publishable: readonly PublishableEntry[],
  now: number,
): void {
  const groups = new Map(groupLiteLLMDeployments(litellmResponse).map((item) => [item.modelName, item]))
  for (const entry of publishable) {
    if (entry.assessment.status !== "configured") continue
    const group = groups.get(entry.spec.id)
    if (!group) continue
    try {
      store.set(
        lastKnownGoodKey(entry.spec.id),
        createLastKnownGoodEntry(
          group,
          entry.assessment.identity.selected,
          entry.spec,
          now,
          capturedPublicationVerdict(entry.assessment),
        ),
      )
    } catch {
      // Seeding is best-effort; it must never fail a discovery.
    }
  }
}

function isKeyCredential(value: unknown): value is KeyCredential {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "key" &&
    typeof (value as { key?: unknown }).key === "string"
}

function switchedForLiteLLM(event: EventLike, integrationId: string): boolean {
  if (event.type === "credential.updated") return true
  if (event.type !== "credential.switched" || typeof event.data !== "object" || event.data === null) return false
  return (event.data as { integrationID?: unknown }).integrationID === integrationId
}

function connectionIdentity(connection: ConnectionInfo, credential: KeyCredential, url: string): string {
  const connectionID = connection.type === "credential" ? connection.id : connection.name
  return `${connection.type}\u0000${connectionID}\u0000${url}\u0000${credential.key}`
}

export function createDiscoveryLoop(
  context: SyncContext,
  snapshot: ProviderSnapshot,
  options: PluginOptions,
  dependencies: DiscoveryDependencies = {},
  endpoint: EndpointIdentity = DEFAULT_ENDPOINT,
): DiscoveryLoop {
  const scheduler = dependencies.scheduler ?? defaultScheduler
  const logger = dependencies.logger ?? console
  const fetchModelInfo = dependencies.fetchLiteLLM ?? fetchLiteLLMModelInfo
  const fetchCatalog = dependencies.getModelsDev ?? getModelsDevCatalog
  const buildModels = dependencies.buildModels ?? buildModelSpecs
  const fingerprint = dependencies.fingerprint ?? modelFingerprint
  const coordinator = createDiscoveryCoordinator<{
    models: ModelSpec[]
    fingerprint: string
    diagnostics?: DiscoveryDiagnostics
    publication?: PublicationSummary
    /** Core catalog facts (availability, regression, acknowledgement input). */
    catalog?: import("../generated/discovery-core/index.js").CatalogPublication
    snapshotSpecs?: ModelSpec[]
  }>()
  const abortEvents = new AbortController()
  snapshot.audit ??= { status: "disconnected" }

  // Canonical endpoint state writers. desired and validation are owned by the
  // reconciler in index.ts; this loop owns credential and applied. When the loop
  // runs at all, the endpoint is in the active set — so a missing endpointState
  // is initialised with desired=enabled (the reconciler will re-write it on the
  // next activation transition).
  const writeCanonical = (
    patch: Partial<{ credential: CredentialState; applied: AppliedState }>,
  ): void => {
    const current = snapshot.endpointState ?? {
      endpointId: endpoint.id,
      desired: "enabled" as const,
      validation: endpoint.validation,
      credential: "unknown" as const,
      applied: { kind: "not-applied" as const },
    }
    snapshot.endpointState = {
      ...current,
      ...(patch.credential !== undefined ? { credential: patch.credential } : {}),
      ...(patch.applied !== undefined ? { applied: patch.applied } : {}),
      // desired/validation are reconciler-owned; do not mutate here.
    }
  }

  let timer: unknown
  let disposed = false
  let running: Promise<void> | undefined
  let queued = false
  let identity: string | undefined
  let lastFingerprint: string | undefined
  let persistedIdentity: string | undefined
  let persistedSnapshot: DiscoverySnapshot | undefined
  let persistedPublicationMemory: string | undefined
  let publicationMemoryLoaded = false
  let reloadPending = false
  let eventTask: Promise<void> | undefined

  const reload = async () => {
    reloadPending = true
    await context.provider.reload()
    reloadPending = false
  }

  const neutralModels = (models: readonly ModelSpec[]) =>
    models.map(({ package: _package, ...model }) => model)

  const loadPersistedSnapshot = async (
    nextIdentity: string,
    expectedEndpoint: string,
  ): Promise<DiscoverySnapshot | undefined> => {
    if (persistedIdentity === nextIdentity) return persistedSnapshot
    persistedIdentity = nextIdentity
    persistedSnapshot = undefined
    if (!context.storage) return undefined
    try {
      const raw = await context.storage.get(endpoint.legacy ? DISCOVERY_SNAPSHOT_STORAGE_KEY : `${DISCOVERY_SNAPSHOT_STORAGE_KEY}.${endpoint.id}`)
      const value = typeof raw === "string" ? JSON.parse(raw) : raw
      const inspected = inspectDiscoverySnapshot(value, expectedEndpoint)
      if (inspected.compatible) persistedSnapshot = inspected.snapshot
      return persistedSnapshot
    } catch (error) {
      logger.warn(`LiteLLM snapshot 读取失败，继续网络发现：${redact(error instanceof Error ? error.message : String(error))}`)
      return undefined
    }
  }

  const persistSnapshot = async (
    nextIdentity: string,
    value: DiscoverySnapshot,
  ): Promise<void> => {
    const unchanged =
      persistedIdentity === nextIdentity &&
      persistedSnapshot?.endpointFingerprint === value.endpointFingerprint &&
      persistedSnapshot.modelFingerprint === value.modelFingerprint
    if (unchanged) return
    if (!context.storage) {
      persistedIdentity = nextIdentity
      persistedSnapshot = value
      return
    }
    try {
      await context.storage.set(endpoint.legacy ? DISCOVERY_SNAPSHOT_STORAGE_KEY : `${DISCOVERY_SNAPSHOT_STORAGE_KEY}.${endpoint.id}`, JSON.stringify(value))
      persistedIdentity = nextIdentity
      persistedSnapshot = value
    } catch (error) {
      logger.warn(`LiteLLM snapshot 持久化失败（不影响本次发现）：${redact(error instanceof Error ? error.message : String(error))}`)
    }
  }

  const clearPersistedSnapshot = async (nextIdentity: string): Promise<void> => {
    persistedIdentity = nextIdentity
    persistedSnapshot = undefined
    if (!context.storage) return
    try {
      if (context.storage.remove) await context.storage.remove(endpoint.legacy ? DISCOVERY_SNAPSHOT_STORAGE_KEY : `${DISCOVERY_SNAPSHOT_STORAGE_KEY}.${endpoint.id}`)
      else await context.storage.set(endpoint.legacy ? DISCOVERY_SNAPSHOT_STORAGE_KEY : `${DISCOVERY_SNAPSHOT_STORAGE_KEY}.${endpoint.id}`, "null")
    } catch (error) {
      logger.warn(`LiteLLM snapshot 清理失败：${redact(error instanceof Error ? error.message : String(error))}`)
    }
  }

  /**
   * Restore the persisted publication memory (acknowledgement + regression
   * baseline) into the endpoint controller. Reporting state only: it can
   * suppress a repeated notification and mark a withdrawal as a regression,
   * and can never publish or withhold a model.
   */
  const loadPublicationMemory = async (controller: PublicationState): Promise<void> => {
    if (!context.storage) return
    try {
      const raw = await context.storage.get(publicationMemoryKey(endpoint.id, endpoint.legacy))
      if (raw === undefined || raw === null) return
      const memory = parsePublicationMemory(typeof raw === "string" ? raw : JSON.stringify(raw))
      if (!memory) return
      controller.acknowledgement = memory.acknowledgement
      for (const id of memory.published) controller.previouslyPublished.add(id)
      persistedPublicationMemory = JSON.stringify(serializePublicationMemory(memory))
    } catch (error) {
      logger.warn(`LiteLLM publication memory 读取失败，继续发现：${redact(error instanceof Error ? error.message : String(error))}`)
    }
  }

  /** Persist publication memory when it changed; failure never affects discovery. */
  const persistPublicationMemory = async (memory: PublicationMemory): Promise<void> => {
    const serialized = serializePublicationMemory(memory)
    const material = JSON.stringify(serialized)
    if (material === persistedPublicationMemory) return
    if (!context.storage) {
      persistedPublicationMemory = material
      return
    }
    try {
      await context.storage.set(publicationMemoryKey(endpoint.id, endpoint.legacy), material)
      persistedPublicationMemory = material
    } catch (error) {
      logger.warn(`LiteLLM publication memory 持久化失败（不影响本次发现）：${redact(error instanceof Error ? error.message : String(error))}`)
    }
  }

  const cancelTimer = () => {
    if (timer !== undefined) scheduler.clearTimeout(timer)
    timer = undefined
  }

  const schedule = () => {
    cancelTimer()
    if (disposed || (!snapshot.connection && !reloadPending)) return
    const retryDelay = identity ? coordinator.retryDelayMs(identity) : undefined
    timer = scheduler.setTimeout(() => {
      timer = undefined
      void trigger(false)
    }, retryDelay ?? options.pollInterval * 1000)
  }

  const removeProvider = async (status: DiscoveryStatus = "disconnected") => {
    const hadRegistration = (snapshot.ready && snapshot.connection !== undefined) || reloadPending
    snapshot.ready = false
    snapshot.connection = undefined
    snapshot.apiBaseURL = undefined
    snapshot.models = []
    snapshot.registrationView = undefined
    snapshot.audit = { status }
    snapshot.diagnostics = {
      cache: createDiscoveryCacheDiagnostics({ source: "none" }),
      note: status === "disconnected" ? "LiteLLM 尚未完成发现。" : undefined,
    }
    if (identity) coordinator.clear(identity)
    identity = undefined
    lastFingerprint = undefined
    persistedIdentity = undefined
    persistedSnapshot = undefined
    // Canonical: this endpoint is no longer applied to the runtime. Note that we
    // do NOT call writeCanonical here when the caller has already classified the
    // specific failure (config-invalid, credential-missing, auth); those callers
    // write their own categorised error before invoking removeProvider.
    if (hadRegistration) await reload()
  }

  const clearModels = async (
    connection: ConnectionInfo,
    apiBaseURL: string,
    status: "cleared-auth" | "cleared-notfound",
  ) => {
    const emptyFingerprint = fingerprint([])
    const changed = !snapshot.ready || lastFingerprint !== emptyFingerprint || reloadPending
    const view = createRegistrationView([], apiBaseURL, endpoint)
    snapshot.ready = true
    snapshot.connection = connection
    snapshot.apiBaseURL = apiBaseURL
    snapshot.models = []
    snapshot.registrationView = view
    snapshot.audit = { status }
    snapshot.diagnostics = {
      cache: createDiscoveryCacheDiagnostics({ source: "none" }),
      note: status === "cleared-auth"
        ? "LiteLLM 返回认证失败；请检查当前凭据权限。"
        : "LiteLLM model/info 端点不可用。",
    }
    if (changed) await reload()
    lastFingerprint = emptyFingerprint
  }

  const refreshOnce = async (forceRefresh: boolean) => {
    const connection = await context.integration.connection.active(endpoint.integrationId)
    if (!connection) {
      cancelTimer()
      writeCanonical({ credential: "none", applied: { kind: "not-applied" } })
      await removeProvider()
      return
    }

    const previous = snapshot.connection
    const differentConnection = previous && (
      previous.type !== connection.type ||
      (previous.type === "credential" ? previous.id : previous.name) !==
        (connection.type === "credential" ? connection.id : connection.name)
    )
    if (differentConnection) {
      const hadRegistration = snapshot.ready
      snapshot.ready = false
      snapshot.connection = connection
      snapshot.apiBaseURL = undefined
      snapshot.models = []
      snapshot.registrationView = undefined
      snapshot.audit = { status: "switching" }
      snapshot.diagnostics = {
        cache: createDiscoveryCacheDiagnostics({ source: "none", pending: true }),
        note: "连接已切换，等待新 endpoint 完成发现。",
      }
      lastFingerprint = undefined
      persistedIdentity = undefined
      persistedSnapshot = undefined
      writeCanonical({ applied: { kind: "not-applied" } })
      if (hadRegistration) await reload()
    } else if (!snapshot.ready && snapshot.audit?.status === "disconnected") {
      snapshot.audit = { status: "pending" }
      snapshot.diagnostics = {
        cache: createDiscoveryCacheDiagnostics({ source: "none", pending: true }),
        note: "等待首次网络发现。",
      }
    }

    const resolved = await context.integration.connection.resolve(connection)
    if (!isKeyCredential(resolved)) {
      logger.error("LiteLLM 活动连接没有可用的 API Key")
      writeCanonical({
        credential: "none",
        applied: { kind: "error", category: "credential-missing", at: new Date().toISOString() },
      })
      await removeProvider()
      return
    }
    writeCanonical({ credential: "stored" })

    const rawURL = endpoint.fixedBaseUrl ?? resolved.configuration?.url
    if (typeof rawURL !== "string" || rawURL.length === 0) {
      logger.error(`LiteLLM endpoint ${endpoint.id} 缺少必填地址`)
      writeCanonical({
        applied: { kind: "error", category: "config-invalid", message: "缺少必填地址", at: new Date().toISOString() },
      })
      await removeProvider()
      return
    }

    let addresses
    try {
      addresses = normalizeLiteLLMURL(rawURL)
    } catch (error) {
      logger.error(error instanceof Error ? error.message : "LiteLLM 地址无效")
      writeCanonical({
        applied: { kind: "error", category: "config-invalid", message: "地址无法规范化", at: new Date().toISOString() },
      })
      await removeProvider()
      return
    }

    const nextIdentity = connectionIdentity(connection, resolved, addresses.rootURL)
    const connectionChanged = identity !== undefined && identity !== nextIdentity
    if (connectionChanged) {
      if (identity) coordinator.clear(identity)
      const hadRegistration = snapshot.ready
      snapshot.ready = false
      snapshot.connection = connection
      snapshot.apiBaseURL = addresses.apiBaseURL
      snapshot.models = []
      snapshot.registrationView = undefined
      snapshot.audit = { status: "switching" }
      snapshot.diagnostics = {
        cache: createDiscoveryCacheDiagnostics({ source: "none", pending: true }),
        note: "endpoint 或凭据已变化，等待新结果。",
      }
      lastFingerprint = undefined
      if (hadRegistration) await reload()
    }
    identity = nextIdentity

    const expectedEndpoint = endpointFingerprint({
      endpointID: endpoint.legacy ? undefined : endpoint.id,
      baseUrl: addresses.rootURL,
      credentialKey: resolved.key,
      buildOptions: {
        contextTierCap: options.contextTierCap,
        protocolOverrides: options.protocolOverrides,
      },
    })
    const previousPersisted = await loadPersistedSnapshot(nextIdentity, expectedEndpoint)
    if (!snapshot.ready && previousPersisted) {
      const restoredModels = previousPersisted.models
        .map(toOpenCodeModelSpec)
        .filter(hasOperationalLimits)
      const restoredView = createRegistrationView(restoredModels, addresses.apiBaseURL, endpoint)
      snapshot.ready = true
      snapshot.connection = connection
      snapshot.apiBaseURL = addresses.apiBaseURL
      snapshot.models = restoredModels
      snapshot.registrationView = restoredView
      lastFingerprint = fingerprint(restoredModels)
      snapshot.audit = {
        status: "stale",
        lastSuccessfulDiscoveryAt: previousPersisted.discoveredAt,
        view: restoredView,
      }
      snapshot.diagnostics = {
        cache: createDiscoveryCacheDiagnostics({
          source: "snapshot",
          refreshedAt: Date.parse(previousPersisted.discoveredAt),
        }),
        note: "当前结果来自 endpoint-compatible 持久化快照，等待网络确认。",
      }
      // Snapshot restore is last-known-good, NOT a successful apply. Canonical
      // applied stays "not-applied" until this refresh round succeeds.
      writeCanonical({ applied: { kind: "not-applied" } })
      await reload()
    }

    try {
      const coordinated = await coordinator.refresh(
        nextIdentity,
        async () => {
          const response = await fetchModelInfo(addresses, resolved.key, dependencies.fetchImpl)
          let catalog: unknown
          let catalogFailure: MetadataFailure | undefined
          try {
            catalog = await fetchCatalog({
              fetchImpl: dependencies.fetchImpl,
              logger,
              ...(options.modelsDevUrl === undefined ? {} : { url: options.modelsDevUrl }),
            })
          } catch (error) {
            catalog = {}
            catalogFailure = classifyMetadataFailure(error)
          }
          if (dependencies.buildModels) {
            const models = buildModels(response, catalog, options)
            return { models, fingerprint: fingerprint(models) }
          }
          const controller = snapshot.publicationState ??= createPublicationState()
          if (!publicationMemoryLoaded) {
            await loadPublicationMemory(controller)
            publicationMemoryLoaded = true
          }
          const now = Date.now()
          const { models, result } = buildPublicationModels(response, catalog, options, {
            store: controller.store,
            failure: catalogFailure,
            now,
          })
          seedPublicationLKG(controller.store, response, result.publishable, now)
          // Published specs are the only persisted specs: a withheld model
          // never survives into a snapshot, and no user confirmation adds one.
          const snapshotSpecs = result.publishable
            .map((entry) => entry.spec)
            .map(toOpenCodeModelSpec)
            .filter(hasOperationalLimits)
          const diagnosed = diagnoseModelSpecs(response, catalog, options)
          const catalogFacts = catalogFactsFor(result, {
            discovered: diagnosed.diagnostics.stats.models,
            previouslyPublished: controller.previouslyPublished,
          })
          return {
            models,
            fingerprint: fingerprint(models),
            diagnostics: diagnosed.diagnostics,
            publication: summarizePublication(result, catalogFacts, catalogFailure?.kind),
            catalog: catalogFacts,
            snapshotSpecs,
          }
        },
        {
          forceRefresh,
          failurePolicy: (error) =>
            error instanceof DiscoveryError && (error.kind === "auth" || error.kind === "notfound")
              ? "clear"
              : "stale",
        },
      )
      if (disposed || identity !== nextIdentity) return

      if (coordinated.source === "stale") {
        const message = coordinated.error instanceof Error ? coordinated.error.message : String(coordinated.error)
        logger.warn(`LiteLLM 发现失败，使用 last-known-good：${redact(message, resolved.key)}`)
        if (snapshot.audit?.view) snapshot.audit = { ...snapshot.audit, status: "stale" }
        snapshot.diagnostics = {
          discovery: coordinated.value.diagnostics ?? snapshot.diagnostics?.discovery,
          publication: coordinated.value.publication ?? snapshot.diagnostics?.publication,
          cache: createDiscoveryCacheDiagnostics({
            source: "stale",
            stale: true,
            refreshedAt: coordinated.refreshedAt,
            failureCount: coordinated.failureCount,
            nextRetryAt: coordinated.nextRetryAt,
          }),
          note: "刷新失败，保留上次成功结果。",
        }
        return
      }

      const { models, fingerprint: nextFingerprint } = coordinated.value
      const persistModels = neutralModels(coordinated.value.snapshotSpecs ?? models)
      const nextPersisted = createDiscoverySnapshot(
        expectedEndpoint,
        persistModels,
        new Date(coordinated.refreshedAt).toISOString(),
      )
      if (previousPersisted) {
        const diff = compareDiscoverySnapshots(previousPersisted, nextPersisted)
        if (diff.drift) {
          logger.warn(
            `LiteLLM 发现漂移：added=${diff.added.length}, removed=${diff.removed.length}, protocol=${diff.protocolChanged.length}, capabilities=${diff.capabilityChanged.length}`,
          )
        }
      }
      const changed = !snapshot.ready || lastFingerprint !== nextFingerprint || reloadPending
      const view = changed || !snapshot.registrationView
        ? createRegistrationView(models, addresses.apiBaseURL, endpoint)
        : snapshot.registrationView
      const refreshedAtIso = new Date(coordinated.refreshedAt).toISOString()
      snapshot.ready = true
      snapshot.connection = connection
      snapshot.apiBaseURL = addresses.apiBaseURL
      snapshot.models = models
      snapshot.registrationView = view
      // Canonical `applied = active` must be written BEFORE reload(), because reload
      // triggers applyProvider which gates on canPublish(endpointState) — including
      // applied.kind === "active". Writing it after reload would mean applyProvider
      // sees the stale "not-applied" value and refuses to add the provider.
      writeCanonical({
        applied: { kind: "active", lastDiscoveryAt: refreshedAtIso, modelCount: models.length },
      })
      if (changed) await reload()
      lastFingerprint = nextFingerprint
      await persistSnapshot(nextIdentity, nextPersisted)
      snapshot.audit = {
        status: models.length === 0 ? "empty" : "ready",
        lastSuccessfulDiscoveryAt: refreshedAtIso,
        view,
      }
      // Availability facts: acknowledge only notification, record the
      // published set as the regression baseline, and remember whether to
      // surface this round. None of this can change what Core published.
      const controller = snapshot.publicationState
      let publication: PublicationSummary | undefined = coordinated.value.publication
      if (controller && coordinated.value.catalog && publication) {
        const acknowledgement = decideAcknowledgement(
          controller.acknowledgement,
          coordinated.value.catalog,
          refreshedAtIso,
        )
        controller.acknowledgement = acknowledgement.next
        const memory: PublicationMemory = {
          schemaVersion: PUBLICATION_MEMORY_SCHEMA_VERSION,
          acknowledgement: acknowledgement.next,
          // Additive for models the endpoint still serves, bounded by forgetting
          // models LiteLLM no longer returns: a withdrawal stays a regression
          // for later rounds and after a restart.
          published: nextPublishedBaseline(
            [...controller.previouslyPublished],
            models.map((model) => model.id),
            coordinated.value.catalog.withheld.map((entry) => entry.id),
          ),
        }
        controller.previouslyPublished = new Set(memory.published)
        if (acknowledgement.notify) {
          controller.pendingNotice = {
            reason: acknowledgement.reason,
            message: publication.acknowledgement.reason,
          }
        }
        publication = {
          ...publication,
          acknowledgement: {
            notify: acknowledgement.notify,
            reason: acknowledgement.reason,
            fingerprint: acknowledgement.next?.fingerprint ?? "sha256:none",
          },
        }
        await persistPublicationMemory(memory)
      }
      snapshot.diagnostics = {
        discovery: coordinated.value.diagnostics,
        publication,
        cache: createDiscoveryCacheDiagnostics({
          source: coordinated.source === "cache" ? "memory-cache" : "network",
          stale: false,
          refreshedAt: coordinated.refreshedAt,
          failureCount: coordinated.failureCount,
          nextRetryAt: coordinated.nextRetryAt,
        }),
      }
    } catch (error) {
      if (disposed || identity !== nextIdentity) return
      if (error instanceof DiscoveryError && (error.kind === "auth" || error.kind === "notfound")) {
        logger.error(redact(error.message, resolved.key))
        await clearPersistedSnapshot(nextIdentity)
        await clearModels(
          connection,
          addresses.apiBaseURL,
          error.kind === "auth" ? "cleared-auth" : "cleared-notfound",
        )
        writeCanonical({
          applied: {
            kind: "error",
            category: error.kind === "auth" ? "auth" : "network",
            at: new Date().toISOString(),
          },
        })
      } else {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn(`LiteLLM 发现失败，保留上次结果：${redact(message, resolved.key)}`)
        if (snapshot.audit?.view) snapshot.audit = { ...snapshot.audit, status: "stale" }
        const state = coordinator.state(nextIdentity)
        snapshot.diagnostics = {
          discovery: snapshot.diagnostics?.discovery,
          cache: createDiscoveryCacheDiagnostics({
            source: state.hasValue ? "stale" : "none",
            stale: state.hasValue,
            refreshedAt: state.refreshedAt,
            failureCount: state.failureCount,
            nextRetryAt: state.nextRetryAt,
            pending: state.pending,
          }),
          note: "发现失败；详细错误已通过宿主日志记录。",
        }
        // Classify into the frozen taxonomy so /litellm-diagnostics can show
        // "Enabled · Error" with a reason distinct from "Enabled · Not applied".
        const appliedCategory: ApplyErrorCategory = (() => {
          if (error instanceof DiscoveryError) {
            if (error.kind === "parse") return "parse"
            return "network"
          }
          return "network"
        })()
        writeCanonical({
          applied: { kind: "error", category: appliedCategory, at: new Date().toISOString() },
        })
      }
    } finally {
      schedule()
    }
  }

  let queuedForce = false
  const trigger = (forceRefresh = true): Promise<void> => {
    if (disposed) return Promise.resolve()
    if (running) {
      queued = true
      queuedForce ||= forceRefresh
      return running
    }

    running = (async () => {
      let nextForce = forceRefresh
      do {
        queued = false
        queuedForce = false
        try {
          await refreshOnce(nextForce)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          logger.warn(`LiteLLM 发现循环出错，将在下个周期重试：${redact(message)}`)
          schedule()
        }
        nextForce = queuedForce
      } while (queued && !disposed)
    })().finally(() => {
      running = undefined
    })
    return running
  }

  const listen = async () => {
    try {
      for await (const event of context.event.subscribe({ signal: abortEvents.signal })) {
        if (disposed) break
        if (switchedForLiteLLM(event, endpoint.integrationId)) {
          cancelTimer()
          void trigger(true)
        }
      }
    } catch (error) {
      if (!disposed) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn(`LiteLLM 连接事件订阅已停止，将依靠轮询：${redact(message)}`)
      }
    }
  }

  return {
    async start() {
      if (disposed) return
      eventTask = listen()
      await trigger(true)
    },
    trigger,
    async dispose() {
      if (disposed) return
      disposed = true
      cancelTimer()
      abortEvents.abort()
      await running
      void eventTask
    },
  }
}
