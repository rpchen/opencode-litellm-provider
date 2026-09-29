import {
  buildModelSpecs as discoverModelSpecs,
  hasOperationalLimits,
  modelFingerprint as discoveryFingerprint,
  type BuildOptions,
  type ModelSpec as DiscoveryModelSpec,
} from "../generated/discovery-core/index.js"
import { PROTOCOL_PACKAGES } from "./protocol.js"

export type { BuildOptions } from "../generated/discovery-core/index.js"

/** OpenCode-only metadata. The shared ModelSpec deliberately has no SDK package. */
export interface ModelSpec extends DiscoveryModelSpec {
  package: string
}

export function toOpenCodeModelSpec(spec: DiscoveryModelSpec): ModelSpec {
  const { id, name, protocol, ...metadata } = spec
  return { id, name, protocol, package: PROTOCOL_PACKAGES[protocol], ...metadata }
}

export function filterOperationalModelSpecs<T extends Pick<DiscoveryModelSpec, "limit">>(
  models: readonly T[],
): T[] {
  return models.filter(hasOperationalLimits)
}

export function toOperationalOpenCodeModelSpecs(specs: readonly DiscoveryModelSpec[]): ModelSpec[] {
  return filterOperationalModelSpecs(specs).map(toOpenCodeModelSpec)
}

export function buildModelSpecs(
  litellmResponse: unknown,
  modelsDevCatalog: unknown,
  options: BuildOptions,
): ModelSpec[] {
  return toOperationalOpenCodeModelSpecs(discoverModelSpecs(litellmResponse, modelsDevCatalog, options))
}

// Keep the host-facing signature, including package-sensitive fingerprints, unchanged.
export function modelFingerprint(models: readonly ModelSpec[]): string {
  return discoveryFingerprint(models)
}
