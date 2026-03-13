import { useEffect, useState } from "react"

interface Project {
  name: string
  project_name?: string
  company?: string
}

interface UseProjectsResult {
  projects: Project[]
  isLoading: boolean
  error: string | null
}

export function useProjects(company?: string): UseProjectsResult {
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchProjects = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams()
        params.set("fields", JSON.stringify(["name", "project_name", "company"]))
        params.set("limit_page_length", "0")

        if (company) {
          params.set("filters", JSON.stringify({ company }))
        }

        const csrfToken =
          (window as unknown as { csrf_token?: string }).csrf_token || ""

        const response = await fetch(`/api/resource/Project?${params.toString()}`, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "X-Frappe-CSRF-Token": csrfToken,
          },
          credentials: "include",
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const result = await response.json()
        const data = Array.isArray(result?.data) ? result.data : []
        setProjects(data)
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load projects",
        )
        setProjects([])
      } finally {
        setIsLoading(false)
      }
    }

    fetchProjects()
  }, [company])

  return { projects, isLoading, error }
}

