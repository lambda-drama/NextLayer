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
  showOpeningEntries: boolean
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
      if (!filters.shouldLoadData || !filters.company || !filters.party || !filters.fromDate || !filters.toDate) {
        // Clear data when shouldLoadData is false
        setData([])
        setHiddenSummary({})
        setTotalVisibleEntries(0)
        setTotalHiddenEntries(0)
        return
      }

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
          ignore_system_generated_notes: filters.ignoreSystemGeneratedNotes,
          show_opening_entries: filters.showOpeningEntries
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
          
          // Consolidate entries by voucher (group by voucher_type + voucher_no)
          // This prevents journal entries with multiple GL entries from appearing multiple times
          const rawEntries = responseData.data.entries || []
          const consolidatedMap = new Map<string, any>()
          
          rawEntries.forEach((entry: any) => {
            // Skip special summary rows
            if (!entry.posting_date || 
                (typeof entry.account === "string" && 
                 (entry.account.includes("'Opening'") || 
                  entry.account.includes("'Total'") || 
                  entry.account.includes("'Closing (Opening + Total)'")))) {
              return
            }
            
            const voucherKey = `${entry.voucher_type || ""}-${entry.voucher_no || ""}`
            
            if (consolidatedMap.has(voucherKey)) {
              // Aggregate debits and credits for the same voucher
              const existing = consolidatedMap.get(voucherKey)!
              existing.debit = (parseFloat(existing.debit) || 0) + (parseFloat(entry.debit) || 0)
              existing.credit = (parseFloat(existing.credit) || 0) + (parseFloat(entry.credit) || 0)
              // Combine remarks if different
              if (entry.remarks && existing.remarks && existing.remarks !== entry.remarks) {
                existing.remarks = `${existing.remarks}; ${entry.remarks}`
              }
            } else {
              // First entry for this voucher
              consolidatedMap.set(voucherKey, {
                ...entry,
                debit: parseFloat(entry.debit) || 0,
                credit: parseFloat(entry.credit) || 0,
              })
            }
          })

          // Convert map to array and sort
          const consolidatedEntries = Array.from(consolidatedMap.values())
            .sort((a, b) => {
              const dateCompare = new Date(a.posting_date).getTime() - new Date(b.posting_date).getTime()
              if (dateCompare !== 0) return dateCompare
              return `${a.voucher_type}-${a.voucher_no}`.localeCompare(`${b.voucher_type}-${b.voucher_no}`)
            })

          setData(consolidatedEntries)
          setHiddenSummary(responseData.data.hidden_summary)
          setTotalVisibleEntries(consolidatedEntries.length)
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
    filters.ignoreSystemGeneratedNotes,
    filters.showOpeningEntries
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

