import { useState, useEffect } from 'react'

export interface ImportExportEntry {
  journey_id: string
  transit_display: string
  item_code: string
  item_name: string
  description: string
  posting_date: string
  import_container: string
  export_container: string
  export_bl: string
  freight: number | null
  storage: number | null
  additional_costs: number | null
  export_charges: number | null
  total: number
  currency: string
  source: 'import' | 'export' | 'both'
}

export interface ImportExportTotals {
  total_additional_costs: number
  total_export_charges: number
  total_freight: number
  total_storage: number
  grand_total: number
}

export interface ImportExportData {
  entries: ImportExportEntry[]
  totals: ImportExportTotals
  filters_applied: Record<string, unknown>
}

interface UseImportExportExpenseParams {
  company: string
  item: string
  fromDate: string
  toDate: string
  currency: string
  enabled: boolean
}

export function useImportExportExpense({
  company,
  item,
  fromDate,
  toDate,
  currency,
  enabled
}: UseImportExportExpenseParams) {
  const [data, setData] = useState<ImportExportData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
          company: company || undefined,
          item: item || undefined,
          from_date: fromDate,
          to_date: toDate,
          currency: currency === 'all' ? '' : currency
        }
        const csrfToken = (window as unknown as { csrf_token?: string }).csrf_token || ''
        const response = await fetch('/api/method/nextlayer.next_layer.api.import_export_expense.get_import_export_expense_report', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Frappe-CSRF-Token': csrfToken
          },
          body: JSON.stringify(filters),
          credentials: 'include'
        })
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
