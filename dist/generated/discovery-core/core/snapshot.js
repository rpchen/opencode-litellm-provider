import { normalizeModelCost } from "./capabilities.js";
import { createHash } from "node:crypto";
import { criticalModelFingerprint, hasValidCriticalConfiguration, modelFingerprint } from "./build.js";
import { isRecord, normalizeLiteLLMURL } from "./litellm.js";
export const DISCOVERY_SNAPSHOT_SCHEMA_VERSION = 2;
export const ENDPOINT_ID_PATTERN = /^[a-z0-9][a-z0-9-_]*$/u;
/** Stable user-facing endpoint identifiers shared by host adapters. */
export function isEndpointID(value) {
    return typeof value === "string" && ENDPOINT_ID_PATTERN.test(value);
}
function stableValue(value) {
    if (Array.isArray(value))
        return value.map(stableValue);
    if (typeof value !== "object" || value === null)
        return value;
    return Object.fromEntries(Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, item]) => [key, stableValue(item)]));
}
function stableJSON(value) {
    return JSON.stringify(stableValue(value));
}
function nonEmptyString(value) {
    return typeof value === "string" && value.length > 0;
}
function stringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function finiteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}
function isModelSpec(value) {
    return hasValidCriticalConfiguration(value);
}
function cloneModels(models) {
    return structuredClone(models).map((model) => ({ ...model, cost: normalizeModelCost(model.cost) }));
}
export function endpointFingerprint(input) {
    if (!nonEmptyString(input.credentialKey)) {
        throw new Error("credentialKey must be a non-empty string");
    }
    if (input.endpointID !== undefined && !isEndpointID(input.endpointID)) {
        throw new Error("endpointID must match [a-z0-9][a-z0-9-_]*");
    }
    const rootURL = normalizeLiteLLMURL(input.baseUrl).rootURL;
    const legacyMaterial = {
        rootURL,
        credentialKey: input.credentialKey,
        buildOptions: input.buildOptions
            ? {
                protocolOverrides: input.buildOptions.protocolOverrides,
            }
            : null,
    };
    // Explicit endpoint IDs isolate instances sharing the same URL and credential.
    const material = stableJSON(input.endpointID === undefined
        ? legacyMaterial
        : { ...legacyMaterial, endpointID: input.endpointID });
    return `sha256:${createHash("sha256").update(material).digest("hex")}`;
}
export function createDiscoverySnapshot(endpoint, models, discoveredAt = new Date().toISOString()) {
    if (!nonEmptyString(endpoint))
        throw new Error("endpointFingerprint must be a non-empty string");
    if (!Number.isFinite(Date.parse(discoveredAt)))
        throw new Error("discoveredAt must be a valid date");
    const copied = cloneModels(models);
    return {
        schemaVersion: DISCOVERY_SNAPSHOT_SCHEMA_VERSION,
        endpointFingerprint: endpoint,
        discoveredAt,
        modelFingerprint: criticalModelFingerprint(copied),
        models: copied,
    };
}
export function inspectDiscoverySnapshot(value, expectedEndpointFingerprint) {
    if (value === undefined || value === null)
        return { compatible: false, reason: "missing" };
    if (!isRecord(value))
        return { compatible: false, reason: "invalid" };
    if (value.schemaVersion !== DISCOVERY_SNAPSHOT_SCHEMA_VERSION) {
        return { compatible: false, reason: "schema-version" };
    }
    if (!nonEmptyString(value.endpointFingerprint) ||
        !nonEmptyString(value.discoveredAt) ||
        !Number.isFinite(Date.parse(value.discoveredAt)) ||
        !nonEmptyString(value.modelFingerprint) ||
        !Array.isArray(value.models) ||
        !value.models.every(isModelSpec)) {
        return { compatible: false, reason: "invalid" };
    }
    if (value.endpointFingerprint !== expectedEndpointFingerprint) {
        return { compatible: false, reason: "endpoint" };
    }
    const snapshot = {
        schemaVersion: DISCOVERY_SNAPSHOT_SCHEMA_VERSION,
        endpointFingerprint: value.endpointFingerprint,
        discoveredAt: value.discoveredAt,
        modelFingerprint: value.modelFingerprint,
        models: cloneModels(value.models),
    };
    if (criticalModelFingerprint(snapshot.models) !== snapshot.modelFingerprint) {
        return { compatible: false, reason: "corrupt" };
    }
    return { compatible: true, reason: "compatible", snapshot };
}
function singleModelFingerprint(model) {
    return modelFingerprint([model]);
}
export function compareDiscoverySnapshots(previous, current) {
    const previousByID = new Map(previous.models.map((model) => [model.id, model]));
    const currentByID = new Map(current.models.map((model) => [model.id, model]));
    const added = [...currentByID.keys()].filter((id) => !previousByID.has(id)).sort((a, b) => a.localeCompare(b, "en"));
    const removed = [...previousByID.keys()].filter((id) => !currentByID.has(id)).sort((a, b) => a.localeCompare(b, "en"));
    const protocolChanged = [];
    const capabilityChanged = [];
    const metadataChanged = [];
    for (const [id, before] of previousByID) {
        const after = currentByID.get(id);
        if (!after)
            continue;
        if (before.protocol !== after.protocol)
            protocolChanged.push(id);
        if (stableJSON(before.capabilities) !== stableJSON(after.capabilities))
            capabilityChanged.push(id);
        if (singleModelFingerprint(before) !== singleModelFingerprint(after) &&
            before.protocol === after.protocol &&
            stableJSON(before.capabilities) === stableJSON(after.capabilities)) {
            metadataChanged.push(id);
        }
    }
    const endpointChanged = previous.endpointFingerprint !== current.endpointFingerprint;
    const changed = endpointChanged || modelFingerprint(previous.models) !== modelFingerprint(current.models);
    const drift = endpointChanged ||
        added.length > 0 ||
        removed.length > 0 ||
        protocolChanged.length > 0 ||
        capabilityChanged.length > 0;
    return {
        changed,
        drift,
        endpointChanged,
        added,
        removed,
        protocolChanged: protocolChanged.sort((a, b) => a.localeCompare(b, "en")),
        capabilityChanged: capabilityChanged.sort((a, b) => a.localeCompare(b, "en")),
        metadataChanged: metadataChanged.sort((a, b) => a.localeCompare(b, "en")),
    };
}
