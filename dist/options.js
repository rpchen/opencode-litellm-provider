import { isEndpointID } from "./generated/discovery-core/index.js";
export const DEFAULT_OPTIONS = {
    pollInterval: 300,
    contextTierCap: true,
    protocolOverrides: {},
    conversationFeedback: false,
};
const PROTOCOLS = new Set(["chat", "responses", "messages"]);
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function isEndpointId(value) {
    return isEndpointID(value);
}
function parseProtocolOverrides(value, label, logger) {
    const protocolOverrides = {};
    if (value === undefined)
        return protocolOverrides;
    if (!isRecord(value)) {
        logger.warn(`${label} 必须是对象，已忽略`);
        return protocolOverrides;
    }
    for (const [model, protocol] of Object.entries(value)) {
        if (model.length > 0 && typeof protocol === "string" && PROTOCOLS.has(protocol)) {
            protocolOverrides[model] = protocol;
        }
        else {
            logger.warn(`${label}[${JSON.stringify(model)}] 无效，已忽略`);
        }
    }
    return protocolOverrides;
}
export function parseOptions(input, logger = console) {
    if (input === undefined)
        return { ...DEFAULT_OPTIONS, protocolOverrides: {} };
    if (!isRecord(input)) {
        logger.warn("LiteLLM 插件配置必须是对象，已使用默认值");
        return { ...DEFAULT_OPTIONS, protocolOverrides: {} };
    }
    let pollInterval = DEFAULT_OPTIONS.pollInterval;
    if (input.pollInterval !== undefined) {
        if (typeof input.pollInterval !== "number" || !Number.isFinite(input.pollInterval) || input.pollInterval <= 0) {
            logger.warn("pollInterval 必须是正数，已使用默认值 300 秒");
        }
        else if (input.pollInterval < 30) {
            logger.warn("pollInterval 不能小于 30 秒，已钳制为 30 秒");
            pollInterval = 30;
        }
        else {
            pollInterval = input.pollInterval;
        }
    }
    let contextTierCap = DEFAULT_OPTIONS.contextTierCap;
    if (input.contextTierCap !== undefined) {
        if (typeof input.contextTierCap === "boolean")
            contextTierCap = input.contextTierCap;
        else
            logger.warn("contextTierCap 必须是布尔值，已使用默认值 true");
    }
    let conversationFeedback = DEFAULT_OPTIONS.conversationFeedback;
    if (input.conversationFeedback !== undefined) {
        if (typeof input.conversationFeedback === "boolean")
            conversationFeedback = input.conversationFeedback;
        else
            logger.warn("conversationFeedback 必须是布尔值，已使用默认值 false");
    }
    const protocolOverrides = parseProtocolOverrides(input.protocolOverrides, "protocolOverrides", logger);
    let endpoints;
    if (input.endpoints !== undefined) {
        endpoints = {};
        if (Object.keys(protocolOverrides).length > 0) {
            logger.warn("显式 endpoints 模式不能同时使用顶层 protocolOverrides；已拒绝 endpoint 配置");
            return { pollInterval, contextTierCap, protocolOverrides: {}, conversationFeedback, endpoints };
        }
        if (!isRecord(input.endpoints)) {
            logger.warn("endpoints 必须是对象；已拒绝显式 endpoint 配置");
            return { pollInterval, contextTierCap, protocolOverrides: {}, conversationFeedback, endpoints };
        }
        for (const [id, raw] of Object.entries(input.endpoints)) {
            if (!isEndpointId(id)) {
                logger.warn(`endpoint id ${JSON.stringify(id)} 非法（必须匹配 [a-z0-9][a-z0-9-_]*），已跳过`);
                continue;
            }
            if (!isRecord(raw)) {
                logger.warn(`endpoint ${id} 必须是对象，已跳过`);
                continue;
            }
            const baseUrl = typeof raw.baseUrl === "string" ? raw.baseUrl.trim() : "";
            let valid = false;
            try {
                const url = new URL(baseUrl);
                valid = url.protocol === "http:" || url.protocol === "https:";
            }
            catch { }
            if (!valid) {
                logger.warn(`endpoint ${id} 缺少合法 http(s) baseUrl，已跳过`);
                continue;
            }
            endpoints[id] = {
                baseUrl,
                protocolOverrides: parseProtocolOverrides(raw.protocolOverrides, `endpoints.${id}.protocolOverrides`, logger),
            };
        }
    }
    const parsed = { pollInterval, contextTierCap, protocolOverrides, conversationFeedback };
    return endpoints === undefined ? parsed : { ...parsed, endpoints };
}
