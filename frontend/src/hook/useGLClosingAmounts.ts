import { useState, useEffect, useMemo } from 'react'

interface UseGLClosingAmountsParams {
  company: string
  partyType: 'Customer' | 'Supplier'
  fromDate: string
  toDate: string
  currency: string
  parties: string[]
  enabled?: boolean
}

export function useGLClosingAmounts({
  company,
  partyType,
  fromDate,
  toDate,
  currency,
  parties,
  enabled = true
}: UseGLClosingAmountsParams) {
  const [glClosingAmounts, setGlClosingAmounts] = useState<Record<string, number>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Create a stable key for parties to avoid infinite re-renders
  const partiesKey = useMemo(() => parties.sort().join(','), [parties])

  useEffect(() => {
    if (!enabled || !company || !fromDate || !toDate || !parties.length) {
      setGlClosingAmounts({})
      return
    }

    const fetchGLClosingAmounts = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const filters = {
          company,
          from_date: fromDate,
          to_date: toDate,
          currency,
          party_type: partyType,
          parties
        }

        const csrfToken = window.csrf_token || ''

        const response = await fetch('/api/method/nextlayer.next_layer.api.ledger_summary.get_gl_closing_amounts', {
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
        console.log("GL Closing Amounts Response:", result)

        if (result.message && result.message.success) {
          setGlClosingAmounts(result.message.gl_closing_amounts || {})
        } else if (result.message && result.message.error) {
          setError(result.message.error)
        } else {
          setError('Failed to fetch GL closing amounts')
        }
      } catch (err) {
        setError('Failed to fetch GL closing amounts')
        console.error('Error fetching GL closing amounts:', err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchGLClosingAmounts()
  }, [company, partyType, fromDate, toDate, currency, partiesKey, enabled])

  return {
    glClosingAmounts,
    isLoading,
    error
  }
}
