import type { DiscoveryStatus } from "./register.js"

const NL = String.fromCharCode(10)

/**
 * 对话反馈通道：把一次导出结果转成最小化、确定性的会话消息，并提交给宿主。
 * 消息不含报告内容、模型清单、价格或凭据；路径按编码安全处理。
 */

export const FEEDBACK_MARKER = "[litellm 插件]"

export type AuditExportOutcome =
  | {
      readonly ok: true
      readonly path: string
      readonly status: DiscoveryStatus
      readonly modelCount: number
    }
  | {
      readonly ok: false
      readonly error: string
    }

const STATUS_LABELS: Record<DiscoveryStatus, string> = {
  disconnected: "未连接",
  pending: "待首次发现",
  switching: "连接切换，待重新发现",
  ready: "正常",
  empty: "发现成功但无可用模型",
  stale: "临时故障，保留上次成功结果",
  "cleared-auth": "认证失败，已清空模型",
  "cleared-notfound": "连接不存在（404），已清空模型",
}

export function statusLabel(status: DiscoveryStatus): string {
  return STATUS_LABELS[status] ?? status
}

const ESCAPE = String.fromCharCode(92)

/**
 * 路径是未受信任文本（状态目录由环境变量决定）。转义换行、制表与控制字符，
 * 避免路径内容改变消息结构或被读作额外指令。
 */
export function encodePathForMessage(path: string): string {
  const parts: string[] = []
  for (const character of path) {
    const code = character.codePointAt(0) ?? 0
    if (code === 13) parts.push(ESCAPE + "r")
    else if (code === 10) parts.push(ESCAPE + "n")
    else if (code === 9) parts.push(ESCAPE + "t")
    else if (code < 32 || code === 127) parts.push(ESCAPE + "u" + code.toString(16).padStart(4, "0"))
    else parts.push(character)
  }
  return parts.join("")
}

export function buildFeedbackMessage(outcome: AuditExportOutcome): string {
  if (!outcome.ok) {
    return [
      FEEDBACK_MARKER + " LiteLLM 审查报告导出失败。",
      "原因：" + outcome.error,
      "未生成报告文件；可修正后重新执行 /litellm-audit-export。",
    ].join(NL)
  }
  const encoded = encodePathForMessage(outcome.path)
  const lines = [
    FEEDBACK_MARKER + " LiteLLM 审查报告已导出。",
    "路径：" + encoded,
    "发现状态：" + statusLabel(outcome.status),
    "模型数：" + String(outcome.modelCount),
  ]
  if (outcome.status === "stale") {
    lines.push("说明：模型数为上次成功发现的结果，当前处于临时故障状态。")
  }
  lines.push("说明：本消息由 litellm 插件生成；报告内容不在消息中，请打开文件核对。")
  return lines.join(NL)
}

export interface FeedbackSessionDomain {
  prompt(input: { sessionID: string; text: string }): Promise<unknown>
}

export interface FeedbackSubmitter {
  submit(sessionID: string, outcome: AuditExportOutcome): Promise<boolean>
}

export interface FeedbackSubmitterOptions {
  /** 有界等待上限，避免宿主挂起时无限阻塞命令。 */
  timeoutMs?: number
  onError?: (error: unknown) => void
}

const DEFAULT_TIMEOUT_MS = 5000

/**
 * 提交反馈消息。任何失败都静默降级（返回 false），不重试、不抛出，不影响导出主流程。
 * 超时后仍对迟到 rejection 做处理，避免未处理拒绝。
 */
export function createFeedbackSubmitter(
  session: FeedbackSessionDomain,
  options: FeedbackSubmitterOptions = {},
): FeedbackSubmitter {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const onError = options.onError ?? (() => {})

  return {
    async submit(sessionID: string, outcome: AuditExportOutcome): Promise<boolean> {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const pending = Promise.resolve(session.prompt({ sessionID, text: buildFeedbackMessage(outcome) }))
        const timeout = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("反馈提交超时")), timeoutMs)
        })
        // 超时后不再等待结果，但仍保留对迟到 rejection 的处理。
        pending.catch(() => {})
        await Promise.race([pending, timeout])
        return true
      } catch (error) {
        onError(error)
        return false
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
    },
  }
}