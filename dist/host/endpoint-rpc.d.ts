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
                    readonly endpoints: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "object";
                            readonly properties: {
                                readonly id: {
                                    readonly type: "string";
                                };
                                readonly baseUrl: {
                                    readonly type: "string";
                                };
                                readonly active: {
                                    readonly type: "boolean";
                                };
                                readonly legacy: {
                                    readonly type: "boolean";
                                };
                            };
                            readonly required: readonly ["id", "baseUrl", "active", "legacy"];
                            readonly additionalProperties: false;
                        };
                    };
                    /** Whether Add / Edit / Delete can write the config file that declares this plugin. */
                    readonly writable: {
                        readonly type: "boolean";
                    };
                    /** Human-readable reason when `writable` is false. */
                    readonly configProblem: {
                        readonly type: "string";
                    };
                    /** Legacy single-endpoint mode: Add needs a migration confirmation first. */
                    readonly legacyMigration: {
                        readonly type: "boolean";
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
                    readonly endpoints: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "object";
                            readonly properties: {
                                readonly id: {
                                    readonly type: "string";
                                };
                                readonly baseUrl: {
                                    readonly type: "string";
                                };
                                readonly active: {
                                    readonly type: "boolean";
                                };
                                readonly legacy: {
                                    readonly type: "boolean";
                                };
                            };
                            readonly required: readonly ["id", "baseUrl", "active", "legacy"];
                            readonly additionalProperties: false;
                        };
                    };
                    /** Whether Add / Edit / Delete can write the config file that declares this plugin. */
                    readonly writable: {
                        readonly type: "boolean";
                    };
                    /** Human-readable reason when `writable` is false. */
                    readonly configProblem: {
                        readonly type: "string";
                    };
                    /** Legacy single-endpoint mode: Add needs a migration confirmation first. */
                    readonly legacyMigration: {
                        readonly type: "boolean";
                    };
                };
                readonly required: readonly ["sequence", "sessionID", "mode", "endpointIds", "activeEndpointIds"];
                readonly additionalProperties: false;
            };
        };
        readonly add: {
            readonly input: {
                readonly type: "object";
                readonly properties: {
                    readonly endpointId: {
                        readonly type: "string";
                    };
                    readonly baseUrl: {
                        readonly type: "string";
                    };
                    readonly confirmMigration: {
                        readonly type: "boolean";
                    };
                };
                readonly required: readonly ["endpointId", "baseUrl"];
                readonly additionalProperties: false;
            };
            readonly output: {
                readonly type: "object";
                readonly properties: {
                    readonly ok: {
                        readonly type: "boolean";
                    };
                    readonly code: {
                        readonly type: "string";
                    };
                    readonly message: {
                        readonly type: "string";
                    };
                    readonly migrated: {
                        readonly type: "boolean";
                    };
                    /** The config mutation is persisted even though the operation failed (post-commit reload failure). */
                    readonly saved: {
                        readonly type: "boolean";
                    };
                    readonly state: {
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
                            readonly endpoints: {
                                readonly type: "array";
                                readonly items: {
                                    readonly type: "object";
                                    readonly properties: {
                                        readonly id: {
                                            readonly type: "string";
                                        };
                                        readonly baseUrl: {
                                            readonly type: "string";
                                        };
                                        readonly active: {
                                            readonly type: "boolean";
                                        };
                                        readonly legacy: {
                                            readonly type: "boolean";
                                        };
                                    };
                                    readonly required: readonly ["id", "baseUrl", "active", "legacy"];
                                    readonly additionalProperties: false;
                                };
                            };
                            /** Whether Add / Edit / Delete can write the config file that declares this plugin. */
                            readonly writable: {
                                readonly type: "boolean";
                            };
                            /** Human-readable reason when `writable` is false. */
                            readonly configProblem: {
                                readonly type: "string";
                            };
                            /** Legacy single-endpoint mode: Add needs a migration confirmation first. */
                            readonly legacyMigration: {
                                readonly type: "boolean";
                            };
                        };
                        readonly required: readonly ["sequence", "sessionID", "mode", "endpointIds", "activeEndpointIds"];
                        readonly additionalProperties: false;
                    };
                };
                readonly required: readonly ["ok", "state"];
                readonly additionalProperties: false;
            };
        };
        readonly edit: {
            readonly input: {
                readonly type: "object";
                readonly properties: {
                    readonly endpointId: {
                        readonly type: "string";
                    };
                    readonly baseUrl: {
                        readonly type: "string";
                    };
                };
                readonly required: readonly ["endpointId", "baseUrl"];
                readonly additionalProperties: false;
            };
            readonly output: {
                readonly type: "object";
                readonly properties: {
                    readonly ok: {
                        readonly type: "boolean";
                    };
                    readonly code: {
                        readonly type: "string";
                    };
                    readonly message: {
                        readonly type: "string";
                    };
                    readonly migrated: {
                        readonly type: "boolean";
                    };
                    /** The config mutation is persisted even though the operation failed (post-commit reload failure). */
                    readonly saved: {
                        readonly type: "boolean";
                    };
                    readonly state: {
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
                            readonly endpoints: {
                                readonly type: "array";
                                readonly items: {
                                    readonly type: "object";
                                    readonly properties: {
                                        readonly id: {
                                            readonly type: "string";
                                        };
                                        readonly baseUrl: {
                                            readonly type: "string";
                                        };
                                        readonly active: {
                                            readonly type: "boolean";
                                        };
                                        readonly legacy: {
                                            readonly type: "boolean";
                                        };
                                    };
                                    readonly required: readonly ["id", "baseUrl", "active", "legacy"];
                                    readonly additionalProperties: false;
                                };
                            };
                            /** Whether Add / Edit / Delete can write the config file that declares this plugin. */
                            readonly writable: {
                                readonly type: "boolean";
                            };
                            /** Human-readable reason when `writable` is false. */
                            readonly configProblem: {
                                readonly type: "string";
                            };
                            /** Legacy single-endpoint mode: Add needs a migration confirmation first. */
                            readonly legacyMigration: {
                                readonly type: "boolean";
                            };
                        };
                        readonly required: readonly ["sequence", "sessionID", "mode", "endpointIds", "activeEndpointIds"];
                        readonly additionalProperties: false;
                    };
                };
                readonly required: readonly ["ok", "state"];
                readonly additionalProperties: false;
            };
        };
        /** Step 1 of Delete: stop the runtime and clear server-held state; the definition is kept. */
        readonly prepareRemove: {
            readonly input: {
                readonly type: "object";
                readonly properties: {
                    readonly endpointId: {
                        readonly type: "string";
                    };
                };
                readonly required: readonly ["endpointId"];
                readonly additionalProperties: false;
            };
            readonly output: {
                readonly type: "object";
                readonly properties: {
                    readonly ok: {
                        readonly type: "boolean";
                    };
                    readonly code: {
                        readonly type: "string";
                    };
                    readonly message: {
                        readonly type: "string";
                    };
                    readonly migrated: {
                        readonly type: "boolean";
                    };
                    /** The config mutation is persisted even though the operation failed (post-commit reload failure). */
                    readonly saved: {
                        readonly type: "boolean";
                    };
                    readonly state: {
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
                            readonly endpoints: {
                                readonly type: "array";
                                readonly items: {
                                    readonly type: "object";
                                    readonly properties: {
                                        readonly id: {
                                            readonly type: "string";
                                        };
                                        readonly baseUrl: {
                                            readonly type: "string";
                                        };
                                        readonly active: {
                                            readonly type: "boolean";
                                        };
                                        readonly legacy: {
                                            readonly type: "boolean";
                                        };
                                    };
                                    readonly required: readonly ["id", "baseUrl", "active", "legacy"];
                                    readonly additionalProperties: false;
                                };
                            };
                            /** Whether Add / Edit / Delete can write the config file that declares this plugin. */
                            readonly writable: {
                                readonly type: "boolean";
                            };
                            /** Human-readable reason when `writable` is false. */
                            readonly configProblem: {
                                readonly type: "string";
                            };
                            /** Legacy single-endpoint mode: Add needs a migration confirmation first. */
                            readonly legacyMigration: {
                                readonly type: "boolean";
                            };
                        };
                        readonly required: readonly ["sequence", "sessionID", "mode", "endpointIds", "activeEndpointIds"];
                        readonly additionalProperties: false;
                    };
                };
                readonly required: readonly ["ok", "state"];
                readonly additionalProperties: false;
            };
        };
        /** Step 2 of Delete: remove the definition (after the client removed the credentials). */
        readonly remove: {
            readonly input: {
                readonly type: "object";
                readonly properties: {
                    readonly endpointId: {
                        readonly type: "string";
                    };
                };
                readonly required: readonly ["endpointId"];
                readonly additionalProperties: false;
            };
            readonly output: {
                readonly type: "object";
                readonly properties: {
                    readonly ok: {
                        readonly type: "boolean";
                    };
                    readonly code: {
                        readonly type: "string";
                    };
                    readonly message: {
                        readonly type: "string";
                    };
                    readonly migrated: {
                        readonly type: "boolean";
                    };
                    /** The config mutation is persisted even though the operation failed (post-commit reload failure). */
                    readonly saved: {
                        readonly type: "boolean";
                    };
                    readonly state: {
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
                            readonly endpoints: {
                                readonly type: "array";
                                readonly items: {
                                    readonly type: "object";
                                    readonly properties: {
                                        readonly id: {
                                            readonly type: "string";
                                        };
                                        readonly baseUrl: {
                                            readonly type: "string";
                                        };
                                        readonly active: {
                                            readonly type: "boolean";
                                        };
                                        readonly legacy: {
                                            readonly type: "boolean";
                                        };
                                    };
                                    readonly required: readonly ["id", "baseUrl", "active", "legacy"];
                                    readonly additionalProperties: false;
                                };
                            };
                            /** Whether Add / Edit / Delete can write the config file that declares this plugin. */
                            readonly writable: {
                                readonly type: "boolean";
                            };
                            /** Human-readable reason when `writable` is false. */
                            readonly configProblem: {
                                readonly type: "string";
                            };
                            /** Legacy single-endpoint mode: Add needs a migration confirmation first. */
                            readonly legacyMigration: {
                                readonly type: "boolean";
                            };
                        };
                        readonly required: readonly ["sequence", "sessionID", "mode", "endpointIds", "activeEndpointIds"];
                        readonly additionalProperties: false;
                    };
                };
                readonly required: readonly ["ok", "state"];
                readonly additionalProperties: false;
            };
        };
        /** Legacy single-endpoint → explicit `options.endpoints.default`; identity and credential stay unchanged. */
        readonly migrate: {
            readonly input: {
                readonly type: "object";
                readonly properties: {};
                readonly additionalProperties: false;
            };
            readonly output: {
                readonly type: "object";
                readonly properties: {
                    readonly ok: {
                        readonly type: "boolean";
                    };
                    readonly code: {
                        readonly type: "string";
                    };
                    readonly message: {
                        readonly type: "string";
                    };
                    readonly migrated: {
                        readonly type: "boolean";
                    };
                    /** The config mutation is persisted even though the operation failed (post-commit reload failure). */
                    readonly saved: {
                        readonly type: "boolean";
                    };
                    readonly state: {
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
                            readonly endpoints: {
                                readonly type: "array";
                                readonly items: {
                                    readonly type: "object";
                                    readonly properties: {
                                        readonly id: {
                                            readonly type: "string";
                                        };
                                        readonly baseUrl: {
                                            readonly type: "string";
                                        };
                                        readonly active: {
                                            readonly type: "boolean";
                                        };
                                        readonly legacy: {
                                            readonly type: "boolean";
                                        };
                                    };
                                    readonly required: readonly ["id", "baseUrl", "active", "legacy"];
                                    readonly additionalProperties: false;
                                };
                            };
                            /** Whether Add / Edit / Delete can write the config file that declares this plugin. */
                            readonly writable: {
                                readonly type: "boolean";
                            };
                            /** Human-readable reason when `writable` is false. */
                            readonly configProblem: {
                                readonly type: "string";
                            };
                            /** Legacy single-endpoint mode: Add needs a migration confirmation first. */
                            readonly legacyMigration: {
                                readonly type: "boolean";
                            };
                        };
                        readonly required: readonly ["sequence", "sessionID", "mode", "endpointIds", "activeEndpointIds"];
                        readonly additionalProperties: false;
                    };
                };
                readonly required: readonly ["ok", "state"];
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
                    readonly endpoints: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "object";
                            readonly properties: {
                                readonly id: {
                                    readonly type: "string";
                                };
                                readonly baseUrl: {
                                    readonly type: "string";
                                };
                                readonly active: {
                                    readonly type: "boolean";
                                };
                                readonly legacy: {
                                    readonly type: "boolean";
                                };
                            };
                            readonly required: readonly ["id", "baseUrl", "active", "legacy"];
                            readonly additionalProperties: false;
                        };
                    };
                    /** Whether Add / Edit / Delete can write the config file that declares this plugin. */
                    readonly writable: {
                        readonly type: "boolean";
                    };
                    /** Human-readable reason when `writable` is false. */
                    readonly configProblem: {
                        readonly type: "string";
                    };
                    /** Legacy single-endpoint mode: Add needs a migration confirmation first. */
                    readonly legacyMigration: {
                        readonly type: "boolean";
                    };
                };
                readonly required: readonly ["sequence", "sessionID", "mode", "endpointIds", "activeEndpointIds"];
                readonly additionalProperties: false;
            };
        };
    };
};
