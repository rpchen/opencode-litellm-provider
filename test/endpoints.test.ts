import { describe, expect, test } from "bun:test"
import {
  activeEndpointIds,
  endpointIdentity,
  parseActivation,
  toggleEndpoint,
} from "../src/endpoints.js"

describe("PR9 endpoint identity and activation", () => {
  test("default preserves historical identity and named endpoint derives stable identity", () => {
    expect(endpointIdentity("default", "https://default.example", false)).toMatchObject({
      id: "default",
      integrationId: "litellm",
      providerId: "litellm",
      displayName: "LiteLLM",
    })
    expect(endpointIdentity("company", "https://company.example", false)).toMatchObject({
      id: "company",
      integrationId: "litellm-company",
      providerId: "litellm-company",
      displayName: "LiteLLM · company",
    })
  })

  test("activation defaults to all and selected may be empty", () => {
    expect(parseActivation(undefined)).toEqual({ mode: "all" })
    expect(activeEndpointIds(["default", "company"], { mode: "selected", endpointIds: [] })).toEqual([])
  })

  test("selected activation intersects current endpoints without deleting unknown persisted ids", () => {
    const activation = { mode: "selected" as const, endpointIds: ["removed", "company"] }
    expect(activeEndpointIds(["default", "company"], activation)).toEqual(["company"])
    expect(activation.endpointIds).toEqual(["removed", "company"])
  })

  test("toggling from all materializes the selected set", () => {
    expect(toggleEndpoint(["default", "company"], { mode: "all" }, "company"))
      .toEqual({ mode: "selected", endpointIds: ["default"] })
  })
})
