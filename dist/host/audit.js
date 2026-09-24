function variantSettings(settings) {
    if (!settings)
        return {};
    const result = {};
    for (const key of ["reasoningEffort", "effort"]) {
        if (typeof settings[key] === "string")
            result[key] = settings[key];
    }
    const thinking = settings.thinking;
    if (typeof thinking === "object" && thinking !== null) {
        const value = thinking;
        if (value.type === "enabled" && typeof value.budgetTokens === "number") {
            result.thinking = { type: "enabled", budgetTokens: value.budgetTokens };
        }
    }
    return result;
}
function modelRecord(model, view) {
    const id = String(model.id);
    return {
        id,
        modelID: String(model.modelID),
        providerID: String(model.providerID),
        name: model.name,
        protocol: view.protocols[id],
        package: model.package,
        capabilities: {
            tools: model.capabilities.tools,
            input: [...model.capabilities.input],
            output: [...model.capabilities.output],
        },
        variants: model.variants.map((variant) => ({
            id: String(variant.id),
            settings: variantSettings(variant.settings),
        })),
        time: {
            released: model.time.released,
            unit: view.releaseUnits[id],
        },
        cost: model.cost.map((tier) => ({
            input: tier.input,
            output: tier.output,
            cache: { read: tier.cache.read, write: tier.cache.write },
        })),
        status: model.status,
        enabled: model.enabled,
        limit: {
            context: model.limit.context,
            input: model.limit.input,
            output: model.limit.output,
        },
    };
}
export function createAuditReport(snapshot, now = new Date()) {
    const view = snapshot.view;
    return {
        schemaVersion: 1,
        scope: "plugin-submitted",
        exportedAt: now.toISOString(),
        lastSuccessfulDiscoveryAt: snapshot.lastSuccessfulDiscoveryAt ?? null,
        status: snapshot.status,
        units: {
            time: "ISO 8601 UTC",
            cost: "USD per million tokens",
            release: "per-model",
        },
        defaults: {
            zero: "未获得可用值时提交给宿主的默认值，并非上游确认不支持",
            emptyVariants: "没有可用的推理档位，不代表上游确认不支持推理",
            releaseUnknown: "数值日期未经单位归一化；none 表示未取得有效日期",
        },
        provider: view ? {
            id: String(view.info.id),
            name: view.info.name,
            activation: view.info.activation,
            package: view.info.package,
        } : null,
        models: view?.models.map((model) => modelRecord(model, view)) ?? [],
    };
}
