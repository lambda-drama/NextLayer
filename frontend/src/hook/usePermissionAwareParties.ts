import { useState, useEffect } from 'react'

export interface Party {
  name: string
  party_name: string
  default_currency: string
}

export interface PermissionAwarePartiesResponse {
  success: boolean
  parties: Party[]
  error?: string
}

export const usePermissionAwareParties = (partyType: 'Customer' | 'Supplier') => {
  const [parties, setParties] = useState<Party[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchParties = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams({
          party_type: partyType
        })

        const response = await fetch(`/api/method/nextlayer.next_layer.api.general_ledger.get_permission_aware_parties?${params}`, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'X-Frappe-CSRF-Token': window.csrf_token || ''
          },
          credentials: 'include'
        })

        const result = await response.json()
        // Handle Frappe API response structure (wrapped in message object)
        const responseData = result.message || result

        if (responseData.success) {
          setParties(responseData.parties || [])
        } else {
          const errorMessage = responseData.error || `Failed to fetch permission-aware ${partyType.toLowerCase()}s`
          setError(errorMessage)
          setParties([])
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
        setError(errorMessage)
        setParties([])
      } finally {
        setIsLoading(false)
      }
    }

    fetchParties()
  }, [partyType])

  return {
    parties,
    isLoading,
    error
  }
}

