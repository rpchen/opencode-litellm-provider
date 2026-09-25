import { describe, expect, test } from 'bun:test'
import { buildFeedbackMessage, FEEDBACK_MARKER } from '../src/host/audit-feedback.js'
import { createAuditReport } from '../src/host/audit.js'
import { buildModelSpecs } from '../src/core/build.js'
import litellmFixture from './fixtures/litellm-model-info.json' with { type: 'json' }
import modelsDevFixture from './fixtures/models-dev.json' with { type: 'json' }
import { createRegistrationView, type ProviderSnapshot } from '../src/host/register.js'

// 从固定 LiteLLM /v1/model/info 样本构造注册视图，再生成审查报告与对话反馈消息，
// 断言两者在模型数与状态上一致，且报告载荷（模型名、价格等）不进入消息。
const specs = buildModelSpecs(litellmFixture, modelsDevFixture, { contextTierCap: true, protocolOverrides: {} })

const view = createRegistrationView(specs, 'https://litellm.example/v1')
const snapshot: ProviderSnapshot = {
  ready: true,
  models: specs,
  audit: { status: 'ready', lastSuccessfulDiscoveryAt: '2026-09-25T00:00:00.000Z', view },
}

describe('对话反馈与审查报告的一致性（固定 fixtures）', () => {
  test('消息中的模型数与报告中的模型数一致', () => {
    const report = createAuditReport(snapshot.audit!, new Date('2026-09-25T01:02:03.000Z')) as {
      models: unknown[]
      status: string
    }
    const message = buildFeedbackMessage({
      ok: true,
      path: 'C:/state/audit.json',
      status: 'ready',
      modelCount: report.models.length,
    })
    expect(report.models.length).toBeGreaterThan(5)
    expect(message).toContain('模型数：' + String(report.models.length))
    expect(message).toContain('正常')
  })

  test('消息不包含 fixture 中的模型名、价格与凭据类字段', () => {
    const message = buildFeedbackMessage({
      ok: true,
      path: 'C:/state/audit.json',
      status: 'ready',
      modelCount: specs.length,
    })
    expect(message.startsWith(FEEDBACK_MARKER)).toBeTrue()
    // 报告载荷字段与 fixture 内容均不得进入消息
    expect(message).not.toContain('schemaVersion')
    expect(message).not.toContain('cost')
    expect(message).not.toContain('providerID')
    expect(message).not.toContain('litellm-model-info')
    expect(message).not.toContain('api_key')
    expect(message).not.toContain('litellm_credential_name')
    expect(message).not.toContain('api_base')
    // 消息行数固定为 5（4 个字段 + 1 条说明），不含任何逐模型条目
    expect(message.split(String.fromCharCode(10))).toHaveLength(5)
    // 取一个 fixture 中真实存在的模型名，确认它没有出现在消息里
    const sampleModelName = String(specs[0]!.name ?? '')
    expect(sampleModelName.length).toBeGreaterThan(0)
    expect(message).not.toContain(sampleModelName)
  })

  test('stale 状态消息仍与报告状态对应', () => {
    const staleAudit = { status: 'stale' as const, lastSuccessfulDiscoveryAt: '2026-09-25T00:00:00.000Z', view }
    const report = createAuditReport(staleAudit, new Date('2026-09-25T01:02:03.000Z')) as { status: string; models: unknown[] }
    expect(report.status).toBe('stale')
    const message = buildFeedbackMessage({ ok: true, path: '/p.json', status: 'stale', modelCount: report.models.length })
    expect(message).toContain('保留上次成功结果')
  })
})
