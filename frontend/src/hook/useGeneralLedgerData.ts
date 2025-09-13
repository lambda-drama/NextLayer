import { useState, useEffect, useCallback } from "react"

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

  const fetchGLData = useCallback(async () => {
    if (!shouldLoadData || !company || !partyType || !party) return

    setLoading(true)
    setError(null)

    const filters = {
      company,
      party_type: partyType,
      party: [party],
      from_date: fromDate,
      to_date: toDate,
      show_remarks: 1,
      include_dimensions: 0,
      ...(currency && currency !== "all" && { currency }),
      ...(ignoreExchangeRateRevaluation && { ignore_err: 1 }),
      ...(ignoreSystemGeneratedNotes && { ignore_cr_dr_notes: 1 }),
      ...(showOpeningEntries && { show_opening_entries: 1 }),
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
      const openingEntry = openingEntries[openingEntries.length - 1]

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
      const entries: GLEntry[] = rawEntries
        .filter((entry: any) => {
          if (!entry.posting_date || typeof entry.account !== "string") {
            return false
          }
          // Exclude special summary rows
          return !entry.account.includes("'Opening'") &&
                 !entry.account.includes("'Total'") &&
                 !entry.account.includes("'Closing (Opening + Total)'")
        })
        .map((entry: any, index: number) => {
          let balance = 0
          for (let i = 0; i <= index; i++) {
            const prevEntry = rawEntries.filter((e: any) =>
              e.posting_date &&
              typeof e.account === "string" &&
              !e.account.includes("'Opening'") &&
              !e.account.includes("'Total'") &&
              !e.account.includes("'Closing (Opening + Total)'")
            )[i]

            if (prevEntry) {
              balance += (parseFloat(prevEntry.debit) || 0) - (parseFloat(prevEntry.credit) || 0)
            }
          }

          return {
            gl_entry: entry.gl_entry,
            posting_date: entry.posting_date,
            account: entry.account,
            voucher_type: entry.voucher_type || "",
            voucher_no: entry.voucher_no || "",
            debit: parseFloat(entry.debit) || 0,
            credit: parseFloat(entry.credit) || 0,
            balance,
            against: entry.against || "",
            remarks: entry.remarks || "",
            party_type: entry.party_type,
            party: entry.party,
            cost_center: entry.cost_center,
            project: entry.project,
          }
        })

      setData(entries)
    } catch (err: any) {
      console.error("API Error:", err)
      setError(err.message || "An error occurred")
    } finally {
      setLoading(false)
    }
  }, [shouldLoadData, company, partyType, party, fromDate, toDate, currency, ignoreExchangeRateRevaluation, ignoreSystemGeneratedNotes, showOpeningEntries])

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
