import { describe, expect, test } from 'bun:test'
import {
  buildFeedbackMessage,
  createFeedbackSubmitter,
  encodePathForMessage,
  FEEDBACK_MARKER,
  type FeedbackSessionDomain,
} from '../src/host/audit-feedback.js'

const NL = String.fromCharCode(10)
const TAB = String.fromCharCode(9)
const ESC = String.fromCharCode(92)
const BEL = String.fromCharCode(7)
const QUOTE = String.fromCharCode(34)

describe('反馈消息构造', () => {
  test('成功消息包含插件标识、路径、状态与模型数', () => {
    const message = buildFeedbackMessage({ ok: true, path: 'C:/state/audit-1.json', status: 'ready', modelCount: 18 })
    expect(message).toContain(FEEDBACK_MARKER)
    expect(message).toContain('C:/state/audit-1.json')
    expect(message).toContain('正常')
    expect(message).toContain('模型数：18')
    expect(message).toContain('由 litellm 插件生成')
  })

  test('失败消息不含路径且不拼接原始异常文本', () => {
    const message = buildFeedbackMessage({ ok: false, error: '审查报告目录不可写' })
    expect(message).toContain(FEEDBACK_MARKER)
    expect(message).toContain('审查报告目录不可写')
    expect(message).not.toContain('路径：')
    expect(message).not.toContain('undefined')
    expect(message).not.toContain('null')
  })

  test('连接状态与空清单给出不同标签', () => {
    expect(buildFeedbackMessage({ ok: true, path: '/p.json', status: 'switching', modelCount: 0 })).toContain('连接切换')
    expect(buildFeedbackMessage({ ok: true, path: '/p.json', status: 'cleared-auth', modelCount: 0 })).toContain('认证失败')
    expect(buildFeedbackMessage({ ok: true, path: '/p.json', status: 'empty', modelCount: 0 })).toContain('发现成功但无可用模型')
    const stale = buildFeedbackMessage({ ok: true, path: '/p.json', status: 'stale', modelCount: 3 })
    expect(stale).toContain('保留上次成功结果')
    expect(stale).toContain('模型数为上次成功发现的结果')
  })

  test('内容边界：不包含报告载荷字段', () => {
    const message = buildFeedbackMessage({ ok: true, path: '/p.json', status: 'ready', modelCount: 2 })
    expect(message).not.toContain('schemaVersion')
    expect(message).not.toContain('cost')
    expect(message).not.toContain('cache')
    expect(message).not.toContain('providerID')
  })

  test('路径编码安全：空格、引号、反斜杠、换行、控制字符、Unicode', () => {
    const dangerous =
      'C:/state dir/' + QUOTE + 'q' + QUOTE + '/' + ESC + 'back' + ESC + 'slash/line' + NL + 'break/tab' + TAB + 'x/ctrl' + BEL + 'y/中文' + ESC + 'u4e2d.json'
    const encoded = encodePathForMessage(dangerous)
    expect(encoded).not.toContain(NL)
    expect(encoded).not.toContain(TAB)
    expect(encoded).not.toContain(BEL)
    expect(encoded).toContain(ESC + 'n')
    expect(encoded).toContain(ESC + 't')
    expect(encoded).toContain(ESC + 'u0007')
    expect(encoded).toContain('中文')
    const message = buildFeedbackMessage({ ok: true, path: dangerous, status: 'ready', modelCount: 1 })
    expect(message.split(NL)).toHaveLength(5)
  })
})

function fakeSession(behavior: 'resolve' | 'reject' | 'hang') {
  const calls: Array<{ sessionID: string; text: string }> = []
  const session: FeedbackSessionDomain = {
    prompt: async (input) => {
      calls.push(input)
      if (behavior === 'reject') throw new Error('session unavailable')
      if (behavior === 'hang') return new Promise(() => {})
      return { id: 'msg_1' }
    },
  }
  return { session, calls }
}

describe('反馈提交', () => {
  test('提交成功时调用会话输入并返回 true', async () => {
    const { session, calls } = fakeSession('resolve')
    const submitter = createFeedbackSubmitter(session)
    expect(await submitter.submit('session-1', { ok: true, path: '/p.json', status: 'ready', modelCount: 1 })).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.sessionID).toBe('session-1')
    expect(calls[0]!.text).toContain('/p.json')
  })

  test('拒绝时静默降级并返回 false', async () => {
    const errors: unknown[] = []
    const { session } = fakeSession('reject')
    const submitter = createFeedbackSubmitter(session, { onError: (error) => errors.push(error) })
    expect(await submitter.submit('session-1', { ok: true, path: '/p.json', status: 'ready', modelCount: 1 })).toBe(false)
    expect(errors).toHaveLength(1)
  })

  test('挂起时超时降级且不无限阻塞', async () => {
    const { session } = fakeSession('hang')
    const submitter = createFeedbackSubmitter(session, { timeoutMs: 30 })
    const started = Date.now()
    expect(await submitter.submit('session-1', { ok: true, path: '/p.json', status: 'ready', modelCount: 1 })).toBe(false)
    expect(Date.now() - started).toBeLessThan(500)
  })
})
