import { useState, useEffect } from 'react'

interface Company {
  name: string
  default_currency: string
}

interface UseAllCompaniesForUIResult {
  companies: Company[]
  isLoading: boolean
  error: string | null
}

export function useAllCompaniesForUI(): UseAllCompaniesForUIResult {
  const [companies, setCompanies] = useState<Company[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchCompanies = async () => {
      setIsLoading(true)
      setError(null)

      try {
        console.log('Fetching all companies for UI...')
        const response = await fetch('/api/method/nextlayer.next_layer.api.general_ledger.get_all_companies_for_ui', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Frappe-CSRF-Token': window.csrf_token || ''
          }
        })

        console.log('Response status:', response.status)
        const result = await response.json()
        console.log('API result:', result)
        console.log('Result type:', typeof result)
        console.log('Result keys:', Object.keys(result))
        console.log('Success value:', result.success)
        console.log('Data value:', result.data)
        console.log('Message value:', result.message)
        console.log('Error value:', result.error)

        if (result.success) {
          console.log('Companies fetched successfully:', result.data)
          setCompanies(result.data)
        } else {
          console.error('API error:', result.message || result.error)
          // Handle both string and object errors
          const errorMessage = typeof result.message === 'string' ? result.message :
                              typeof result.error === 'string' ? result.error :
                              typeof result.message === 'object' ? JSON.stringify(result.message) :
                              typeof result.error === 'object' ? JSON.stringify(result.error) :
                              'Failed to fetch companies'
          setError(errorMessage)
          setCompanies([])
        }
      } catch (err) {
        console.error('Error fetching all companies for UI:', err)
        setError('Network error occurred while fetching companies')
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
