import { useState, useEffect } from 'react'

interface LedgerSummaryEntry {
  party: string
  party_name: string
  company: string
  opening_balance: number
  invoiced_amount: number
  paid_amount: number
  debit: number
  credit: number
  closing_balance: number
  currency: string
}

interface LedgerSummaryData {
  entries: LedgerSummaryEntry[]
  totals: {
    totalOpeningBalance: number
    totalInvoicedAmount: number
    totalPaidAmount: number
    totalDebit: number
    totalCredit: number
    totalClosingBalance: number
  }
}

interface UseLedgerSummaryParams {
  company: string
  partyType: 'Customer' | 'Supplier'
  fromDate: string
  toDate: string
  currency: string
  showIntercompanyOnly?: boolean
  inPartyCurrency?: boolean
  ignoreSystemGeneratedNotes?: boolean
  ignoreExchangeRateRevaluation?: boolean
  enabled?: boolean
}

export function useLedgerSummary({
  company,
  partyType,
  fromDate,
  toDate,
  currency,
  showIntercompanyOnly = true,
  inPartyCurrency = true,
  ignoreSystemGeneratedNotes = true,
  ignoreExchangeRateRevaluation = true,
  enabled = true
}: UseLedgerSummaryParams) {
  const [data, setData] = useState<LedgerSummaryData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled || !company || !fromDate || !toDate) {
      setData(null)
      return
    }

    const fetchLedgerSummary = async () => {
      setIsLoading(true)
      setError(null)

      try {
        // Determine the API endpoint based on party type
        const endpoint = partyType === 'Customer'
          ? '/api/method/nextlayer.next_layer.api.ledger_summary.get_customer_ledger_summary'
          : '/api/method/nextlayer.next_layer.api.ledger_summary.get_supplier_ledger_summary'

        const filters = {
          company,
          from_date: fromDate,
          to_date: toDate,
          currency,
          show_intercompany_only: showIntercompanyOnly,
          in_party_currency: inPartyCurrency,
          ignore_system_generated_notes: ignoreSystemGeneratedNotes,
          ignore_exchange_rate_revaluation: ignoreExchangeRateRevaluation
        }

        const csrfToken = window.csrf_token || ''
      

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Frappe-CSRF-Token': csrfToken || ''
          },
          body: JSON.stringify({ filters }),
          credentials: 'include'
        })

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }

        const result = await response.json()
        if (result.message && result.message.success) {
          setData(result.message)
        } else if (result.message && result.message.error) {
          setError(result.message.error)
        } else {
          setError('Failed to fetch ledger summary data')
        }
      } catch (err) {
        setError('Failed to fetch ledger summary data')
        console.error('Error fetching ledger summary:', err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchLedgerSummary()
  }, [enabled, company, partyType, fromDate, toDate, currency, showIntercompanyOnly, inPartyCurrency, ignoreSystemGeneratedNotes, ignoreExchangeRateRevaluation])

  return {
    data,
    isLoading,
    error
  }
}
