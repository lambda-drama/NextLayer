import { useState, useEffect, useMemo } from 'react'

interface UseIntransitInvoiceTotalsParams {
  company: string
  partyType: 'Customer' | 'Supplier'
  fromDate: string
  toDate: string
  parties: string[]
  invoiceType?: 'Sales Invoice' | 'Purchase Invoice'
  enabled?: boolean
}

export function useIntransitInvoiceTotals({
  company,
  partyType,
  fromDate,
  toDate,
  parties,
  invoiceType,
  enabled = true
}: UseIntransitInvoiceTotalsParams) {
  const [intransitTotals, setIntransitTotals] = useState<Record<string, number>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Create a stable key for parties to avoid infinite re-renders
  const partiesKey = useMemo(() => parties.sort().join(','), [parties])

  useEffect(() => {
    if (!enabled || !company || !fromDate || !toDate || !parties.length) {
      setIntransitTotals({})
      return
    }

    const fetchIntransitTotals = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const filters: Record<string, any> = {
          company,
          from_date: fromDate,
          to_date: toDate,
          party_type: partyType,
          parties
        }

        if (invoiceType) {
          filters.invoice_type = invoiceType
        }

        const csrfToken = window.csrf_token || ''

        const response = await fetch('/api/method/nextlayer.next_layer.api.ledger_summary.get_intransit_invoice_totals', {
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
        console.log("In-Transit Invoice Totals Response:", result)

        if (result.message && result.message.success) {
          setIntransitTotals(result.message.intransit_totals || {})
        } else if (result.message && result.message.error) {
          setError(result.message.error)
        } else {
          setError('Failed to fetch in-transit invoice totals')
        }
      } catch (err) {
        setError('Failed to fetch in-transit invoice totals')
        console.error('Error fetching in-transit invoice totals:', err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchIntransitTotals()
}, [company, partyType, fromDate, toDate, partiesKey, invoiceType, enabled])

  return {
    intransitTotals,
    isLoading,
    error
  }
}

