import { describe, expect, test } from 'bun:test'
import type { Plugin } from '@opencode/plugin'
import { registerAudit } from '../src/host/audit-command.js'
import { createRegistrationView, type ProviderSnapshot } from '../src/host/register.js'
import type { AuditSnapshot } from '../src/host/register.js'

interface Prompts {
  calls: Array<{ sessionID: string; text: string }>
}

function harness(
  snapshot: ProviderSnapshot,
  writeFile: (report: object) => Promise<string>,
  options: { promptBehavior?: 'resolve' | 'reject' | 'hang' } = {},
) {
  let command: { execute: (input: { sessionID: string }) => Promise<void> } | undefined
  let handlers: { export: (input: { sessionID: string }) => Promise<unknown>; latest: () => Promise<unknown> } | undefined
  let emits: unknown[] = []
  let disposed = 0
  const prompts: Prompts = { calls: [] }
  const context = {
    rpc: {
      register: async (_schema: unknown, input: typeof handlers) => {
        handlers = input
        return { events: { emit: async (_event: string, value: unknown) => { emits.push(value) } }, dispose: async () => { disposed++ } }
      },
    },
    command: {
      transform: async (register: (editor: { add(value: typeof command): void }) => void) => {
        register({ add(value) { command = value } })
        return { dispose: async () => { disposed++ } }
      },
    },
    session: {
      prompt: async (input: { sessionID: string; text: string }) => {
        prompts.calls.push(input)
        const behavior = options.promptBehavior ?? 'resolve'
        if (behavior === 'reject') throw new Error('session unavailable')
        if (behavior === 'hang') return new Promise(() => {})
        return { id: 'msg_1' }
      },
    },
  } as unknown as Pick<Plugin.Context, 'rpc' | 'command' | 'session'>
  return {
    context,
    get command() { return command! },
    get handlers() { return handlers! },
    get emits() { return emits },
    get disposed() { return disposed },
    get prompts() { return prompts },
    writeFile,
  }
}

function auditSnapshot(status: AuditSnapshot['status'], modelCount: number): AuditSnapshot {
  return {
    status,
    lastSuccessfulDiscoveryAt: '2026-09-25T00:00:00.000Z',
    view: createRegistrationView(
      Array.from({ length: modelCount }, (_unused, index) => ({
        id: 'model-' + String(index),
        name: 'model-' + String(index),
        protocol: 'chat' as const,
        package: '@opencode/ai/providers/openai-compatible',
        capabilities: { tools: true, input: ['text'], output: ['text'] },
        variants: [],
        released: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        limit: { context: 8192, input: 8192, output: 1024 },
      })),
      'https://private.example/v1',
    ),
  }
}

const snapshot: ProviderSnapshot = {
  ready: true,
  models: [],
  audit: { status: 'empty', view: createRegistrationView([], 'https://private.example/v1') },
}

describe('审查导出命令', () => {
  test('命令写入 JSON 并通过事件和 latest 返回绝对路径，无需模型请求', async () => {
    const written: object[] = []
    const h = harness(snapshot, async (report) => {
      written.push(report)
      return 'C:/audit/example.json'
    })
    const registration = await registerAudit(h.context, snapshot, { writeFile: h.writeFile })
    expect(await h.handlers.latest()).toEqual({ sequence: 0, sessionID: '', ok: false, path: '', error: '' })
    await h.command.execute({ sessionID: 'session-1' })
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({ status: 'empty', models: [] })
    expect(h.emits).toEqual([{ sequence: 1, sessionID: 'session-1', ok: true, path: 'C:/audit/example.json', error: '' }])
    expect(await h.handlers.latest()).toEqual(h.emits[0])
    expect(await h.handlers.export({ sessionID: 'session-2' })).toEqual({ sequence: 2, sessionID: 'session-2', ok: true, path: 'C:/audit/example.json', error: '' })
    // 开关默认关闭：命令路径也不得调用会话输入 API
    expect(h.prompts.calls).toEqual([])
    await registration.dispose()
    expect(h.disposed).toBe(2)
  })

  test('失败仅传递允许的错误类别，不泄漏异常或影响后续导出', async () => {
    let attempts = 0
    const h = harness(snapshot, async () => {
      attempts++
      if (attempts === 1) throw Object.assign(new Error('sk-fixture-not-real https://private.example'), { code: 'EACCES' })
      return 'C:/audit/recovered.json'
    })
    const registration = await registerAudit(h.context, snapshot, { writeFile: h.writeFile })
    await h.command.execute({ sessionID: 'first' })
    expect(await h.handlers.latest()).toEqual({ sequence: 1, sessionID: 'first', ok: false, path: '', error: '审查报告目录不可写' })
    expect(JSON.stringify(h.emits)).not.toContain('private.example')
    expect(JSON.stringify(h.emits)).not.toContain('sk-fixture-not-real')
    await h.command.execute({ sessionID: 'second' })
    expect(await h.handlers.latest()).toEqual({ sequence: 2, sessionID: 'second', ok: true, path: 'C:/audit/recovered.json', error: '' })
    await registration.dispose()
  })

  test('开关开启时命令提交对话反馈，含状态、路径与模型数', async () => {
    const counted: ProviderSnapshot = { ready: true, models: [], audit: auditSnapshot('ready', 7) }
    const h = harness(counted, async () => 'C:/audit/report.json')
    const registration = await registerAudit(h.context, counted, {
      writeFile: h.writeFile,
      conversationFeedback: true,
    })
    await h.command.execute({ sessionID: 'session-9' })
    expect(h.prompts.calls).toHaveLength(1)
    expect(h.prompts.calls[0]!.sessionID).toBe('session-9')
    expect(h.prompts.calls[0]!.text).toContain('C:/audit/report.json')
    expect(h.prompts.calls[0]!.text).toContain('模型数：7')
    expect(h.prompts.calls[0]!.text).toContain('正常')
    await registration.dispose()
  })

  test('RPC 导出不触发对话反馈（负向）', async () => {
    const counted: ProviderSnapshot = { ready: true, models: [], audit: auditSnapshot('ready', 3) }
    const h = harness(counted, async () => 'C:/audit/rpc.json')
    const registration = await registerAudit(h.context, counted, {
      writeFile: h.writeFile,
      conversationFeedback: true,
    })
    await h.handlers.export({ sessionID: 'session-rpc' })
    expect(h.prompts.calls).toEqual([])
    expect(h.emits).toHaveLength(1)
    await registration.dispose()
  })

  test('快照一致性：写入期间状态变化，反馈仍对应报告快照', async () => {
    const audited: ProviderSnapshot = { ready: true, models: [], audit: auditSnapshot('ready', 5) }
    const h = harness(audited, async () => {
      // 模拟写入期间连接切换：状态被替换为 0 模型
      audited.audit = auditSnapshot('switching', 0)
      return 'C:/audit/atomic.json'
    })
    const registration = await registerAudit(h.context, audited, {
      writeFile: h.writeFile,
      conversationFeedback: true,
    })
    await h.command.execute({ sessionID: 'session-atomic' })
    expect(h.prompts.calls).toHaveLength(1)
    // 消息必须对应写入文件的那次快照（5 个模型、ready），而不是写入后的 0/switching
    expect(h.prompts.calls[0]!.text).toContain('模型数：5')
    expect(h.prompts.calls[0]!.text).toContain('正常')
    expect(h.prompts.calls[0]!.text).not.toContain('连接切换')
    await registration.dispose()
  })

  test('连接状态边界：切换、认证清空、空清单、stale 各自标注', async () => {
    const cases: Array<{ status: AuditSnapshot['status']; count: number; expected: string }> = [
      { status: 'switching', count: 0, expected: '连接切换' },
      { status: 'cleared-auth', count: 0, expected: '认证失败' },
      { status: 'empty', count: 0, expected: '发现成功但无可用模型' },
      { status: 'stale', count: 4, expected: '保留上次成功结果' },
    ]
    for (const item of cases) {
      const state: ProviderSnapshot = { ready: true, models: [], audit: auditSnapshot(item.status, item.count) }
      const h = harness(state, async () => 'C:/audit/state.json')
      const registration = await registerAudit(h.context, state, {
        writeFile: h.writeFile,
        conversationFeedback: true,
      })
      await h.command.execute({ sessionID: 'session-state' })
      expect(h.prompts.calls[0]!.text).toContain(item.expected)
      expect(h.prompts.calls[0]!.text).toContain('模型数：' + String(item.count))
      await registration.dispose()
    }
  })

  test('反馈失败或挂起不影响导出结果与既有通道', async () => {
    const state: ProviderSnapshot = { ready: true, models: [], audit: auditSnapshot('ready', 2) }
    const rejecting = harness(state, async () => 'C:/audit/keep.json', { promptBehavior: 'reject' })
    const registration = await registerAudit(rejecting.context, state, {
      writeFile: rejecting.writeFile,
      conversationFeedback: true,
    })
    await rejecting.command.execute({ sessionID: 'session-x' })
    expect(await rejecting.handlers.latest()).toEqual({ sequence: 1, sessionID: 'session-x', ok: true, path: 'C:/audit/keep.json', error: '' })
    expect(rejecting.emits).toHaveLength(1)
    await registration.dispose()

    const hanging = harness(state, async () => 'C:/audit/hang.json', { promptBehavior: 'hang' })
    const hangingRegistration = await registerAudit(hanging.context, state, {
      writeFile: hanging.writeFile,
      conversationFeedback: true,
      createSubmitter: (session) => {
        // 注入短超时的提交器，验证命令不会被挂起的会话输入阻塞
        const { createFeedbackSubmitter } = require('../src/host/audit-feedback.js') as typeof import('../src/host/audit-feedback.js')
        return createFeedbackSubmitter(session, { timeoutMs: 30 })
      },
    })
    const started = Date.now()
    await hanging.command.execute({ sessionID: 'session-hang' })
    expect(Date.now() - started).toBeLessThan(1000)
    expect(await hanging.handlers.latest()).toMatchObject({ ok: true, path: 'C:/audit/hang.json' })
    await hangingRegistration.dispose()
  })

  test('失败导出的反馈不含路径', async () => {
    const state: ProviderSnapshot = { ready: true, models: [], audit: auditSnapshot('ready', 1) }
    const h = harness(state, async () => { throw Object.assign(new Error('boom'), { code: 'EACCES' }) })
    const registration = await registerAudit(h.context, state, {
      writeFile: h.writeFile,
      conversationFeedback: true,
    })
    await h.command.execute({ sessionID: 'session-fail' })
    expect(h.prompts.calls).toHaveLength(1)
    expect(h.prompts.calls[0]!.text).toContain('导出失败')
    expect(h.prompts.calls[0]!.text).not.toContain('路径：')
    expect(h.prompts.calls[0]!.text).not.toContain('boom')
    await registration.dispose()
  })
})
