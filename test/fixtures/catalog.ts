/** Synthetic official API records for host lifecycle tests, not a production fallback. */
export function officialCatalog(models: Record<string, Record<string, unknown>>) {
  const providers: Record<string, { models: Record<string, Record<string, unknown>> }> = {}
  for (const [canonical, record] of Object.entries(models)) {
    const [provider, ...parts] = canonical.split("/")
    const id = parts.join("/")
    const entry = providers[provider!] ??= { models: {} }
    entry.models[id] = { id, canonical_model_id: canonical, ...record }
  }
  return { models, providers }
}
