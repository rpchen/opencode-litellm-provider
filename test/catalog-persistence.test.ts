import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getModelsDevCatalog, resetModelsDevCacheForTest } from "../src/net/fetch.js"

const directories: string[] = []
afterEach(() => {
  resetModelsDevCacheForTest()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
function location() {
  const directory = mkdtempSync(join(tmpdir(), "catalog-persistence-"))
  directories.push(directory)
  return join(directory, "catalog.json")
}
const catalog = { models: {}, providers: {} }
const success = async () => Response.json(catalog)

test("restart reads the successful disk catalog without contacting models.dev", async () => {
  const cachePath = location()
  await getModelsDevCatalog({ cachePath, fetchImpl: success })
  resetModelsDevCacheForTest()
  let requests = 0
  const result = await getModelsDevCatalog({ cachePath, cachedOnly: true, fetchImpl: async () => {
    requests++
    throw new Error("offline")
  } })
  expect(result).toEqual(catalog)
  expect(requests).toBe(0)
})

test("failed latest request preserves disk catalog across another restart", async () => {
  const cachePath = location()
  await getModelsDevCatalog({ cachePath, fetchImpl: success })
  resetModelsDevCacheForTest()
  expect(await getModelsDevCatalog({ cachePath, forceRefresh: true, fetchImpl: async () => {
    throw new Error("offline")
  } })).toEqual({})
  resetModelsDevCacheForTest()
  expect(await getModelsDevCatalog({ cachePath, cachedOnly: true })).toEqual(catalog)
})

test("invalid disk content is ignored and mirror URLs do not reuse another source", async () => {
  const cachePath = location()
  writeFileSync(cachePath, "invalid json")
  expect(await getModelsDevCatalog({ cachePath, cachedOnly: true })).toBeUndefined()
  await getModelsDevCatalog({ cachePath, fetchImpl: success })
  resetModelsDevCacheForTest()
  expect(await getModelsDevCatalog({ cachePath, url: "https://mirror.example/catalog.json", cachedOnly: true })).toBeUndefined()
})

test("invalid latest catalog cannot replace the previous complete catalog", async () => {
  const cachePath = location()
  await getModelsDevCatalog({ cachePath, fetchImpl: success })
  expect(await getModelsDevCatalog({ cachePath, forceRefresh: true, fetchImpl: async () => Response.json({}) })).toEqual({})
  resetModelsDevCacheForTest()
  expect(await getModelsDevCatalog({ cachePath, cachedOnly: true })).toEqual(catalog)
})


 test("explicit E2E eviction removes both cache layers to exercise genuine LKG fallback", async () => {
  const cachePath = location()
  await getModelsDevCatalog({ cachePath, fetchImpl: success })
  resetModelsDevCacheForTest(true)
  expect(await getModelsDevCatalog({ cachePath, cachedOnly: true })).toBeUndefined()
 })
