import { useState, useCallback } from 'react'

export interface MatchStatusData {
  voucher_type: string
  voucher_no: string
  company: string
  status: 'Match' | 'Mismatch' | 'Pending'
  matched_with?: any
}

export interface MatchStatusResponse {
  success: boolean
  status?: string
  matched_with?: string
  matched_with_parsed?: any
  matched_by?: string
  matched_on?: string
  message?: string
  error?: string
}

export const useMatchStatus = () => {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const updateMatchStatus = useCallback(async (data: MatchStatusData): Promise<MatchStatusResponse> => {
    setLoading(true)
    setError(null)
    console.log("Data", data)
    try {
      const response = await fetch('/api/method/nextlayer.next_layer.api.general_ledger.update_match_status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Frappe-CSRF-Token': window.csrf_token || ''
        },
        body: JSON.stringify({
          voucher_type: data.voucher_type,
          voucher_no: data.voucher_no,
          company: data.company,
          status: data.status,
          matched_with: data.matched_with
        }),
        credentials: 'include'
      })

      const result = await response.json()
      console.log("Providers", result.success)
      console.log("Full result:", result)

      // Handle Frappe API response structure (wrapped in message object)
      const responseData = result.message || result

      if (responseData.success) {
        return responseData
      } else {
        // Handle case where result.message might be an object
        const errorMessage = typeof responseData.message === 'string'
          ? responseData.message
          : responseData.message?.message || JSON.stringify(responseData.message) || 'Failed to update match status'
        throw new Error(errorMessage)
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
      setError(errorMessage)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const getMatchStatus = useCallback(async (voucherType: string, voucherNo: string, company: string): Promise<MatchStatusResponse> => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/method/nextlayer.next_layer.api.general_ledger.get_match_status?voucher_type=${encodeURIComponent(voucherType)}&voucher_no=${encodeURIComponent(voucherNo)}&company=${encodeURIComponent(company)}`, {
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
        return responseData
      } else {
        // Handle case where result.message might be an object
        const errorMessage = typeof responseData.message === 'string'
          ? responseData.message
          : responseData.message?.message || JSON.stringify(responseData.message) || 'Failed to get match status'
        throw new Error(errorMessage)
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
      setError(errorMessage)
      return { success: false, error: errorMessage }
    } finally {
      setLoading(false)
    }
  }, [])

  const bulkUpdateMatchStatus = useCallback(async (entries: MatchStatusData[]): Promise<{ success: number; failed: number; errors: string[] }> => {
    setLoading(true)
    setError(null)

    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[]
    }

    // Process entries in batches to avoid overwhelming the server
    const batchSize = 5
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize)

      const batchPromises = batch.map(async (entry) => {
        try {
          console.log(`Processing entry: ${entry.voucher_type} ${entry.voucher_no}`)
          await updateMatchStatus(entry)
          console.log(`Successfully processed: ${entry.voucher_type} ${entry.voucher_no}`)
          results.success++
        } catch (err) {
          console.error(`Error processing ${entry.voucher_type} ${entry.voucher_no}:`, err)
          results.failed++
          const errorMessage = err instanceof Error ? err.message : 'Unknown error'
          results.errors.push(`${entry.voucher_type} ${entry.voucher_no}: ${errorMessage}`)
        }
      })

      // Wait for current batch to complete before processing next batch
      await Promise.all(batchPromises)
    }

    setLoading(false)
    return results
  }, [updateMatchStatus])

  const refreshMatchStatuses = useCallback(async (entries: Array<{ voucher_type: string; voucher_no: string; company: string }>): Promise<{[key: string]: MatchStatusResponse}> => {
    setLoading(true)
    setError(null)

    const statusMap: {[key: string]: MatchStatusResponse} = {}

    // Process entries in batches
    const batchSize = 10
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize)

      const batchPromises = batch.map(async (entry) => {
        const key = `${entry.voucher_type}-${entry.voucher_no}`
        try {
          const result = await getMatchStatus(entry.voucher_type, entry.voucher_no, entry.company)
          statusMap[key] = result
        } catch (err) {
          statusMap[key] = { success: false, error: 'Failed to fetch status' }
        }
      })

      await Promise.all(batchPromises)
    }

    setLoading(false)
    return statusMap
  }, [getMatchStatus])

  const getVoucherAmount = useCallback(async (voucherType: string, voucherNo: string): Promise<{ success: boolean; amount?: number; debit?: number; credit?: number; currency?: string; error?: string }> => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/method/nextlayer.next_layer.api.general_ledger.get_voucher_amount?voucher_type=${encodeURIComponent(voucherType)}&voucher_no=${encodeURIComponent(voucherNo)}`, {
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
        return responseData
      } else {
        const errorMessage = responseData.error || responseData.message || 'Failed to get voucher amount'
        setError(errorMessage)
        return { success: false, error: errorMessage }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
      setError(errorMessage)
      return { success: false, error: errorMessage }
    } finally {
      setLoading(false)
    }
  }, [])

  return {
    updateMatchStatus,
    getMatchStatus,
    getVoucherAmount,
    bulkUpdateMatchStatus,
    refreshMatchStatuses,
    loading,
    error,
    clearError: useCallback(() => setError(null), [])
  }
}
