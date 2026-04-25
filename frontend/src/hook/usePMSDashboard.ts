import { useState, useEffect, useCallback } from "react"

const CSRF = () =>
  (window as unknown as { csrf_token: string }).csrf_token ?? ""

async function apiFetch<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`/api/method/${method}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Frappe-CSRF-Token": CSRF(),
    },
    body: JSON.stringify(args),
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  const data = await res.json()
  if (data.exc) throw new Error(data.exc)
  return data.message as T
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface TopTenant {
  tenant_id: string
  tenant_name: string
  unit: string
  property: string
  monthly_rent: number
  company: string
}

export interface RevenueTrendPoint {
  month: string
  revenue: number
  collected: number
}

export interface PropertyStat {
  name: string
  property_name: string
  total_units: number
  occupied: number
  vacant: number
}

export interface DashboardOverview {
  total_properties: number
  total_units: number
  occupied_units: number
  vacant_units: number
  occupancy_rate: number
  active_contracts: number
  monthly_revenue: number
  total_outstanding: number
  lease_status: Record<string, number>
  top_tenants: TopTenant[]
  revenue_trend: RevenueTrendPoint[]
  property_stats: PropertyStat[]
}

export type UnitPaymentStatus = "paid" | "outstanding" | "overdue" | "no_invoice"

export interface UnitFinancial {
  contract: string
  unit: string
  property: string
  tenant_id: string
  tenant_name: string
  monthly_rent: number
  contract_status: string
  invoiced: number
  paid: number
  outstanding: number
  overdue: number
  invoice_count: number
  status: UnitPaymentStatus
}

export interface PendingInvoice {
  name: string
  posting_date: string
  due_date: string
  grand_total: number
  outstanding_amount: number
  custom_invoice_no: string
}

export interface Expense {
  name: string
  posting_date: string
  amount: number
  description: string
}

export interface ContractDetail {
  name: string
  party_name: string
  monthly_rent: number
  start_date: string
  end_date: string
  company: string
  currency: string
  invoice_grouping: string
}

export interface TenantDetail {
  tenant_name: string
  email_id: string
  mobile_no: string
  customer: string
}

export interface UnitDetail {
  unit: string
  property: string
  unit_status: string
  contract: ContractDetail | null
  tenant: TenantDetail | null
  pending_invoices: PendingInvoice[]
  invoice_history: PendingInvoice[]
  expenses: Expense[]
}

export interface MonthOption {
  value: string
  label: string
  month: number
  year: number
}

// ── Hooks ────────────────────────────────────────────────────────────────────

export function useDashboardOverview() {
  const [data, setData] = useState<DashboardOverview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await apiFetch<DashboardOverview>(
        "nextlayer.next_layer.api.pms_dashboard.get_dashboard_overview"
      )
      setData(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  return { data, loading, error, reload: load }
}

export function useFinancialOverview(month?: number, year?: number) {
  const [data, setData] = useState<UnitFinancial[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await apiFetch<UnitFinancial[]>(
        "nextlayer.next_layer.api.pms_dashboard.get_financial_overview",
        { month: month ?? null, year: year ?? null }
      )
      setData(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [month, year])

  useEffect(() => { load() }, [load])
  return { data, loading, error, reload: load }
}

export function useUnitDetail(unitName: string | null) {
  const [data, setData] = useState<UnitDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (name: string) => {
    setLoading(true)
    setError(null)
    try {
      const result = await apiFetch<UnitDetail>(
        "nextlayer.next_layer.api.pms_dashboard.get_unit_detail",
        { unit_name: name }
      )
      setData(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (unitName) load(unitName)
    else setData(null)
  }, [unitName, load])

  return { data, loading, error }
}

export function useAvailableMonths() {
  const [data, setData] = useState<MonthOption[]>([])

  useEffect(() => {
    apiFetch<MonthOption[]>(
      "nextlayer.next_layer.api.pms_dashboard.get_available_months"
    ).then(setData).catch(() => {})
  }, [])

  return data
}
