import { useState, useEffect } from "react"

export interface QuotationStageInfo {
  name: string | null
  transaction_date: string | null
  grand_total: number
  currency: string
}

export interface QuotationStagesEntry {
  group_key: string
  party_name: string
  project: string
  initial_quote_name: string | null
  initial_quote_date: string | null
  initial_quote_amount: number | null
  after_site_visit_name: string | null
  after_site_visit_date: string | null
  after_site_visit_amount: number | null
  final_quote_name: string | null
  final_quote_date: string | null
  final_quote_amount: number | null
  variance_initial_to_final: number
  variance_after_site_to_final: number
  currency: string
}

export interface QuotationStagesTotals {
  total_initial: number
  total_after_site_visit: number
  total_final: number
  variance_initial_to_final: number
  variance_after_site_to_final: number
  deal_count: number
}

export interface QuotationStagesMeta {
  company: string
  from_date: string
  to_date: string
  display_currency: string
  company_currency: string
}

export interface QuotationStagesData {
  success: boolean
  entries: QuotationStagesEntry[]
  totals: QuotationStagesTotals
  meta: QuotationStagesMeta
}

interface UseQuotationStagesReportParams {
  company: string
  project: string
  fromDate: string
  toDate: string
  currency: string
  enabled: boolean
}

export function useQuotationStagesReport({
  company,
  project,
  fromDate,
  toDate,
  currency,
  enabled,
}: UseQuotationStagesReportParams) {
  const [data, setData] = useState<QuotationStagesData | null>(null)
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
          from_date: fromDate,
          to_date: toDate,
          currency: currency === "all" ? "" : currency,
        }

        const csrfToken =
          (window as unknown as { csrf_token?: string }).csrf_token || ""

        const response = await fetch(
          "/api/method/nextlayer.next_layer.api.quotation_stages_report.get_quotation_stages_report",
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
        const payload = result?.message ?? result

        if (payload?.success) {
          setData(payload)
        } else {
          setError(payload?.error || "Failed to fetch quotation stages report")
          setData(null)
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to fetch quotation stages report",
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
