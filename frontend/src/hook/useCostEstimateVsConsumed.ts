import { useState, useEffect } from "react"

export interface CostEstimateVsConsumedEntry {
  project: string
  key_type: "Item" | "Item Group"
  key: string
  label: string
  estimate_qty: number
  estimate_amount: number
  consumed_qty: number
  consumed_amount: number
  variance_qty: number
  variance_amount: number
  currency: string
}

export interface CostEstimateVsConsumedTotals {
  estimate_amount: number
  consumed_amount: number
  variance_amount: number
  estimate_qty: number
  consumed_qty: number
  variance_qty: number
}

export interface CostEstimateVsConsumedMeta {
  company: string
  project: string
  display_currency: string
  company_currency: string
  estimate_name: string
  estimate_grand_total: number
  estimate_selling_price_after_profit: number
  estimate_labor: number
  estimate_overhead: number
  consumed_total: number
  labor_by_expense_account?: Record<string, number>
  labor_actual_by_expense_account?: Record<string, number>
  labor_variance_by_expense_account?: Record<string, number>
  overhead_by_expense_account?: Record<string, number>
  overhead_actual_by_expense_account?: Record<string, number>
  overhead_variance_by_expense_account?: Record<string, number>
  group_items?: Record<
    string,
    {
      item_code: string
      item_group: string
      purchase_qty: number
      purchase_amount_ccy: number
      consumed_qty: number
      consumed_amount_ccy: number
    }[]
  >
  message?: string
}

export interface CostEstimateVsConsumedData {
  entries: CostEstimateVsConsumedEntry[]
  totals: CostEstimateVsConsumedTotals
  meta: CostEstimateVsConsumedMeta
}

interface UseCostEstimateVsConsumedParams {
  company: string
  project: string
  projectType: string
  fromDate: string
  toDate: string
  currency: string
  enabled: boolean
}

export function useCostEstimateVsConsumed({
  company,
  project,
  projectType,
  fromDate,
  toDate,
  currency,
  enabled,
}: UseCostEstimateVsConsumedParams) {
  const [data, setData] = useState<CostEstimateVsConsumedData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled || !company || !fromDate || !toDate) {
      setData(null)
      setError(null)
      return
    }

    const fetchData = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const filters = {
          company,
          project: project || undefined,
          project_type: projectType === "all" ? undefined : projectType,
          from_date: fromDate,
          to_date: toDate,
          currency: currency === "all" ? "" : currency,
        }

        const csrfToken =
          (window as unknown as { csrf_token?: string }).csrf_token || ""

        const response = await fetch(
          "/api/method/nextlayer.next_layer.api.cost_estimate_vs_consumed.get_cost_estimate_vs_consumed",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              "X-Frappe-CSRF-Token": csrfToken,
            },
            body: JSON.stringify(filters),
            credentials: "include",
          },
        )

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const result = await response.json()
        if (result?.message?.success) {
          setData(result.message)
        } else if (result?.message?.success === false) {
          setError(result.message?.error || "Failed to fetch report data")
          setData(null)
        } else {
          // Fallback for direct dict return (without wrapping in message)
          if (result?.success) {
            setData(result as CostEstimateVsConsumedData)
          } else {
            setError(result?.error || "Failed to fetch report data")
            setData(null)
          }
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to fetch report data",
        )
        setData(null)
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [enabled, company, project, fromDate, toDate, currency])

  return { data, isLoading, error }
}

