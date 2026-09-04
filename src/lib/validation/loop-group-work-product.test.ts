import fc from 'fast-check'
import { beforeAll, describe, expect, it } from 'vitest'
import archonContractText from '../../../contracts/archon-2026-07-v6.json?raw'
import { loadAuthoringContract } from '$src/lib/contract/contract-loader'
import { readScopedDagCapabilities, type ScopedDagCapabilities } from '$src/lib/contract/scoped-dag-rule'
import { calculateLoopGroupWorkProduct } from './loop-group-work-product'

let capabilities: ScopedDagCapabilities

beforeAll(async () => {
  const loaded = await loadAuthoringContract(new TextEncoder().encode(archonContractText), {
    kind: 'bundled',
    identifier: 'archon-2026-07-v6.json',
  })
  if (!loaded.ok) throw new Error(loaded.message)
  capabilities = readScopedDagCapabilities(loaded.contract)
})

function group(maxIterations: number, nodes: readonly Record<string, unknown>[]): Record<string, unknown> {
  return { id: 'group', loop_group: { max_iterations: maxIterations, until: 'done', nodes } }
}

describe('loop-group work-product calculation', () => {
  it('matches the literal Hermes attempts boundary for approval rejection', () => {
    const nodes = Array.from({ length: 8 }, (_, index) => ({
      id: `approve${index}`,
      approval: { message: 'Continue?', on_reject: { prompt: 'Revise.', max_attempts: 7 } },
    }))

    expect(calculateLoopGroupWorkProduct(group(64, nodes), capabilities)).toEqual({
      executions: 512,
      attempts: 4096,
      limit: 4096,
      exceeded: false,
    })
  })

  it('detects the literal Hermes one-over boundary from default prompt retries', () => {
    const nodes = [
      ...Array.from({ length: 80 }, (_, index) => ({ id: `prompt${index}`, prompt: 'Work.' })),
      { id: 'cancel', cancel: 'Stop.' },
    ]

    expect(calculateLoopGroupWorkProduct(group(17, nodes), capabilities)).toEqual({
      executions: 1377,
      attempts: 4097,
      limit: 4096,
      exceeded: true,
    })
  })

  it('applies nested ordinary-loop multipliers and retry precedence from the capability', () => {
    const candidate = group(10, [
      {
        id: 'loop',
        loop: { prompt: 'Repeat.', max_iterations: 5 },
        retry: { max_attempts: 4 },
      },
      {
        id: 'approval',
        approval: { message: 'Continue?', on_reject: { prompt: 'Revise.', max_attempts: 2 } },
        retry: { max_attempts: 99 },
      },
    ])

    expect(calculateLoopGroupWorkProduct(candidate, capabilities)).toEqual({
      executions: 60,
      attempts: 280,
      limit: 4096,
      exceeded: false,
    })
  })

  it.each([1, 100])('accepts the contract group-iteration boundary %i without changing arithmetic', (iterations) => {
    expect(calculateLoopGroupWorkProduct(group(iterations, [{ id: 'bash', bash: 'true' }]), capabilities)).toEqual({
      executions: iterations,
      attempts: iterations,
      limit: 4096,
      exceeded: false,
    })
  })

  it('matches the contract expression for bounded nested loop and retry values', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 0, max: 20 }),
        (groupIterations, loopIterations, retries) => {
          const candidate = group(groupIterations, [
            {
              id: 'nested',
              loop: { prompt: 'Repeat.', max_iterations: loopIterations },
              retry: { max_attempts: retries },
            },
          ])
          const result = calculateLoopGroupWorkProduct(candidate, capabilities)

          expect(result.executions).toBe(groupIterations * loopIterations)
          expect(result.attempts).toBe(groupIterations * loopIterations * (retries + 1))
          expect(result.exceeded).toBe(
            result.executions > capabilities.workProduct.limit || result.attempts > capabilities.workProduct.limit,
          )
        },
      ),
    )
  })
})
