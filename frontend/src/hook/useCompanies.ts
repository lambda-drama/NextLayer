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
  testEndpoint: () => void
  refreshCSRFToken: () => Promise<string | null>
  count: number
}

export function useCompanies(): UseCompaniesReturn {
  const [companies, setCompanies] = useState<Company[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

    const fetchCompanies = async () => {
    setIsLoading(true)
    setError(null)

    // Get CSRF token from multiple sources
    const csrfToken = window.csrf_token ||
                     document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ||
                     '';

    console.log("Csrf is", csrfToken)
    console.log("Making API call to get_companies...")

    try {
      const response = await fetch(
        "/api/method/nextlayer.next_layer.api.general_ledger.get_companies",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Frappe-CSRF-Token": csrfToken
          },
        }
      )

      console.log("Response status:", response.status);
      console.log("Response headers:", Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Error response body:", errorText);
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
      }

      const result: APIResponse = await response.json()
      console.log("API response:", result);

      if (Array.isArray(result.message?.data)) {
        setCompanies(result.message.data)
      } else {
        console.error("Invalid response format:", result);
        throw new Error("Invalid response format")
      }
    } catch (err: any) {
      console.error("Failed to fetch companies:", err)
      setError(err.message || "Failed to load companies")
    } finally {
      setIsLoading(false)
    }
  }

  const testEndpoint = async () => {
    try {
      console.log("Testing endpoint...");

      // Try POST request first
      console.log("Testing POST request...");
      const postResponse = await fetch(
        "/api/method/nextlayer.next_layer.api.general_ledger.test_endpoint",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }
      )

      console.log("POST response status:", postResponse.status);
      const postResult = await postResponse.json();
      console.log("POST result:", postResult);

      // Try GET request as well
      console.log("Testing GET request...");
      const getResponse = await fetch(
        "/api/method/nextlayer.next_layer.api.general_ledger.test_endpoint",
        {
          method: "GET",
        }
      )

      console.log("GET response status:", getResponse.status);
      const getResult = await getResponse.json();
      console.log("GET result:", getResult);

    } catch (err: any) {
      console.error("Test endpoint failed:", err);
    }
  }

  const refreshCSRFToken = async () => {
    try {
      console.log("Refreshing CSRF token...");
      const response = await fetch("/api/method/frappe.sessions.get_csrf_token", {
        method: "GET",
      });

      if (response.ok) {
        const result = await response.json();
        const newToken = result.message;
        window.csrf_token = newToken;
        console.log("New CSRF token set:", newToken);
        return newToken;
      } else {
        console.error("Failed to refresh CSRF token");
        return null;
      }
    } catch (err) {
      console.error("Error refreshing CSRF token:", err);
      return null;
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
    testEndpoint,
    refreshCSRFToken,
    count: companies.length,
  }
}
