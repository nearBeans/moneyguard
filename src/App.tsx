import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { getBudgetStatus, getPurchaseThresholds, shouldWarnOnPurchase } from './logic'

type TabName = 'month' | 'week' | 'settings'
type Category = '日常雑費' | '趣味・推し活' | '外食' | 'その他'
type AllowanceType = 'weekly' | 'monthly'

type Transaction = {
  id: string
  date: string
  amount: number
  category: Category
  item_name: string
  purchase_place: string
}

type PendingListItem = {
  id: string
  created_at: string
  amount: number
  category: Category
  item_name: string
  purchase_place: string
  expire_at: string
}

type Settings = {
  allowance_type: AllowanceType
  allowance_amount: number
  system_threshold_daily: number
  system_threshold_hobby: number
}

type StoredState = {
  last_reset_week: string | null
  weekly_limit: number
  settings: Settings
  weekly_spent_amount: number
  weekly_charged_flag: boolean
  transactions: Transaction[]
  pending_list: PendingListItem[]
}

const STORAGE_KEY = 'moneyguard-data-v1'
const categories: Category[] = ['日常雑費', '趣味・推し活', '外食', 'その他']
const categoryColors: Record<Category, string> = {
  '日常雑費': '#2E5A44',
  '趣味・推し活': '#000000',
  外食: '#D9383A',
  その他: '#C28800',
}

const defaultState: StoredState = {
  last_reset_week: null,
  weekly_limit: 2000,
  settings: {
    allowance_type: 'weekly',
    allowance_amount: 2000,
    system_threshold_daily: 1000,
    system_threshold_hobby: 3000,
  },
  weekly_spent_amount: 750,
  weekly_charged_flag: true,
  transactions: [
    { id: 'tx_1', date: '2026-08-20T12:30:00', amount: 250, category: '日常雑費', item_name: 'おにぎり', purchase_place: 'ファミマ' },
    { id: 'tx_2', date: '2026-08-19T18:00:00', amount: 1800, category: '趣味・推し活', item_name: 'マンガ本', purchase_place: '書店' },
  ],
  pending_list: [
    {
      id: 'pd_1',
      created_at: '2026-08-20T18:00:00',
      amount: 1500,
      category: '趣味・推し活',
      item_name: 'マンガ本',
      purchase_place: '書店',
      expire_at: '2026-08-21T18:00:00',
    },
  ],
}

const defaultForm = {
  category: '日常雑費' as Category,
  amount: '',
  itemName: '',
  purchasePlace: '',
  pending: false,
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  }).format(value)

const formatDate = (value: string) => new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
}).format(new Date(value))

const formatCountdown = (remainingMs: number) => {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

const getWeekIdentifier = (date: Date) => {
  const current = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = current.getUTCDay() || 7
  current.setUTCDate(current.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(current.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil((((current.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${current.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

const getRemainingWeeksInMonth = (date: Date) => {
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  return Math.max(1, Math.ceil((lastDay - date.getDate() + 1) / 7))
}

const calculateWeeklyLimit = (settings: Settings, date: Date) => {
  if (settings.allowance_type === 'weekly') return settings.allowance_amount
  return settings.allowance_amount / getRemainingWeeksInMonth(date)
}

const sendNotification = (title: string, body: string) => {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  new Notification(title, { body })
}

function App() {
  const [tab, setTab] = useState<TabName>('week')
  const [data, setData] = useState<StoredState>(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return defaultState

    try {
      const parsed = JSON.parse(saved) as Partial<StoredState>
      const settings = { ...defaultState.settings, ...parsed.settings }
      return {
        ...defaultState,
        ...parsed,
        settings,
        weekly_limit: parsed.weekly_limit ?? calculateWeeklyLimit(settings, new Date()),
      }
    } catch {
      return defaultState
    }
  })
  const [form, setForm] = useState(defaultForm)
  const [isExpenseOpen, setIsExpenseOpen] = useState(false)
  const [isAlertOpen, setIsAlertOpen] = useState(false)
  const [showStartupWarning, setShowStartupWarning] = useState(false)
  const [pendingDraft, setPendingDraft] = useState<Transaction | null>(null)
  const [now, setNow] = useState(Date.now())
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const resetLocalStorage = () => {
    if (!window.confirm('保存されている支出データを初期状態に戻しますか？')) return

    localStorage.removeItem(STORAGE_KEY)
    setData({
      ...defaultState,
      settings: { ...defaultState.settings },
      weekly_limit: calculateWeeklyLimit(defaultState.settings, new Date()),
      transactions: [],
      pending_list: [],
      weekly_spent_amount: 0,
      weekly_charged_flag: false,
      last_reset_week: getWeekIdentifier(new Date()),
    })
    setForm(defaultForm)
    setTab('week')
  }

  const currentWeek = getWeekIdentifier(new Date(now))
  const weeklyRemaining = data.weekly_limit - data.weekly_spent_amount
  const purchaseThresholds = getPurchaseThresholds(data.settings.allowance_amount)
  const currentMonthSpent = useMemo(
    () => data.transactions.reduce((sum, item) => sum + item.amount, 0),
    [data.transactions],
  )

  const monthlyBudget = data.settings.allowance_type === 'monthly'
    ? data.settings.allowance_amount
    : data.settings.allowance_amount * 4
  const monthStatus = getBudgetStatus(currentMonthSpent, Math.max(monthlyBudget, 1), new Date().getDate(), new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate())
  const monthAlert = monthStatus !== 'safe'

  const categoryTotals = categories.map((category) => ({
    category,
    total: data.transactions
      .filter((item) => item.category === category)
      .reduce((sum, item) => sum + item.amount, 0),
  }))

  const donutGradient = `conic-gradient(${categoryTotals
    .filter((entry) => entry.total > 0)
    .map((entry, index, array) => {
      const total = array.reduce((sum, current) => sum + current.total, 0)
      const start = array.slice(0, index).reduce((sum, current) => sum + current.total, 0)
      const end = start + entry.total
      return `${categoryColors[entry.category]} ${(start / total) * 100}% ${(end / total) * 100}%`
    })
    .join(', ') || '#F9F9F6 0 100%'})`

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }, [data])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    setData((current) => {
      if (current.last_reset_week === currentWeek) return current

      return {
        ...current,
        last_reset_week: currentWeek,
        weekly_limit: calculateWeeklyLimit(current.settings, new Date(now)),
        weekly_spent_amount: 0,
        weekly_charged_flag: false,
      }
    })
  }, [currentWeek])

  useEffect(() => {
    if (data.last_reset_week !== currentWeek) return

    const nextWeeklyLimit = calculateWeeklyLimit(data.settings, new Date(now))
    setData((current) => current.weekly_limit === nextWeeklyLimit
      ? current
      : { ...current, weekly_limit: nextWeeklyLimit })
  }, [data.settings.allowance_amount, data.settings.allowance_type])

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {})
    }
  }, [])

  useEffect(() => {
    const expired = data.pending_list.filter((item) => new Date(item.expire_at).getTime() <= now)
    expired.forEach((item) => {
      sendNotification('24時間保留が終了しました', `${item.item_name}の24時間保留が終わりました。購入か削除を選択してください。`)
    })
  }, [data.pending_list, now])

  useEffect(() => {
    if (!data.weekly_charged_flag || weeklyRemaining <= 0) {
      setShowStartupWarning(true)
    }
  }, [data.weekly_charged_flag, weeklyRemaining])

  const handleSaveTransaction = (transaction: Transaction) => {
    setData((current) => ({
      ...current,
      transactions: [transaction, ...current.transactions],
      weekly_spent_amount: current.weekly_spent_amount + transaction.amount,
    }))
    setIsExpenseOpen(false)
    setForm(defaultForm)
    setIsAlertOpen(false)
    setPendingDraft(null)
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const amount = Number(form.amount)
    if (!amount || amount <= 0) return

    const itemName = form.itemName.trim() || form.category
    const purchasePlace = form.purchasePlace.trim() || '場所未入力'
    const newTransaction: Transaction = {
      id: `tx_${Date.now()}`,
      date: new Date().toISOString(),
      amount,
      category: form.category,
      item_name: itemName,
      purchase_place: purchasePlace,
    }

    if (form.pending) {
      const pendingItem: PendingListItem = {
        id: `pd_${Date.now()}`,
        created_at: new Date().toISOString(),
        amount,
        category: form.category,
        item_name: itemName,
        purchase_place: purchasePlace,
        expire_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }

      setData((current) => ({
        ...current,
        pending_list: [pendingItem, ...current.pending_list],
      }))
      setIsExpenseOpen(false)
      setForm(defaultForm)
      return
    }

    if (shouldWarnOnPurchase(amount, form.category, purchaseThresholds)) {
      setPendingDraft(newTransaction)
      setIsAlertOpen(true)
      return
    }

    handleSaveTransaction(newTransaction)
  }

  const handlePendingAction = (pendingId: string, mode: 'delete' | 'purchase') => {
    setData((current) => {
      const item = current.pending_list.find((entry) => entry.id === pendingId)
      if (!item) return current

      const nextPending = current.pending_list.filter((entry) => entry.id !== pendingId)
      if (mode === 'delete') {
        return { ...current, pending_list: nextPending }
      }

      const transaction: Transaction = {
        id: `tx_${Date.now()}`,
        date: new Date().toISOString(),
        amount: item.amount,
        category: item.category,
        item_name: item.item_name,
        purchase_place: item.purchase_place,
      }

      return {
        ...current,
        pending_list: nextPending,
        transactions: [transaction, ...current.transactions],
        weekly_spent_amount: current.weekly_spent_amount + item.amount,
      }
    })
  }

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'moneyguard-data.json'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const text = await file.text()
    try {
      const parsed = JSON.parse(text) as Partial<StoredState>
      const settings = { ...defaultState.settings, ...parsed.settings }
      setData({
        ...defaultState,
        ...parsed,
        settings,
        weekly_limit: parsed.weekly_limit ?? calculateWeeklyLimit(settings, new Date()),
      })
      setTab('settings')
    } catch {
      window.alert('JSONの読み込みに失敗しました。')
    }

    event.target.value = ''
  }

  const renderMonthTab = () => (
    <div className="tab-panel">
      <div className="donut-shell">
        <div className="donut-chart" style={{ background: donutGradient }}>
          <div className="donut-center">
            <span>今月の総支出額</span>
            <strong>{formatCurrency(currentMonthSpent)}</strong>
          </div>
        </div>
      </div>

      <div className="list-panel">
        <div className="list-header">
          <h3>月別ジャンル内訳</h3>
        </div>
        <ul className="category-list">
          {categoryTotals.map((item) => (
            <li key={item.category}>
              <span>
                <i style={{ background: categoryColors[item.category] }} />
                {item.category}
              </span>
              <strong>{formatCurrency(item.total)}</strong>
            </li>
          ))}
        </ul>
      </div>

      <div className="list-panel">
        <div className="list-header">
          <h3>支出履歴</h3>
        </div>
        <ul className="history-list">
          {data.transactions.map((item) => (
            <li key={item.id}>
              <div>
                <span className="history-category">{formatDate(item.date)} ・ {item.category}</span>
                <p>{item.item_name}</p>
                <small>{item.purchase_place || '場所未入力'}</small>
              </div>
              <strong>{formatCurrency(item.amount)}</strong>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )

  const renderWeekTab = () => (
    <div className="tab-panel week-panel">
      <div className="donut-shell">
        <div
          className="donut-chart week-chart"
          style={{
            background: `conic-gradient(#2E5A44 0 ${(data.weekly_spent_amount / Math.max(data.weekly_limit, 1)) * 100}%, #F9F9F6 ${(data.weekly_spent_amount / Math.max(data.weekly_limit, 1)) * 100}% 100%)`,
          }}
        >
          <div className="donut-center">
            <span>今週の残リミット</span>
            <strong>{formatCurrency(Math.max(weeklyRemaining, 0))}</strong>
          </div>
        </div>
      </div>

      <button type="button" className="record-button" onClick={() => setIsExpenseOpen(true)}>
        ＋ 支出を入力
      </button>

      <div className="list-panel">
        <div className="list-header">
          <h3>24時間 保留リスト</h3>
        </div>
        {data.pending_list.length > 0 ? (
          <ul className="pending-list">
            {data.pending_list.map((item) => {
              const remainingMs = new Date(item.expire_at).getTime() - now

              return (
                <li key={item.id}>
                  <div className="pending-main">
                    <p>{item.item_name}</p>
                    <small>{item.purchase_place || '場所未入力'} ・ {item.category}</small>
                  </div>
                  <div className="pending-meta">
                    <strong>{formatCurrency(item.amount)}</strong>
                    <span>{formatCountdown(remainingMs)}</span>
                    <div className="pending-actions">
                      <button type="button" className="text-button danger" onClick={() => handlePendingAction(item.id, 'delete')}>
                        削除
                      </button>
                      <button type="button" className="text-button" onClick={() => handlePendingAction(item.id, 'purchase')}>
                        購入する
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="empty-state">保留中の支出はありません。</p>
        )}
      </div>
    </div>
  )

  const renderSettingsTab = () => (
    <div className="tab-panel settings-panel">
      <div className="setting-field">
        <label>
          <span className="color-white">予算の設定</span>
          <select
            value={data.settings.allowance_type}
            onChange={(event) =>
              setData((current) => ({
                ...current,
                settings: { ...current.settings, allowance_type: event.target.value as AllowanceType },
              }))
            }
          >
            <option value="weekly">毎週</option>
            <option value="monthly">毎月</option>
          </select>
        </label>
      </div>

      <div className="setting-field">
        <label>
          <span className="color-white">{data.settings.allowance_type === 'weekly' ? '毎週の予算額' : '毎月の予算額'}</span>
          <input
            type="number"
            min="0"
            value={data.settings.allowance_amount}
            onChange={(event) => {
              const value = Number(event.target.value)
              setData((current) => ({
                ...current,
                settings: { ...current.settings, allowance_amount: value },
              }))
            }}
          />
        </label>
      </div>

      <div className="threshold-box">
        <h3>お小遣い連動アラート閾値</h3>
        <ul>
          <li>日常雑費: {purchaseThresholds.daily.toLocaleString()}円以上（20%）</li>
          <li>趣味費: {purchaseThresholds.hobby.toLocaleString()}円以上（60%）</li>
        </ul>
      </div>

      <div className="settings-actions">
        <button type="button" className="primary-button" onClick={handleExport}>エクスポート</button>
        <button type="button" className="secondary-button" onClick={() => fileInputRef.current?.click()}>インポート</button>
        <input ref={fileInputRef} type="file" accept=".json,application/json" hidden onChange={handleImport} />
      </div>

      <button type="button" className="reset-button" onClick={resetLocalStorage}>保存データをリセット</button>
    </div>
  )

  return (
    <div className="moneyguard-app">
      <header className="topbar">
        <h1>MoneyGuard</h1>
      </header>

      <main className={`content-shell ${monthAlert ? 'alert-shell' : ''}`}>
        {tab === 'month' && renderMonthTab()}
        {tab === 'week' && renderWeekTab()}
        {tab === 'settings' && renderSettingsTab()}
      </main>

      <nav className="bottom-nav" aria-label="メインナビゲーション">
        <button type="button" className={tab === 'month' ? 'nav-tab left active' : 'nav-tab left'} onClick={() => setTab('month')}>
          今月
        </button>
        <button type="button" className={tab === 'week' ? 'nav-tab center active' : 'nav-tab center'} onClick={() => setTab('week')}>
          今週
        </button>
        <button type="button" className={tab === 'settings' ? 'nav-tab right active' : 'nav-tab right'} onClick={() => setTab('settings')}>
          設定
        </button>
      </nav>

      {isExpenseOpen && (
        <div className="modal-backdrop" onClick={() => setIsExpenseOpen(false)}>
          <div className="expense-modal" onClick={(event) => event.stopPropagation()}>
            <h2>支出入力</h2>
            <form onSubmit={handleSubmit} className="expense-form">
              <label>
                <span>カテゴリ</span>
                <select value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value as Category }))}>
                  {categories.map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </label>

              <label>
                <span>金額</span>
                <input type="number" inputMode="numeric" min="0" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} />
              </label>

              <label>
                <span>買ったもの</span>
                <input type="text" value={form.itemName} onChange={(event) => setForm((current) => ({ ...current, itemName: event.target.value }))} placeholder="例: おにぎり" />
              </label>

              <label>
                <span>買った場所</span>
                <input type="text" value={form.purchasePlace} onChange={(event) => setForm((current) => ({ ...current, purchasePlace: event.target.value }))} placeholder="例: コンビニ" />
              </label>

              <label className="checkbox-row">
                <input type="checkbox" checked={form.pending} onChange={(event) => setForm((current) => ({ ...current, pending: event.target.checked }))} />
                <span>24時間保留</span>
              </label>

              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setIsExpenseOpen(false)}>キャンセル</button>
                <button type="submit" className="primary-button">記録する</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showStartupWarning && (
        <div className="modal-backdrop" onClick={() => setShowStartupWarning(false)}>
          <div className="warning-modal" onClick={(event) => event.stopPropagation()}>
            <div className="warning-icon">⚠️</div>
            <h2>警告</h2>
            <p>予算の上限が近づいています。24時間ルールを適用してください。</p>
            <button type="button" className="primary-button" onClick={() => setShowStartupWarning(false)}>確認</button>
          </div>
        </div>
      )}

      {isAlertOpen && pendingDraft && (
        <div className="modal-backdrop" onClick={() => setIsAlertOpen(false)}>
          <div className="warning-modal" onClick={(event) => event.stopPropagation()}>
            <div className="warning-icon">⚠️</div>
            <h2>警告</h2>
            <p>これは今すぐ必要な支出ですか？将来の予算を圧迫します。</p>
            <div className="alert-meta">
              <span>{pendingDraft.category}</span>
              <strong>{formatCurrency(pendingDraft.amount)}</strong>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setIsAlertOpen(false)}>いったん保留</button>
              <button type="button" className="primary-button" onClick={() => handleSaveTransaction(pendingDraft)}>そのまま記録</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
