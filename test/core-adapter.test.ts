import { expect, test } from "bun:test"
import discovery from "./fixtures/metadata-priority/synthetic-discovery.json" with { type: "json" }
import catalog from "./fixtures/metadata-priority/modelsdev-subset.json" with { type: "json" }
import { buildModelSpecs as neutral, type ModelSpec } from "../src/generated/discovery-core/index.js"
import { buildModelSpecs, hasOperationalLimits, toOpenCodeModelSpec } from "../src/host/models.js"
import { createRegistrationView } from "../src/host/register.js"
import { PROTOCOL_PACKAGES } from "../src/host/protocol.js"
const options = { contextTierCap: true, protocolOverrides: {} }

test("shared ModelSpec stays neutral; adapter adds only SDK package", () => {
  const specs = neutral(discovery, catalog, options)
  const before = structuredClone(specs)
  expect(specs).toHaveLength(16)
  expect(buildModelSpecs(discovery, catalog, options)).toEqual(specs.map(toOpenCodeModelSpec))
  expect(specs).toEqual(before)
  for (const spec of specs) {
    const { package: sdk, ...mapped } = toOpenCodeModelSpec(spec)
    expect(mapped).toEqual(spec)
    expect(sdk).toBe(PROTOCOL_PACKAGES[spec.protocol])
    expect(Object.hasOwn(spec, "package")).toBeFalse()
  }
})
test("generic operational limits guard rejects nonpositive and nonfinite context/output", () => {
  const base = neutral(discovery, catalog, options)[0]!
  for (const value of [0, -1, NaN, Infinity]) {
    for (const field of ["context", "output"] as const) {
      const spec: ModelSpec = { ...base, limit: { ...base.limit, [field]: value } }
      expect(hasOperationalLimits(spec)).toBeFalse()
      expect(createRegistrationView([toOpenCodeModelSpec(spec)], "http://litellm.example/v1").models).toEqual([])
    }
  }
  expect(hasOperationalLimits(base)).toBeTrue()
})
