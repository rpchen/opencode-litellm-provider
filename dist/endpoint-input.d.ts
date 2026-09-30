export declare function validateEndpointId(id: string): string | undefined;
export type UrlCheck = {
    ok: true;
    value: string;
} | {
    ok: false;
    message: string;
};
export declare function validateBaseUrl(raw: string): UrlCheck;
export type ApiKeyCheck = {
    ok: true;
    key: string;
} | {
    ok: false;
    message: string;
};
export declare function validateApiKey(raw: string): ApiKeyCheck;
