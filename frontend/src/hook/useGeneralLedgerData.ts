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
}

export function useGeneralLedgerData({
  company,
  partyType,
  party,
  fromDate,
  toDate,
}: UseGLDataOptions) {
  const [data, setData] = useState<GLEntry[]>([])
  const [reconciliationTotals, setReconciliationTotals] = useState<ReconciliationTotals | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchGLData = useCallback(async () => {
    if (!company || !partyType || !party) return

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
      console.log("API Response:", result)

      if (!result.message?.success) {
  throw new Error(result.message?.error || result.error || "Failed to fetch data")
}

const rawEntries = result.message?.data?.entries || []

     
      const openingEntry = rawEntries.find((entry: any) => 
        entry.account && entry.account.includes("'Opening'")
      )

      if (openingEntry) {
        setReconciliationTotals({
          totalDebit: parseFloat(openingEntry.debit) || 0,
          totalCredit: parseFloat(openingEntry.credit) || 0,
          balance: parseFloat(openingEntry.balance) || 0,
        })
        console.log("Reconciliation totals extracted:", {
          totalDebit: parseFloat(openingEntry.debit) || 0,
          totalCredit: parseFloat(openingEntry.credit) || 0,
          balance: parseFloat(openingEntry.balance) || 0,
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
                 !entry.account.includes("'Closing'")
        })
        .map((entry: any, index: number) => {
          let balance = 0
          for (let i = 0; i <= index; i++) {
            const prevEntry = rawEntries.filter((e: any) => 
              e.posting_date && 
              typeof e.account === "string" && 
              !e.account.includes("'Opening'") && 
              !e.account.includes("'Total'") && 
              !e.account.includes("'Closing'")
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
  }, [company, partyType, party, fromDate, toDate])

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