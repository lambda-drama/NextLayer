import { useEffect, useState } from "react"

export interface Party {
  name: string
  [key: string]: any
}

interface APIResponse {
  success: boolean
  message: {
    data: Party[]
  }
}

interface UsePartiesReturn {
  parties: Party[]
  isLoading: boolean
  error: string | null
  refetch: () => void
  count: number
}

export function useParties(partyType: string, company: string): UsePartiesReturn {
  const [parties, setParties] = useState<Party[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const fetchParties = async () => {
    if (!partyType || !company) return
    setIsLoading(true)
    setError(null)
    const csrfToken = window.csrf_token;
    try {
      const response = await fetch(
        "/api/method/nextlayer.next_layer.api.general_ledger.get_parties",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Frappe-CSRF-Token": csrfToken ?? "" },
          body: JSON.stringify({ party_type: partyType, company }),
        }
      )

      const result: APIResponse = await response.json()
        console.log(result.message)
      if (Array.isArray(result.message?.data)) {
        setParties(result.message.data)
      } else {
        throw new Error("Invalid response format")
      }
    } catch (err: any) {
      console.error(`Failed to fetch ${partyType}:`, err)
      setError(err.message || "Failed to load parties")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchParties()
  }, [partyType, company])

  return {
    parties,
    isLoading,
    error,
    refetch: fetchParties,
    count: parties.length,
  }
}
