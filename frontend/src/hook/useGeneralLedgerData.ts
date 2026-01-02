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

  // Update refs when values change
  useEffect(() => {
    fromDateRef.current = fromDate
    toDateRef.current = toDate
    currencyRef.current = currency
    ignoreExchangeRateRevaluationRef.current = ignoreExchangeRateRevaluation
    ignoreSystemGeneratedNotesRef.current = ignoreSystemGeneratedNotes
    showOpeningEntriesRef.current = showOpeningEntries
  }, [fromDate, toDate, currency, ignoreExchangeRateRevaluation, ignoreSystemGeneratedNotes, showOpeningEntries])

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
      // console.log("API Response:", result)

      if (!result.message?.success) {
  throw new Error(result.message?.error || result.error || "Failed to fetch data")
}

const rawEntries = result.message?.data?.entries || []

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
      const filteredEntries = rawEntries
        .filter((entry: any) => {
          if (!entry.posting_date || typeof entry.account !== "string") {
            return false
          }
          // Exclude special summary rows
          return !entry.account.includes("'Opening'") &&
                 !entry.account.includes("'Total'") &&
                 !entry.account.includes("'Closing (Opening + Total)'")
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

      // Consolidate entries by voucher (group by voucher_type + voucher_no)
      // This prevents journal entries with multiple GL entries from appearing multiple times
      const consolidatedMap = new Map<string, GLEntry>()
      
      filteredEntries.forEach((entry: any) => {
        const voucherKey = `${entry.voucher_type}-${entry.voucher_no}`
        
        if (consolidatedMap.has(voucherKey)) {
          // Aggregate debits and credits for the same voucher
          const existing = consolidatedMap.get(voucherKey)!
          existing.debit += entry.debit
          existing.credit += entry.credit
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
        }
      })

      // Convert map to array and sort
      const sortedEntries = Array.from(consolidatedMap.values())
        .sort((a, b) => {
          // Sort by posting date, then by voucher
          const dateCompare = new Date(a.posting_date).getTime() - new Date(b.posting_date).getTime()
          if (dateCompare !== 0) return dateCompare
          return `${a.voucher_type}-${a.voucher_no}`.localeCompare(`${b.voucher_type}-${b.voucher_no}`)
        })

      // Calculate running balance
      const entries: GLEntry[] = sortedEntries.map((entry, index) => {
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
      })

      setData(entries)
    } catch (err: any) {
      console.error("API Error:", err)
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
