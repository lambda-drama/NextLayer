// src/hooks/useCompanies.ts
import { useEffect, useState } from "react"

interface Company {
  name: string
  [key: string]: any
}

interface APIResponse {
  success: boolean
  message: {
    data: Company[]
  }
}

interface UseCompaniesReturn {
  companies: Company[]
  isLoading: boolean
  error: string | null
  refetch: () => void
  count: number
}

export function useCompanies(): UseCompaniesReturn {
  const [companies, setCompanies] = useState<Company[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const fetchCompanies = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(
        "/api/method/nextlayer.next_layer.api.general_ledger.get_companies",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }
      )

      const result: APIResponse = await response.json()
      if (Array.isArray(result.message?.data)) {
        setCompanies(result.message.data)
      } else {
        throw new Error("Invalid response format")
      }
    } catch (err: any) {
      console.error("Failed to fetch companies:", err)
      setError(err.message || "Failed to load companies")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchCompanies()
  }, [])
  return {
    companies,
    isLoading,
    error,
    refetch: fetchCompanies,
    count: companies.length,
  }
}
