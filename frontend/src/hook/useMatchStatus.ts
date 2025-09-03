import { useState } from 'react'

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
  matched_by?: string
  matched_on?: string
  message?: string
  error?: string
}

export const useMatchStatus = () => {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const updateMatchStatus = async (data: MatchStatusData): Promise<MatchStatusResponse> => {
    setLoading(true)
    setError(null)
    // console.log("Data", data)
    try {
      const response = await fetch('/api/method/nextlayer.next_layer.api.general_ledger.update_match_status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          voucher_type: data.voucher_type,
          voucher_no: data.voucher_no,
          company: data.company,
          status: data.status,
          matched_with: data.matched_with
        })
      })

      const result = await response.json()
      console.log("Providers", result.message.success)
      if (result.message.success) {
        return result
      } else {
        throw new Error(result.message || 'Failed to update match status')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
      setError(errorMessage)
      throw err
    } finally {
      setLoading(false)
    }
  }

  const getMatchStatus = async (voucherType: string, voucherNo: string, company: string): Promise<MatchStatusResponse> => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/method/nextlayer.next_layer.api.general_ledger.get_match_status?voucher_type=${encodeURIComponent(voucherType)}&voucher_no=${encodeURIComponent(voucherNo)}&company=${encodeURIComponent(company)}`)
      const result = await response.json()

      if (result.success) {
        return result
      } else {
        throw new Error(result.message || 'Failed to get match status')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
      setError(errorMessage)
      return { success: false, error: errorMessage }
    } finally {
      setLoading(false)
    }
  }

  const bulkUpdateMatchStatus = async (entries: MatchStatusData[]): Promise<{ success: number; failed: number; errors: string[] }> => {
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
          await updateMatchStatus(entry)
          results.success++
        } catch (err) {
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
  }

  const refreshMatchStatuses = async (entries: Array<{ voucher_type: string; voucher_no: string; company: string }>): Promise<{[key: string]: MatchStatusResponse}> => {
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
  }

  return {
    updateMatchStatus,
    getMatchStatus,
    bulkUpdateMatchStatus,
    refreshMatchStatuses,
    loading,
    error,
    clearError: () => setError(null)
  }
}
