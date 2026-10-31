/** Read the URL stored by OpenCode's key credential form. */
export function credentialURL(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("type" in value) || value.type !== "key") return undefined
  const fields = ["configuration" in value ? value.configuration : undefined, "metadata" in value ? value.metadata : undefined]
  for (const data of fields) {
    if (typeof data !== "object" || data === null || !("url" in data)) continue
    if (typeof data.url === "string" && data.url.length > 0) return data.url
  }
  return undefined
}
