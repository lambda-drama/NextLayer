import { useState, useEffect } from 'react'

// ─── Entry row (one per journey × item) ──────────────────────────────────────
export interface ImportExportEntry {
  journey_id:      string
  transit_display: string
  transit_no:      string   // actual transit reference numbers, comma-joined
  // Cols 2–3
  item_code:       string
  item_name:       string
  description:     string
  // Cols 4–6
  units:           number | null
  price:           number | null    // transaction currency (e.g. USD)
  total_value:     number | null    // transaction currency (e.g. USD)
  transaction_currency: string      // SI invoice currency — for Price & Total Value
  // Meta
  posting_date:    string
  // Cols 7–11
  import_container: string
  export_container: string
  import_bl:        string
  export_bl:        string
  destination:      string
  // Col 12 — journey-level, first item row only
  freight:          number | null
  storage:          number | null
  // Col 13 — Export Charges Doonta (single col, journey-level)
  export_charges_doonta: number | null
  // Cols 14–15 — Import Charges group
  additional_costs:  number | null   // Joint Line
  import_havinder:   number | null   // Harvinder
  // Col 16 — Jebel Ali Expenses (single col, journey-level)
  jebel_ali:         number | null
  // Cols 17–18 — Export Charges group
  export_charges:    number | null   // Joint Line
  export_havinder:   number | null   // Harvinder
  // Cols 19–20
  export_transportation: number | null
  ectn:                  number | null
  // Col 21
  total:               number
  company_currency:    string   // for all distribution charges (LCV / SSC)
  source:              'import' | 'export' | 'both'
}

// ─── Totals footer ────────────────────────────────────────────────────────────
export interface ImportExportTotals {
  total_additional_costs:      number
  total_import_havinder:       number
  total_export_charges_doonta: number
  total_jebel_ali:             number
  total_export_charges:        number
  total_export_havinder:       number
  total_freight:               number
  total_storage:               number
  total_export_transportation: number
  total_ectn:                  number
  grand_total:                 number
}

export interface ImportExportData {
  entries:         ImportExportEntry[]
  totals:          ImportExportTotals
  filters_applied: Record<string, unknown>
}

// ─── Hook params ─────────────────────────────────────────────────────────────
interface UseImportExportExpenseParams {
  company:  string
  item:     string
  fromDate: string
  toDate:   string
  currency: string
  enabled:  boolean
}

export function useImportExportExpense({
  company,
  item,
  fromDate,
  toDate,
  currency,
  enabled,
}: UseImportExportExpenseParams) {
  const [data,      setData]      = useState<ImportExportData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  useEffect(() => {
    if (!enabled || !fromDate || !toDate) {
      setData(null)
      setError(null)
      return
    }

    const fetchData = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const filters = {
          company:   company  || undefined,
          item:      item     || undefined,
          from_date: fromDate,
          to_date:   toDate,
          currency:  currency === 'all' ? '' : currency,
        }
        const csrfToken =
          (window as unknown as { csrf_token?: string }).csrf_token || ''

        const response = await fetch(
          '/api/method/nextlayer.next_layer.api.import_export_expense.get_import_export_expense_report',
          {
            method:  'POST',
            headers: {
              'Content-Type':        'application/json',
              'Accept':              'application/json',
              'X-Frappe-CSRF-Token': csrfToken,
            },
            body:        JSON.stringify(filters),
            credentials: 'include',
          },
        )
        if (!response.ok) throw new Error(`HTTP ${response.status}`)

        const result = await response.json()
        if (result.message?.success) {
          setData(result.message)
        } else {
          setError(result.message?.error || 'Failed to fetch report data')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch report data')
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [enabled, company, item, fromDate, toDate, currency])

  return { data, isLoading, error }
}