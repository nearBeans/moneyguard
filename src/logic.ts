export type BudgetStatus = 'safe' | 'warning' | 'danger'

export const DAILY_THRESHOLD_RATE = 0.2
export const HOBBY_THRESHOLD_RATE = 0.6

export function getPurchaseThresholds(allowanceAmount: number) {
  return {
    daily: Math.max(1, Math.round(allowanceAmount * DAILY_THRESHOLD_RATE)),
    hobby: Math.max(1, Math.round(allowanceAmount * HOBBY_THRESHOLD_RATE)),
  }
}

export function shouldWarnOnPurchase(
  amount: number,
  category: string,
  thresholds = { daily: 1000, hobby: 3000 },
) {
  const normalized = category.trim()
  if (normalized === '日常雑費' && amount >= thresholds.daily) return true
  if (normalized === '趣味・推し活' && amount >= thresholds.hobby) return true
  return false
}

export function getMonthlyProgress(currentSpent: number, monthlyBudget: number, elapsedDays: number, daysInMonth: number) {
  const progress = currentSpent / monthlyBudget
  const pace = elapsedDays / daysInMonth
  return { progress, pace, isOverPace: progress > pace }
}

export function getBudgetStatus(currentSpent: number, monthlyBudget: number, elapsedDays: number, daysInMonth: number): BudgetStatus {
  const { progress, pace, isOverPace } = getMonthlyProgress(currentSpent, monthlyBudget, elapsedDays, daysInMonth)

  if (isOverPace || progress >= 0.9) return 'danger'
  if (progress >= 0.7 || pace > 0.6) return 'warning'
  return 'safe'
}
