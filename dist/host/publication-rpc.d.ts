export declare const publicationRpc: {
    readonly id: "litellm-publication";
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
                    readonly publishable: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "object";
                            readonly properties: {
                                readonly id: {
                                    readonly type: "string";
                                };
                                readonly status: {
                                    readonly type: "string";
                                };
                            };
                            readonly required: readonly ["id", "status"];
                            readonly additionalProperties: false;
                        };
                    };
                    readonly degradedIDs: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                    };
                    readonly lkgIDs: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                    };
                    readonly blocked: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "object";
                            readonly properties: {
                                readonly id: {
                                    readonly type: "string";
                                };
                                readonly status: {
                                    readonly type: "string";
                                };
                                readonly gaps: {
                                    readonly type: "array";
                                    readonly items: {
                                        readonly type: "string";
                                    };
                                };
                                readonly degradationEligible: {
                                    readonly type: "boolean";
                                };
                                readonly degradationReason: {
                                    readonly type: "string";
                                };
                            };
                            readonly required: readonly ["id", "status", "gaps", "degradationEligible"];
                            readonly additionalProperties: false;
                        };
                    };
                };
                readonly required: readonly ["publishable", "degradedIDs", "lkgIDs", "blocked"];
                readonly additionalProperties: false;
            };
        };
        readonly accept: {
            readonly input: {
                readonly type: "object";
                readonly properties: {
                    readonly sessionID: {
                        readonly type: "string";
                    };
                    readonly modelId: {
                        readonly type: "string";
                    };
                    readonly endpointId: {
                        readonly type: "string";
                    };
                };
                readonly required: readonly ["sessionID", "modelId"];
                readonly additionalProperties: false;
            };
            readonly output: {
                readonly type: "object";
                readonly properties: {
                    readonly ok: {
                        readonly type: "boolean";
                    };
                    readonly status: {
                        readonly type: "string";
                    };
                    readonly gaps: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                    };
                    readonly reason: {
                        readonly type: "string";
                    };
                };
                readonly required: readonly ["ok", "status", "gaps", "reason"];
                readonly additionalProperties: false;
            };
        };
    };
    readonly events: {
        readonly accepted: {
            readonly schema: {
                readonly type: "object";
                readonly properties: {
                    readonly sessionID: {
                        readonly type: "string";
                    };
                    readonly modelId: {
                        readonly type: "string";
                    };
                    readonly ok: {
                        readonly type: "boolean";
                    };
                    readonly status: {
                        readonly type: "string";
                    };
                    readonly gaps: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                    };
                    readonly reason: {
                        readonly type: "string";
                    };
                };
                readonly required: readonly ["sessionID", "modelId", "ok", "status", "gaps", "reason"];
                readonly additionalProperties: false;
            };
        };
    };
};
