/**
 * Canonical endpoint state model: desired × validation × credential × applied.
 *
 * Pure module — no OpenCode imports. Every user-visible surface (management list,
 * endpoint detail, /litellm-diagnostics, /models publishing) derives from the same
 * `userVisibleStatus(state)` so no view can drift from runtime truth.
 *
 * Tokens and labels are shared verbatim with the Pi adapter so both plugins tell
 * the user exactly the same story.
 */

export type DesiredState = "enabled" | "disabled"

export type ValidationState =
  | { readonly kind: "ok" }
  | { readonly kind: "invalid"; readonly reason: string }

export type CredentialState = "stored" | "environment" | "none" | "unknown"

export type ApplyErrorCategory =
  | "credential-missing"
  | "config-invalid"
  | "auth"
  | "network"
  | "parse"
  | "cancelled"

export type AppliedState =
  | { readonly kind: "active"; readonly lastDiscoveryAt?: string; readonly modelCount: number }
  | { readonly kind: "not-applied" }
  | { readonly kind: "error"; readonly category: ApplyErrorCategory; readonly message?: string; readonly at?: string }

export interface EndpointState {
  readonly endpointId: string
  readonly desired: DesiredState
  readonly validation: ValidationState
  readonly credential: CredentialState
  readonly applied: AppliedState
}

export type UserVisibleStatus =
  | "disabled"
  | "disabled-invalid"
  | "enabled-active"
  | "enabled-needs-authentication"
  | "enabled-not-applied"
  | "enabled-error"
  | "enabled-invalid-configuration"

export function userVisibleStatus(state: EndpointState): UserVisibleStatus {
  if (state.validation.kind === "invalid") {
    return state.desired === "enabled" ? "enabled-invalid-configuration" : "disabled-invalid"
  }
  if (state.desired === "disabled") return "disabled"
  if (state.credential === "none" || state.credential === "unknown") {
    return "enabled-needs-authentication"
  }
  if (state.applied.kind === "active") return "enabled-active"
  if (state.applied.kind === "error") return "enabled-error"
  return "enabled-not-applied"
}

const STATUS_LABEL: Readonly<Record<UserVisibleStatus, string>> = {
  "disabled": "未启用",
  "disabled-invalid": "未启用 · 配置非法",
  "enabled-active": "已启用 · 已生效",
  "enabled-needs-authentication": "已启用 · 需要认证",
  "enabled-not-applied": "已启用 · 未生效",
  "enabled-error": "已启用 · 出错",
  "enabled-invalid-configuration": "已启用 · 配置非法",
}

export function statusLabel(status: UserVisibleStatus): string {
  return STATUS_LABEL[status]
}

const CREDENTIAL_LABEL: Readonly<Record<CredentialState, string>> = {
  stored: "已保存 API Key",
  environment: "API Key 来自环境变量",
  none: "未保存 API Key",
  unknown: "凭据状态未知",
}

export function credentialLabel(state: CredentialState): string {
  return CREDENTIAL_LABEL[state]
}

const APPLY_ERROR_LABEL: Readonly<Record<ApplyErrorCategory, string>> = {
  "credential-missing": "缺少凭据",
  "config-invalid": "配置非法",
  "auth": "认证失败",
  "network": "网络/上游错误",
  "parse": "响应解析失败",
  "cancelled": "已取消（宿主生命周期）",
}

export function applyErrorLabel(category: ApplyErrorCategory): string {
  return APPLY_ERROR_LABEL[category]
}

/**
 * Frozen `/models` predicate: only endpoints that are enabled, valid, credentialed
 * and have at least one successful refresh in this process MAY publish models.
 */
export function canPublish(state: EndpointState): boolean {
  if (state.desired !== "enabled") return false
  if (state.validation.kind !== "ok") return false
  if (state.credential !== "stored" && state.credential !== "environment") return false
  return state.applied.kind === "active"
}

/** Whether Retry / 重新应用 is offered for this state. */
export function canRetry(state: EndpointState): boolean {
  if (state.desired !== "enabled") return false
  if (state.validation.kind !== "ok") return false
  return state.applied.kind === "not-applied" || state.applied.kind === "error"
}

export const INITIAL_APPLIED: AppliedState = { kind: "not-applied" }

export function initialEndpointState(
  endpointId: string,
  desired: DesiredState,
  validation: ValidationState,
  credential: CredentialState,
): EndpointState {
  return { endpointId, desired, validation, credential, applied: INITIAL_APPLIED }
}
