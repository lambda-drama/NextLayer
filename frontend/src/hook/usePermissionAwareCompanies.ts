import { useState, useEffect } from 'react'

export interface Company {
  name: string
  company_name: string
}

export interface PermissionAwareCompaniesResponse {
  success: boolean
  companies: Company[]
  error?: string
}

export const usePermissionAwareCompanies = () => {
  const [companies, setCompanies] = useState<Company[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchCompanies = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/method/nextlayer.next_layer.api.general_ledger.get_permission_aware_companies', {
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
          setCompanies(responseData.companies || [])
        } else {
          const errorMessage = responseData.error || 'Failed to fetch permission-aware companies'
          setError(errorMessage)
          setCompanies([])
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
        setError(errorMessage)
        setCompanies([])
      } finally {
        setIsLoading(false)
      }
    }

    fetchCompanies()
  }, [])

  return {
    companies,
    isLoading,
    error
  }
}

