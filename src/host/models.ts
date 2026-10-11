import {
  buildModelSpecs as discoverModelSpecs,
  buildPublicationResult,
  hasOperationalLimits as coreHasOperationalLimits,
  modelFingerprint as discoveryFingerprint,
  type BuildOptions,
  type BuildPublicationOptions,
  type ModelSpec as DiscoveryModelSpec,
  type PublishableEntry,
  type PublicationResult,
} from "../generated/discovery-core/index.js"
import { PROTOCOL_PACKAGES } from "./protocol.js"

export type { BuildOptions } from "../generated/discovery-core/index.js"

/** OpenCode-only SDK package; all model semantics remain Core-owned. */
export interface ModelSpec extends DiscoveryModelSpec { package: string }

export function toOpenCodeModelSpec(spec: DiscoveryModelSpec): ModelSpec {
  return { ...spec, package: PROTOCOL_PACKAGES[spec.protocol] }
}

/** Map Core's configured partition without re-deriving capabilities. */
export function toOpenCodeModelSpecWithPublication(entry: PublishableEntry): ModelSpec {
  return toOpenCodeModelSpec(entry.spec)
}

export const hasOperationalLimits = coreHasOperationalLimits

export function buildModelSpecs(
  litellmResponse: unknown,
  modelsDevCatalog: unknown,
  options: BuildOptions,
): ModelSpec[] {
  return discoverModelSpecs(litellmResponse, modelsDevCatalog, options)
    .filter(hasOperationalLimits)
    .map(toOpenCodeModelSpec)
}

export interface PublicationModels {
  readonly models: ModelSpec[]
  readonly result: PublicationResult
}

/**
 * Partition discovery through the Core publication policy and map only
 * publishable entries (configured and configured-lkg) to host shapes, keeping the operational-limits guard as
 * defense in depth. Blocked models never reach the returned list.
 */
export function buildPublicationModels(
  litellmResponse: unknown,
  modelsDevCatalog: unknown,
  options: BuildOptions,
  publication: BuildPublicationOptions = {},
): PublicationModels {
  const result = buildPublicationResult(litellmResponse, modelsDevCatalog, options, publication)
  const models = result.publishable
    .map(toOpenCodeModelSpecWithPublication)
    .filter(hasOperationalLimits)
  return { models, result }
}

// Keep the host-facing signature, including package-sensitive fingerprints, unchanged.
export function modelFingerprint(models: readonly ModelSpec[]): string {
  return discoveryFingerprint(models)
}
