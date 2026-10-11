/**
 * Read-only publication state surface.
 *
 * There is intentionally no acceptance/override method: publication is
 * decided by Core alone and never by a client action.
 */
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
                    readonly discovered: {
                        readonly type: "number";
                    };
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
                    readonly lkgIDs: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                    };
                    readonly lkgDetail: {
                        readonly type: "string";
                    };
                    readonly withheld: {
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
                                readonly reasons: {
                                    readonly type: "array";
                                    readonly items: {
                                        readonly type: "object";
                                        readonly properties: {
                                            readonly code: {
                                                readonly type: "string";
                                            };
                                            readonly message: {
                                                readonly type: "string";
                                            };
                                            readonly fields: {
                                                readonly type: "array";
                                                readonly items: {
                                                    readonly type: "string";
                                                };
                                            };
                                        };
                                        readonly required: readonly ["code", "message", "fields"];
                                        readonly additionalProperties: false;
                                    };
                                };
                                readonly previouslyPublished: {
                                    readonly type: "boolean";
                                };
                                readonly retryable: {
                                    readonly type: "boolean";
                                };
                            };
                            readonly required: readonly ["id", "status", "reasons", "previouslyPublished", "retryable"];
                            readonly additionalProperties: false;
                        };
                    };
                    readonly partial: {
                        readonly type: "boolean";
                    };
                    readonly unusable: {
                        readonly type: "boolean";
                    };
                    readonly regressions: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                    };
                    readonly failureKind: {
                        readonly type: "string";
                    };
                    readonly acknowledgement: {
                        readonly type: "object";
                        readonly properties: {
                            readonly notify: {
                                readonly type: "boolean";
                            };
                            readonly reason: {
                                readonly type: "string";
                            };
                            readonly fingerprint: {
                                readonly type: "string";
                            };
                        };
                        readonly required: readonly ["notify", "reason", "fingerprint"];
                        readonly additionalProperties: false;
                    };
                };
                readonly required: readonly ["discovered", "publishable", "lkgIDs", "withheld", "partial", "unusable", "regressions"];
                readonly additionalProperties: false;
            };
        };
    };
    readonly events: {};
};
