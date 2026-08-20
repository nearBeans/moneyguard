import { describe, expect, it } from 'vitest'
import { getBudgetStatus, getMonthlyProgress, getPurchaseThresholds, shouldWarnOnPurchase } from './logic'

describe('MoneyGuard logic', () => {
  it('flags a large hobby purchase', () => {
    expect(shouldWarnOnPurchase(3500, '趣味・推し活')).toBe(true)
    expect(shouldWarnOnPurchase(900, '日常雑費')).toBe(false)
  })

  it('calculates warning thresholds from the allowance', () => {
    const thresholds = getPurchaseThresholds(5000)

    expect(thresholds).toEqual({ daily: 1000, hobby: 3000 })
    expect(shouldWarnOnPurchase(1000, '日常雑費', thresholds)).toBe(true)
    expect(shouldWarnOnPurchase(2999, '趣味・推し活', thresholds)).toBe(false)
  })

  it('detects the budget pace risk', () => {
    const pace = getMonthlyProgress(7000, 10000, 20, 31)

    expect(pace.progress).toBeGreaterThan(0.6)
    expect(pace.isOverPace).toBe(true)
    expect(getBudgetStatus(7000, 10000, 20, 31)).toBe('danger')
  })

  it('marks a healthy month as safe', () => {
    expect(getBudgetStatus(2500, 10000, 10, 31)).toBe('safe')
  })
})
