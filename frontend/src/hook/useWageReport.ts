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

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WageSummary {
  total_entries: number
  total_amount: number
  total_workers: number
  unique_projects: number
  submitted_count: number
  draft_count: number
  today_count: number
  today_amount: number
}

export interface WageEntry {
  name: string
  date: string
  wage_type: string
  start_date: string
  end_date: string
  project: string
  stage: string
  company: string
  currency: string
  total_qty: number
  total_amount: number
  docstatus: number
  status_label: string
  description: string
  wage_category: string
  average_working_hours: number
}

export interface WageBreakdownRow {
  idx: number
  type_of_work: string
  name1: string
  rate: number
  qty: number
  amount: number
  checkin: string
  checkout: string
  phone_no: string
  description: string
  daily_wage: number
  duration: number
}

export interface WorkTypeRow {
  type_of_work: string
  no_of_workers: number
  total_qty: number
  total_amount: number
  daily_wage: number
}

export interface WageEntryDetail {
  name: string
  date: string
  wage_type: string
  start_date: string
  end_date: string
  project: string
  stage: string
  company: string
  currency: string
  total_qty: number
  total_amount: number
  docstatus: number
  description: string
  default_expense_account: string
  default_payable_account: string
  wage_category: string
  average_working_hours: number
  wages: WageBreakdownRow[]
  work_breakdown: WorkTypeRow[]
}

export interface FilterOption { value: string; label: string }
export interface WageFilterOptions {
  /** Deprecated for UI — projects load via get_wage_projects_for_company when company is chosen */
  projects?: FilterOption[]
  companies: FilterOption[]
  statuses: FilterOption[]
}

export interface WageTrendPoint {
  date: string
  date_label: string
  amount: number
  workers: number
}

// ── Filters state ─────────────────────────────────────────────────────────────

export interface WageFilters {
  project?: string
  date_from?: string
  date_to?: string
  status?: string
  company?: string
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useWageSummary(filters: WageFilters) {
  const [data, setData] = useState<WageSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const result = await apiFetch<WageSummary>(
        "nextlayer.next_layer.api.wage_report.get_wage_summary",
        filters as Record<string, unknown>
      )
      setData(result)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [JSON.stringify(filters)])

  useEffect(() => { load() }, [load])
  return { data, loading, error, reload: load }
}

export function useWageEntries(filters: WageFilters) {
  const [data, setData] = useState<WageEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const result = await apiFetch<WageEntry[]>(
        "nextlayer.next_layer.api.wage_report.get_wage_entries",
        filters as Record<string, unknown>
      )
      setData(result)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [JSON.stringify(filters)])

  useEffect(() => { load() }, [load])
  return { data, loading, error, reload: load }
}

export function useWageEntryDetail(name: string | null) {
  const [data, setData] = useState<WageEntryDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!name) { setData(null); return }
    setLoading(true); setError(null)
    apiFetch<WageEntryDetail>(
      "nextlayer.next_layer.api.wage_report.get_wage_entry_detail",
      { name }
    ).then(setData).catch(e => setError(e instanceof Error ? e.message : String(e)))
    .finally(() => setLoading(false))
  }, [name])

  return { data, loading, error }
}

export function useWageFilterOptions() {
  const [companies, setCompanies] = useState<FilterOption[]>([])
  const [statuses, setStatuses] = useState<FilterOption[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    apiFetch<WageFilterOptions>(
      "nextlayer.next_layer.api.wage_report.get_wage_filter_options"
    )
      .then(d => {
        setCompanies(d.companies ?? [])
        setStatuses(d.statuses ?? [])
      })
      .catch(() => {
        setCompanies([])
        setStatuses([])
      })
      .finally(() => setLoading(false))
  }, [])

  return { companies, statuses, loading }
}

/** Projects linked to the selected company only (permission-checked server-side). */
export function useWageProjectsForCompany(company: string | undefined, allToken = "__all__") {
  const [projects, setProjects] = useState<FilterOption[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!company || company === allToken) {
      setProjects([])
      return
    }
    let cancelled = false
    setLoading(true)
    apiFetch<FilterOption[]>(
      "nextlayer.next_layer.api.wage_report.get_wage_projects_for_company",
      { company }
    )
      .then(rows => {
        if (!cancelled) setProjects(rows ?? [])
      })
      .catch(() => {
        if (!cancelled) setProjects([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [company, allToken])

  return { projects, loading }
}

export function useWageTrend(project?: string, company?: string) {
  const [data, setData] = useState<WageTrendPoint[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await apiFetch<WageTrendPoint[]>(
        "nextlayer.next_layer.api.wage_report.get_wage_trend",
        { project: project || undefined, company: company || undefined, days: 30 }
      )
      setData(result)
    } catch { }
    finally { setLoading(false) }
  }, [project, company])

  useEffect(() => { load() }, [load])
  return { data, loading, reload: load }
}
