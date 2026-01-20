import { useState, useEffect, useCallback, useRef } from "react"

export interface GLEntry {
  gl_entry?: string
  posting_date: string
  account: string
  voucher_type: string
  voucher_no: string
  debit: number
  credit: number
  balance: number
  against: string
  remarks?: string
  party_type?: string
  party?: string
  cost_center?: string
  project?: string
}
declare global {
  interface Window {
    csrf_token?: string;
  }
}


export interface ReconciliationTotals {
  totalDebit: number
  totalCredit: number
  balance: number
  openingDebit?: number
  openingCredit?: number
  openingBalance?: number
}

interface APIResponse {
  success?: boolean
  data?: any
  error?: string
  message?: {
    success?: boolean
    data?: {
      entries?: any[]
    }
    error?: string
  }
}


interface UseGLDataOptions {
  company: string
  partyType: string
  party: string
  fromDate: string
  toDate: string
  currency?: string
  ignoreExchangeRateRevaluation?: boolean
  ignoreSystemGeneratedNotes?: boolean
  showOpeningEntries?: boolean
  hideOpeningInvoices?: boolean
  shouldLoadData?: boolean
}

export function useGeneralLedgerData({
  company,
  partyType,
  party,
  fromDate,
  toDate,
  currency,
  ignoreExchangeRateRevaluation,
  ignoreSystemGeneratedNotes,
  showOpeningEntries,
  hideOpeningInvoices = true,
  shouldLoadData = true,
}: UseGLDataOptions) {
  const [data, setData] = useState<GLEntry[]>([])
  const [reconciliationTotals, setReconciliationTotals] = useState<ReconciliationTotals | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Use refs to store latest date values to avoid recreating callback when dates change
  const fromDateRef = useRef(fromDate)
  const toDateRef = useRef(toDate)
  const currencyRef = useRef(currency)
  const ignoreExchangeRateRevaluationRef = useRef(ignoreExchangeRateRevaluation)
  const ignoreSystemGeneratedNotesRef = useRef(ignoreSystemGeneratedNotes)
  const showOpeningEntriesRef = useRef(showOpeningEntries)
  const hideOpeningInvoicesRef = useRef(hideOpeningInvoices)

  // Update refs when values change
  useEffect(() => {
    fromDateRef.current = fromDate
    toDateRef.current = toDate
    currencyRef.current = currency
    ignoreExchangeRateRevaluationRef.current = ignoreExchangeRateRevaluation
    ignoreSystemGeneratedNotesRef.current = ignoreSystemGeneratedNotes
    showOpeningEntriesRef.current = showOpeningEntries
    hideOpeningInvoicesRef.current = hideOpeningInvoices
  }, [fromDate, toDate, currency, ignoreExchangeRateRevaluation, ignoreSystemGeneratedNotes, showOpeningEntries, hideOpeningInvoices])

  const fetchGLData = useCallback(async () => {
    if (!shouldLoadData || !company || !partyType || !party) {
      // Clear data when shouldLoadData is false
      setData([])
      setReconciliationTotals(null)
      return
    }

    setLoading(true)
    setError(null)

    const filters = {
      company,
      party_type: partyType,
      party: [party],
      from_date: fromDateRef.current,
      to_date: toDateRef.current,
      show_remarks: 1,
      include_dimensions: 0,
      ...(currencyRef.current && currencyRef.current !== "all" && { currency: currencyRef.current }),
      ...(ignoreExchangeRateRevaluationRef.current && { ignore_err: 1 }),
      ...(ignoreSystemGeneratedNotesRef.current && { ignore_cr_dr_notes: 1 }),
      ...(showOpeningEntriesRef.current && { show_opening_entries: 1 }),
      ...(hideOpeningInvoicesRef.current !== undefined && { hide_opening_invoices: hideOpeningInvoicesRef.current ? 1 : 0 }),
    }

    try {
      const csrfToken = window.csrf_token;
      const response = await fetch(
        "/api/method/nextlayer.next_layer.api.general_ledger.get_general_ledger_data",
        {
          method: "POST",
          headers: {
  "Content-Type": "application/json",
  Accept: "application/json",
  "X-Frappe-CSRF-Token": csrfToken ?? ""
},

          body: JSON.stringify({ filters }),
           credentials: "include"
        }
      )

      const result: APIResponse = await response.json()
      console.log("[useGeneralLedgerData] API Response received:", {
        success: result.message?.success,
        entriesCount: result.message?.data?.entries?.length || 0,
        filters: filters
      })

      if (!result.message?.success) {
  throw new Error(result.message?.error || result.error || "Failed to fetch data")
}

const rawEntries = result.message?.data?.entries || []
      console.log("[useGeneralLedgerData] Raw entries from API:", rawEntries.length, "entries")

      // Find the final overall Closing entry (should be the last one in the data)
      const closingEntries = rawEntries.filter((entry: any) =>
        entry.account && entry.account.includes("'Closing (Opening + Total)'")
      )

      // Find the Opening entry
      const openingEntries = rawEntries.filter((entry: any) =>
        entry.account && entry.account.includes("'Opening'")
      )

      // Get the last Closing entry which should be the final overall balance
      const closingEntry = closingEntries[closingEntries.length - 1]
      // Get the first Opening entry which contains the actual opening balance
      const openingEntry = openingEntries[0]

      if (closingEntry) {
        setReconciliationTotals({
          totalDebit: parseFloat(closingEntry.debit) || 0,
          totalCredit: parseFloat(closingEntry.credit) || 0,
          balance: parseFloat(closingEntry.balance) || 0,
          openingDebit: openingEntry ? parseFloat(openingEntry.debit) || 0 : 0,
          openingCredit: openingEntry ? parseFloat(openingEntry.credit) || 0 : 0,
          openingBalance: openingEntry ? parseFloat(openingEntry.balance) || 0 : 0,
        })
      }

      // Filter and process regular GL entries (exclude special rows)
      console.log("[useGeneralLedgerData] Starting to filter entries. Total raw entries:", rawEntries.length)
      let filteredCount = 0
      let skippedNoDate = 0
      let skippedSpecialRow = 0
      
      const filteredEntries = rawEntries
        .filter((entry: any) => {
          const voucherKey = entry.voucher_type && entry.voucher_no ? `${entry.voucher_type}-${entry.voucher_no}` : "N/A"
          
          if (!entry.posting_date || typeof entry.account !== "string") {
            skippedNoDate++
            console.log("[useGeneralLedgerData] Filtered out entry (no posting_date or invalid account):", {
              voucher: voucherKey,
              posting_date: entry.posting_date,
              account: entry.account,
              accountType: typeof entry.account,
              debit: entry.debit,
              credit: entry.credit
            })
            return false
          }
          // Exclude special summary rows
          const isSpecialRow = entry.account.includes("'Opening'") ||
                               entry.account.includes("'Total'") ||
                               entry.account.includes("'Closing (Opening + Total)'")
          if (isSpecialRow) {
            skippedSpecialRow++
            console.log("[useGeneralLedgerData] Filtered out special row:", {
              account: entry.account,
              voucher: voucherKey,
              posting_date: entry.posting_date
            })
            return false
          }
          
          filteredCount++
          console.log("[useGeneralLedgerData] Including entry:", {
            voucher: voucherKey,
            posting_date: entry.posting_date,
            account: entry.account,
            debit: entry.debit,
            credit: entry.credit,
            party: entry.party
          })
          return true
        })
        .map((entry: any) => ({
          gl_entry: entry.gl_entry,
          posting_date: entry.posting_date,
          account: entry.account,
          voucher_type: entry.voucher_type || "",
          voucher_no: entry.voucher_no || "",
          debit: parseFloat(entry.debit) || 0,
          credit: parseFloat(entry.credit) || 0,
          against: entry.against || "",
          remarks: entry.remarks || "",
          party_type: entry.party_type,
          party: entry.party,
          cost_center: entry.cost_center,
          project: entry.project,
        }))
      
      console.log("[useGeneralLedgerData] Filter summary: total=", rawEntries.length, ", skipped_no_date=", skippedNoDate, ", skipped_special=", skippedSpecialRow, ", filtered=", filteredCount)
      console.log("[useGeneralLedgerData] After filtering special rows:", filteredEntries.length, "entries")
      
      // Debug: Log entries with specific voucher or date
      if (Array.isArray(filteredEntries)) {
        filteredEntries.forEach((entry: any) => {
          if (entry && entry.voucher_no && (entry.voucher_no.includes("002") || entry.posting_date === "2024-02-07" || entry.posting_date === "2024-07-02")) {
            console.log("[useGeneralLedgerData] Found entry matching search criteria:", {
              voucher: `${entry.voucher_type}-${entry.voucher_no}`,
              posting_date: entry.posting_date,
              account: entry.account,
              debit: entry.debit,
              credit: entry.credit,
              party: entry.party
            })
          }
        })
      }

      // Consolidate entries by voucher (group by voucher_type + voucher_no)
      // This prevents journal entries with multiple GL entries from appearing multiple times
      const consolidatedMap = new Map<string, GLEntry>()
      
      if (!Array.isArray(filteredEntries)) {
        console.error("[useGeneralLedgerData] filteredEntries is not an array:", filteredEntries)
        setData([])
        setLoading(false)
        return
      }
      
      console.log("[useGeneralLedgerData] Starting consolidation. Filtered entries count:", filteredEntries.length)
      let consolidatedCount = 0
      let aggregatedCount = 0
      
      filteredEntries.forEach((entry: any) => {
        const voucherKey = `${entry.voucher_type}-${entry.voucher_no}`
        
        if (consolidatedMap.has(voucherKey)) {
          // Aggregate debits and credits for the same voucher
          aggregatedCount++
          const existing = consolidatedMap.get(voucherKey)!
          const oldDebit = existing.debit
          const oldCredit = existing.credit
          existing.debit += entry.debit
          existing.credit += entry.credit
          console.log("[useGeneralLedgerData] Aggregating duplicate voucher:", {
            voucher: voucherKey,
            oldDebit,
            oldCredit,
            newDebit: existing.debit,
            newCredit: existing.credit,
            entryDebit: entry.debit,
            entryCredit: entry.credit
          })
          // Keep the first account, or combine if needed
          if (existing.account !== entry.account) {
            // For consolidated view, we can show multiple accounts or just the first
            // Using the first account is fine for reconciliation purposes
          }
          // Combine remarks if different
          if (entry.remarks && existing.remarks && existing.remarks !== entry.remarks) {
            existing.remarks = `${existing.remarks}; ${entry.remarks}`
          }
        } else {
          // First entry for this voucher
          consolidatedCount++
          consolidatedMap.set(voucherKey, {
            gl_entry: entry.gl_entry,
            posting_date: entry.posting_date,
            account: entry.account,
            voucher_type: entry.voucher_type,
            voucher_no: entry.voucher_no,
            debit: entry.debit,
            credit: entry.credit,
            balance: 0, // Will be calculated below
            against: entry.against,
            remarks: entry.remarks,
            party_type: entry.party_type,
            party: entry.party,
            cost_center: entry.cost_center,
            project: entry.project,
          })
          console.log("[useGeneralLedgerData] Added new consolidated entry:", {
            voucher: voucherKey,
            posting_date: entry.posting_date,
            debit: entry.debit,
            credit: entry.credit,
            party: entry.party
          })
        }
      })
      
      console.log("[useGeneralLedgerData] Consolidation summary: filtered=", filteredEntries.length, ", consolidated=", consolidatedCount, ", aggregated=", aggregatedCount, ", final_map_size=", consolidatedMap.size)

      // Convert map to array and sort
      const sortedEntries = Array.from(consolidatedMap.values())
        .sort((a, b) => {
          // Sort by posting date, then by voucher
          const dateCompare = new Date(a.posting_date).getTime() - new Date(b.posting_date).getTime()
          if (dateCompare !== 0) return dateCompare
          return `${a.voucher_type}-${a.voucher_no}`.localeCompare(`${b.voucher_type}-${b.voucher_no}`)
        })
      
      console.log("[useGeneralLedgerData] After consolidation and sorting:", sortedEntries.length, "entries")
      
      // Debug: Log consolidated entries with specific voucher or date
      if (Array.isArray(sortedEntries)) {
        sortedEntries.forEach((entry) => {
          if (entry && entry.voucher_no && (entry.voucher_no.includes("002") || entry.posting_date === "2024-02-07" || entry.posting_date === "2024-07-02")) {
            console.log("[useGeneralLedgerData] Consolidated entry matching search criteria:", {
              voucher: `${entry.voucher_type}-${entry.voucher_no}`,
              posting_date: entry.posting_date,
              account: entry.account,
              debit: entry.debit,
              credit: entry.credit,
              party: entry.party,
              against: entry.against
            })
          }
        })
      }

      // Calculate running balance
      const entries: GLEntry[] = Array.isArray(sortedEntries) ? sortedEntries.map((entry, index) => {
        if (!entry) return null as any
        let balance = 0
        for (let i = 0; i <= index; i++) {
          const prevEntry = sortedEntries[i]
          if (prevEntry) {
            balance += prevEntry.debit - prevEntry.credit
          }
        }
        return {
          ...entry,
          balance
        }
      }).filter(entry => entry !== null) : []

      console.log("[useGeneralLedgerData] Final entries set to state:", entries.length, "entries")
      console.log("[useGeneralLedgerData] Final entries summary:", {
        totalEntries: entries.length,
        dateRange: entries.length > 0 ? {
          earliest: entries[0]?.posting_date,
          latest: entries[entries.length - 1]?.posting_date
        } : null,
        vouchers: entries.slice(0, 10).map(e => `${e.voucher_type}-${e.voucher_no}`)
      })
      
      setData(entries)
    } catch (err: any) {
      console.error("[useGeneralLedgerData] API Error:", err)
      setError(err.message || "An error occurred")
    } finally {
      setLoading(false)
    }
  }, [shouldLoadData, company, partyType, party])

  useEffect(() => {
    fetchGLData()
  }, [fetchGLData])

  return {
    data,
    reconciliationTotals,
    loading,
    error,
    refetch: fetchGLData
  }
}
