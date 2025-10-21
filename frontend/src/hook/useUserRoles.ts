import { useState, useEffect } from 'react'

export interface UserRolesResponse {
  success: boolean
  roles: string[]
  error?: string
}

export const useUserRoles = () => {
  const [roles, setRoles] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchUserRoles = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/method/nextlayer.next_layer.api.general_ledger.get_user_roles', {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'X-Frappe-CSRF-Token': window.csrf_token || ''
          },
          credentials: 'include'
        })

        if (!response.ok) {
          throw new Error('Failed to fetch user roles')
        }

        const result = await response.json()
        const responseData = result.message || result

        if (responseData.success) {
          setRoles(responseData.roles || [])
        } else {
          const errorMessage = responseData.error || 'Failed to fetch user roles'
          setError(errorMessage)
          setRoles([])
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
        setError(errorMessage)
        setRoles([])
      } finally {
        setIsLoading(false)
      }
    }

    fetchUserRoles()
  }, [])

  // Helper function to check if user has specific roles
  const hasRole = (roleName: string): boolean => {
    return roles.includes(roleName)
  }

  // Helper function to check if user has any of the specified roles
  const hasAnyRole = (roleNames: string[]): boolean => {
    return roleNames.some(roleName => roles.includes(roleName))
  }

  // Helper function to check if user is System Manager or Administrator
  const isSystemManagerOrAdmin = (): boolean => {
    return hasAnyRole(['System Manager', 'Administrator'])
  }

  return {
    roles,
    isLoading,
    error,
    hasRole,
    hasAnyRole,
    isSystemManagerOrAdmin
  }
}
