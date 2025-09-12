import { useState, useEffect } from 'react'

interface Party {
  name: string
  party_name: string
  default_currency: string
}

interface UsePartiesForAutofillResult {
  parties: Party[]
  isLoading: boolean
  error: string | null
}

export function usePartiesForAutofill(partyType: string, company?: string): UsePartiesForAutofillResult {
  const [parties, setParties] = useState<Party[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchParties = async () => {
      if (!partyType) {
        setParties([])
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/method/nextlayer.next_layer.api.general_ledger.get_parties_for_autofill', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Frappe-CSRF-Token': window.csrf_token || ''
          },
          body: JSON.stringify({
            party_type: partyType,
            company: company || null
          })
        })

        const result = await response.json()

        if (result.success) {
          setParties(result.data)
        } else {
          setError(result.message || 'Failed to fetch parties')
          setParties([])
        }
      } catch (err) {
        console.error('Error fetching parties for autofill:', err)
        setError('Network error occurred while fetching parties')
        setParties([])
      } finally {
        setIsLoading(false)
      }
    }

    fetchParties()
  }, [partyType, company])

  return {
    parties,
    isLoading,
    error
  }
}

