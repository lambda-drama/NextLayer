import { useState, useEffect } from 'react'

interface IntercompanyParty {
  name: string
  party_name: string
  default_currency: string
}

interface UseIntercompanyPartiesParams {
  company: string
  partyType: 'Customer' | 'Supplier'
  currency?: string
}

export function useIntercompanyParties({
  company,
  partyType,
  currency = 'all'
}: UseIntercompanyPartiesParams) {
  const [parties, setParties] = useState<IntercompanyParty[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!company) {
      setParties([])
      return
    }

    const fetchIntercompanyParties = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams({
          company,
          party_type: partyType,
          currency
        })

        const response = await fetch(`/api/method/nextlayer.next_layer.api.ledger_summary.get_intercompany_parties?${params}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-Frappe-CSRF-Token': window.csrf_token || ''
          }
        })

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }

        const result = await response.json()

        if (result.message && result.message.success) {
          setParties(result.message.parties || [])
        } else if (result.message && result.message.error) {
          setError(result.message.error)
        } else {
          setError('Failed to fetch intercompany parties')
        }
      } catch (err) {
        setError('Failed to fetch intercompany parties')
        console.error('Error fetching intercompany parties:', err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchIntercompanyParties()
  }, [company, partyType, currency])

  return {
    parties,
    isLoading,
    error
  }
}
