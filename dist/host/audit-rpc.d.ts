export declare const auditRpc: {
    readonly id: "litellm-audit-export";
    readonly methods: {
        readonly export: {
            readonly input: {
                readonly type: "object";
                readonly properties: {
                    readonly sessionID: {
                        readonly type: "string";
                    };
                };
                readonly required: readonly ["sessionID"];
                readonly additionalProperties: false;
            };
            readonly output: {
                readonly type: "object";
                readonly properties: {
                    readonly sequence: {
                        readonly type: "number";
                    };
                    readonly sessionID: {
                        readonly type: "string";
                    };
                    readonly ok: {
                        readonly type: "boolean";
                    };
                    readonly path: {
                        readonly type: "string";
                    };
                    readonly error: {
                        readonly type: "string";
                    };
                };
                readonly required: readonly ["sequence", "sessionID", "ok", "path", "error"];
                readonly additionalProperties: false;
            };
        };
        readonly latest: {
            readonly input: {
                readonly type: "object";
                readonly properties: {};
                readonly additionalProperties: false;
            };
            readonly output: {
                readonly type: "object";
                readonly properties: {
                    readonly sequence: {
                        readonly type: "number";
                    };
                    readonly sessionID: {
                        readonly type: "string";
                    };
                    readonly ok: {
                        readonly type: "boolean";
                    };
                    readonly path: {
                        readonly type: "string";
                    };
                    readonly error: {
                        readonly type: "string";
                    };
                };
                readonly required: readonly ["sequence", "sessionID", "ok", "path", "error"];
                readonly additionalProperties: false;
            };
        };
    };
    readonly events: {
        readonly completed: {
            readonly schema: {
                readonly type: "object";
                readonly properties: {
                    readonly sequence: {
                        readonly type: "number";
                    };
                    readonly sessionID: {
                        readonly type: "string";
                    };
                    readonly ok: {
                        readonly type: "boolean";
                    };
                    readonly path: {
                        readonly type: "string";
                    };
                    readonly error: {
                        readonly type: "string";
                    };
                };
                readonly required: readonly ["sequence", "sessionID", "ok", "path", "error"];
                readonly additionalProperties: false;
            };
        };
    };
};
