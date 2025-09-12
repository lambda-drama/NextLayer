import { useState, useEffect } from 'react'

interface GLFilters {
  company: string
  partyType: string
  party: string
  fromDate: string
  toDate: string
  currency: string
  ignoreExchangeRateRevaluation: boolean
  ignoreSystemGeneratedNotes: boolean
}

interface HiddenSummary {
  [key: string]: {
    count: number
    total_debit: number
    total_credit: number
  }
}

interface GLDataResponse {
  success: boolean
  data: {
    columns: any[]
    entries: any[]
    hidden_summary: HiddenSummary
    filters_applied: GLFilters
    total_visible_entries: number
    total_hidden_entries: number
  }
  error?: string
  message?: string
}

export function usePermissionAwareGLData(filters: GLFilters & { shouldLoadData: boolean }) {
  const [data, setData] = useState<any[]>([])
  const [hiddenSummary, setHiddenSummary] = useState<HiddenSummary>({})
  const [totalVisibleEntries, setTotalVisibleEntries] = useState(0)
  const [totalHiddenEntries, setTotalHiddenEntries] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      // if (!filters.shouldLoadData || !filters.company || !filters.party || !filters.fromDate || !filters.toDate) {
      //   return
      // }

      setLoading(true)
      setError(null)
      // console.log("Starting permission-aware GL data fetch...")
      // console.log("Filters being sent:", filters)
      try {
        const requestBody = {
          company: filters.company,
          party_type: filters.partyType,
          party: filters.party,
          from_date: filters.fromDate,
          to_date: filters.toDate,
          currency: filters.currency === "all" ? "" : filters.currency,
          ignore_exchange_rate_revaluation: filters.ignoreExchangeRateRevaluation,
          ignore_system_generated_notes: filters.ignoreSystemGeneratedNotes
        }

        // console.log("Making API request to:", '/api/method/nextlayer.next_layer.api.general_ledger.get_permission_aware_gl_data')
        // console.log("Request body:", JSON.stringify({ filters: requestBody }))

        const response = await fetch('/api/method/nextlayer.next_layer.api.general_ledger.get_permission_aware_gl_data', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Frappe-CSRF-Token': window.csrf_token || ''
          },
          body: JSON.stringify({ filters: requestBody }),
          credentials: 'include'
        })

        // console.log("Response status:", response.status)
        // console.log("Response ok:", response.ok)

        const result = await response.json()
        // console.log("Permission-aware API response:", result)

        // Handle Frappe API response structure (wrapped in message object)
        const responseData = result.message || result
          // console.log("Mania", responseData.data.entries)
        if (responseData.success) {
          // console.log("Permission-aware data received:", responseData.data.entries.length, "entries")
          // console.log("Hidden summary:", responseData.data.hidden_summary)
          setData(responseData.data.entries)
          setHiddenSummary(responseData.data.hidden_summary)
          setTotalVisibleEntries(responseData.data.total_visible_entries)
          setTotalHiddenEntries(responseData.data.total_hidden_entries)
        } else {
          setError(responseData.message || responseData.error || 'Failed to fetch GL data')
        }
      } catch (err) {
        console.error('Error fetching permission-aware GL data:', err)
        setError('Network error occurred while fetching data')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [
    filters.shouldLoadData,
    filters.company,
    filters.partyType,
    filters.party,
    filters.fromDate,
    filters.toDate,
    filters.currency,
    filters.ignoreExchangeRateRevaluation,
    filters.ignoreSystemGeneratedNotes
  ])

  return {
    data,
    hiddenSummary,
    totalVisibleEntries,
    totalHiddenEntries,
    loading,
    error
  }
}

