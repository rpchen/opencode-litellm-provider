export declare const endpointRpc: {
    readonly id: "litellm-endpoints";
    readonly methods: {
        readonly state: {
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
                    readonly mode: {
                        readonly type: "string";
                        readonly enum: readonly ["all", "selected"];
                    };
                    readonly endpointIds: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                    };
                    readonly activeEndpointIds: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                    };
                };
                readonly required: readonly ["sequence", "sessionID", "mode", "endpointIds", "activeEndpointIds"];
                readonly additionalProperties: false;
            };
        };
        readonly set: {
            readonly input: {
                readonly type: "object";
                readonly properties: {
                    readonly action: {
                        readonly type: "string";
                    };
                    readonly endpointId: {
                        readonly type: "string";
                    };
                };
                readonly required: readonly ["action", "endpointId"];
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
                    readonly mode: {
                        readonly type: "string";
                        readonly enum: readonly ["all", "selected"];
                    };
                    readonly endpointIds: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                    };
                    readonly activeEndpointIds: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                    };
                };
                readonly required: readonly ["sequence", "sessionID", "mode", "endpointIds", "activeEndpointIds"];
                readonly additionalProperties: false;
            };
        };
    };
    readonly events: {
        readonly shown: {
            readonly schema: {
                readonly type: "object";
                readonly properties: {
                    readonly sequence: {
                        readonly type: "number";
                    };
                    readonly sessionID: {
                        readonly type: "string";
                    };
                    readonly mode: {
                        readonly type: "string";
                        readonly enum: readonly ["all", "selected"];
                    };
                    readonly endpointIds: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                    };
                    readonly activeEndpointIds: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                    };
                };
                readonly required: readonly ["sequence", "sessionID", "mode", "endpointIds", "activeEndpointIds"];
                readonly additionalProperties: false;
            };
        };
    };
};
