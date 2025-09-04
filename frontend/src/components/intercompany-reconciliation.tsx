"use client"

import { useState, useMemo, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { Button } from "./ui/button"
import { Badge } from "./ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table"
import { Alert, AlertDescription } from "./ui/alert"
import { ArrowLeftRight, CheckCircle, XCircle, AlertTriangle, RefreshCw } from "lucide-react"
import { useCompanies } from "../hook/useCompanies"
import { useParties } from "../hook/useParties"
import { useGeneralLedgerData } from "../hook/useGeneralLedgerData"
import { useMatchStatus } from "../hook/useMatchStatus"

export interface GLEntry {
  gl_entry?: string
  posting_date: string
  account: string
  voucher_type: string
  voucher_no: string
  debit: number
  credit: number
  balance: number
  against: string
  remarks?: string
  party_type?: string
  party?: string
  cost_center?: string
  project?: string
  status?: 'Match' | 'Mismatch' | 'Pending'
  matchedEntry?: GLEntry
  backendMatchData?: {
    status: string
    matched_with?: string
    matched_by?: string
    matched_on?: string
  }
}

export default function IntercompanyReconciliation() {
  // State for selections
  const [companyA, setCompanyA] = useState<string>("")
  const [partyA, setPartyA] = useState<string>("")
  const [companyB, setCompanyB] = useState<string>("")
  const [partyTypeB, setPartyTypeB] = useState<string>("Supplier")
  const [partyB, setPartyB] = useState<string>("")
  const [fromDate, setFromDate] = useState<string>("2024-01-01")
  const [toDate, setToDate] = useState<string>("2024-12-31")
  const [shouldLoadData, setShouldLoadData] = useState(false)
  const [isAutoFilled, setIsAutoFilled] = useState(false)

  // Status filtering and matching
  const [statusFilter, setStatusFilter] = useState<string>("Mismatch")
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set())
  const [showMatchModal, setShowMatchModal] = useState(false)
  const [matchingEntry, setMatchingEntry] = useState<GLEntry | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingCancelled, setProcessingCancelled] = useState(false)
  const [processingSuccess, setProcessingSuccess] = useState(false)

  // Use the custom hooks
  const { companies, isLoading: companiesLoading, error: companiesError, testEndpoint, refreshCSRFToken } = useCompanies()
  const { updateMatchStatus, getMatchStatus, bulkUpdateMatchStatus, refreshMatchStatuses, loading: matchLoading, error: matchError, clearError } = useMatchStatus()

  const { parties: partiesA, isLoading: partiesALoading, error: partiesAError } = useParties(
    "Customer",
    companyA
  )

  const { parties: partiesB, isLoading: partiesBLoading, error: partiesBError } = useParties(
    partyTypeB,
    companyB
  )


  // GL Data hooks - only fetch when shouldLoadData is true
  const {
    data: glDataA,
    reconciliationTotals: totalsA,
    loading: glLoadingA,
    error: glErrorA
  } = useGeneralLedgerData({
    company: shouldLoadData ? companyA : "",
    partyType: "Customer",
    party: shouldLoadData ? partyA : "",
    fromDate,
    toDate
  })

  const {
    data: glDataB,
    reconciliationTotals: totalsB,
    loading: glLoadingB,
    error: glErrorB
  } = useGeneralLedgerData({
    company: shouldLoadData ? companyB : "",
    partyType: partyTypeB,
    party: shouldLoadData ? partyB : "",
    fromDate,
    toDate
  })

  // Auto-fill Company B when Company A and Party A are selected
  useEffect(() => {
    if (companyA && partyA && !companyB && !partyB) {
      const selectedParty = partiesA.find(p => p.name === partyA)
      if (selectedParty) {
        setCompanyB(selectedParty.name)
        setPartyB(companyA)
        setIsAutoFilled(true)
      }
    }
  }, [companyA, partyA, partiesA, companyB, partyB])

  // Handle manual changes to Company B
  const handleCompanyBChange = (value: string) => {
    setCompanyB(value)
    setPartyB("") // Reset party when company changes
    setIsAutoFilled(false)
  }

  const handlePartyTypeBChange = (value: string) => {
    setPartyTypeB(value)
    setPartyB("") // Reset party when party type changes
    setIsAutoFilled(false)
  }

  const handlePartyBChange = (value: string) => {
    setPartyB(value)
    setIsAutoFilled(false)
  }

  const handleLoadData = () => {
    if (!companyA || !partyA || !companyB || !partyB) {
      return
    }
    setShouldLoadData(true)
  }

  // Reset data loading flag when selections change
  useEffect(() => {
    setShouldLoadData(false)
  }, [companyA, partyA, companyB, partyTypeB, partyB, fromDate, toDate])

    // State for storing backend match status
  const [backendMatchStatus, setBackendMatchStatus] = useState<{[key: string]: any}>({})

    // Fetch match status from backend when data is loaded
  useEffect(() => {
    const fetchMatchStatus = async () => {
      if (!glDataA.length || !glDataB.length || !companyA || !companyB) return

      const statusMap: {[key: string]: any} = {}

      // Fetch status for Company A entries
      for (const entry of glDataA) {
        try {
          const result = await getMatchStatus(entry.voucher_type, entry.voucher_no, companyA)
          if (result.success) {
            const key = `${entry.voucher_type}-${entry.voucher_no}`
            statusMap[key] = result
          }
        } catch (error) {
          console.error(`Error fetching match status for ${entry.voucher_type} ${entry.voucher_no}:`, error)
        }
      }

      // Fetch status for Company B entries
      for (const entry of glDataB) {
        try {
          const result = await getMatchStatus(entry.voucher_type, entry.voucher_no, companyB)
          if (result.success) {
            const key = `${entry.voucher_type}-${entry.voucher_no}`
            statusMap[key] = result
          }
        } catch (error) {
          console.error(`Error fetching match status for ${entry.voucher_type} ${entry.voucher_no}:`, error)
        }
      }

      setBackendMatchStatus(statusMap)
    }

    fetchMatchStatus()
  }, [glDataA, glDataB, companyA, companyB])

  // Function to find matching entries between Company A and Company B
  const findMatchingEntries = useMemo(() => {
    if (!glDataA.length || !glDataB.length) return { glDataAWithStatus: [], glDataBWithStatus: [] }

    // Create a map to track which entries have been matched to prevent duplicates
    const matchedEntriesB = new Set<string>()
    const matchedEntriesA = new Set<string>()

    // First pass: Process Company A entries and find their matches
    const glDataAWithStatus: GLEntry[] = glDataA.map(entryA => {
      // Find matching entry in Company B based on amount only (date can be different)
      // But ensure we don't match with an entry that's already been matched
      const matchingEntry = glDataB.find(entryB => {
        const entryBKey = `${entryB.voucher_type}-${entryB.voucher_no}`

        // Skip if this entry B has already been matched
        if (matchedEntriesB.has(entryBKey)) {
          return false
        }

        // Check if amounts match (debit on one side should equal credit on other side)
        const debitCreditMatch = Math.abs(entryA.debit - entryB.credit) < 0.01
        const creditDebitMatch = Math.abs(entryA.credit - entryB.debit) < 0.01

        // Return true if either debit matches credit OR credit matches debit (no date requirement)
        return debitCreditMatch || creditDebitMatch
      })

      // If we found a match, mark it as used
      if (matchingEntry) {
        const entryBKey = `${matchingEntry.voucher_type}-${matchingEntry.voucher_no}`
        matchedEntriesB.add(entryBKey)
      }

      // Check if we have backend status for this entry
      const key = `${entryA.voucher_type}-${entryA.voucher_no}`
      const backendStatus = backendMatchStatus[key]

      // Use backend status if available, otherwise use client-side logic
      let status: 'Match' | 'Mismatch' | 'Pending'
      if (backendStatus && backendStatus.status) {
        status = backendStatus.status
      } else {
        status = matchingEntry ? 'Match' : 'Mismatch'
      }

      return {
        ...entryA,
        status,
        matchedEntry: matchingEntry,
        backendMatchData: backendStatus
      }
    })

    // Second pass: Process Company B entries and find their matches
    const glDataBWithStatus: GLEntry[] = glDataB.map(entryB => {
      // Find matching entry in Company A
      const matchingEntry = glDataA.find(entryA => {
        const entryAKey = `${entryA.voucher_type}-${entryA.voucher_no}`

        // Skip if this entry A has already been matched
        if (matchedEntriesA.has(entryAKey)) {
          return false
        }

        // Check if amounts match (debit on one side should equal credit on other side)
        const debitCreditMatch = Math.abs(entryA.debit - entryB.credit) < 0.01
        const creditDebitMatch = Math.abs(entryA.credit - entryB.debit) < 0.01

        // Return true if either debit matches credit OR credit matches debit (no date requirement)
        return debitCreditMatch || creditDebitMatch
      })

      // If we found a match, mark it as used
      if (matchingEntry) {
        const entryAKey = `${matchingEntry.voucher_type}-${matchingEntry.voucher_no}`
        matchedEntriesA.add(entryAKey)
      }

      // Check if we have backend status for this entry
      const key = `${entryB.voucher_type}-${entryB.voucher_no}`
      const backendStatus = backendMatchStatus[key]

      // Use backend status if available, otherwise use client-side logic
      let status: 'Match' | 'Mismatch' | 'Pending'
      if (backendStatus && backendStatus.status) {
        status = backendStatus.status
      } else {
        status = matchingEntry ? 'Match' : 'Mismatch'
      }

      return {
        ...entryB,
        status: status,
        matchedEntry: matchingEntry,
        backendMatchData: backendStatus
      }
    })

    return { glDataAWithStatus, glDataBWithStatus }
  }, [glDataA, glDataB, backendMatchStatus])

  // Updated reconciliation analysis using reconciliationTotals
  const reconciliationAnalysis = useMemo(() => {
    if (!totalsA || !totalsB) return null

    const totalDebitA = totalsA.totalDebit
    const totalCreditA = totalsA.totalCredit
    const totalDebitB = totalsB.totalDebit
    const totalCreditB = totalsB.totalCredit

    const debitCreditMatch = Math.abs(totalDebitA - totalCreditB) < 0.01
    const creditDebitMatch = Math.abs(totalCreditA - totalDebitB) < 0.01
    const isFullyReconciled = debitCreditMatch && creditDebitMatch

    return {
      totalDebitA,
      totalCreditA,
      totalDebitB,
      totalCreditB,
      debitCreditMatch,
      creditDebitMatch,
      isFullyReconciled,
      balanceA: totalsA.balance,
      balanceB: totalsB.balance,
    }
  }, [totalsA, totalsB])

    const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0
    }).format(amount)
  }

  // Handle entry selection
  const handleEntrySelect = (entryKey: string, isSelected: boolean) => {
    const newSelected = new Set(selectedEntries)
    if (isSelected) {
      newSelected.add(entryKey)
    } else {
      newSelected.delete(entryKey)
    }
    setSelectedEntries(newSelected)
  }

      // Handle bulk matching
  const handleBulkMatch = async () => {
    console.log("Starting bulk match process...")
    setIsProcessing(true)
    setProcessingCancelled(false)

    try {
      // Get all selected entries that have potential matches
      const entriesToMatch: Array<{ entryA: GLEntry; entryB: GLEntry }> = []

      console.log("Processing selected entries:", selectedEntries.size)

      for (const entryKey of selectedEntries) {
        // Check if processing was cancelled
        if (processingCancelled) {
          console.log("Processing cancelled by user")
          return
        }

        console.log("Processing entry key:", entryKey)

        // Find the entry in both Company A and Company B data
        const entryA = findMatchingEntries.glDataAWithStatus.find(entry =>
          `${entry.voucher_type}-${entry.voucher_no}` === entryKey
        )
        const entryB = findMatchingEntries.glDataBWithStatus.find(entry =>
          `${entry.voucher_type}-${entry.voucher_no}` === entryKey
        )

        if (entryA && entryA.matchedEntry) {
          entriesToMatch.push({ entryA, entryB: entryA.matchedEntry })
          console.log("Found match for entry A:", entryA.voucher_no)
        } else if (entryB && entryB.matchedEntry) {
          entriesToMatch.push({ entryA: entryB.matchedEntry, entryB })
          console.log("Found match for entry B:", entryB.voucher_no)
        }
      }

      if (entriesToMatch.length === 0) {
        alert('No valid matches found for selected entries.')
        setIsProcessing(false)
        return
      }

      console.log("Total entries to match:", entriesToMatch.length)

      // Prepare data for bulk update
      const bulkData = []
      for (const { entryA, entryB } of entriesToMatch) {
        // Check if processing was cancelled
        if (processingCancelled) {
          console.log("Processing cancelled during data preparation")
          return
        }

        bulkData.push({
          voucher_type: entryA.voucher_type,
          voucher_no: entryA.voucher_no,
          company: companyA,
          status: 'Match' as const,
          matched_with: entryB
        })
        bulkData.push({
          voucher_type: entryB.voucher_type,
          voucher_no: entryB.voucher_no,
          company: companyB,
          status: 'Match' as const,
          matched_with: entryA
        })
      }

      console.log("Prepared bulk data:", bulkData)

      // Check if processing was cancelled before API call
      if (processingCancelled) {
        console.log("Processing cancelled before API call")
        return
      }

      // Perform bulk update
      console.log("Calling bulkUpdateMatchStatus...")
      const result = await bulkUpdateMatchStatus(bulkData)
      console.log("Bulk update result:", result)

      if (result.failed > 0) {
        alert(`Bulk matching completed with ${result.success} successful and ${result.failed} failed updates.\n\nErrors:\n${result.errors.join('\n')}`)
      } else {
        setProcessingSuccess(true)
        // Auto-close modal after 2 seconds
        setTimeout(() => {
          setShowMatchModal(false)
          setIsProcessing(false)
          setProcessingSuccess(false)
        }, 2000)
      }

      // Check if processing was cancelled before refresh
      if (processingCancelled) {
        console.log("Processing cancelled before refresh")
        return
      }

      // Refresh the match statuses
      console.log("Refreshing match statuses...")
      const allEntries = [...glDataA, ...glDataB].map(entry => ({
        voucher_type: entry.voucher_type,
        voucher_no: entry.voucher_no,
        company: glDataA.includes(entry) ? companyA : companyB
      }))

      const newStatusMap = await refreshMatchStatuses(allEntries)
      setBackendMatchStatus(newStatusMap)

      // Clear selections and close modal
      setSelectedEntries(new Set())
      setIsProcessing(false)
      setShowMatchModal(false)
      console.log("Bulk match process completed successfully, modal closed")
      console.log("Modal state after completion - showMatchModal:", false, "isProcessing:", false)

      // Force close modal after a short delay to ensure it closes
      setTimeout(() => {
        setShowMatchModal(false)
        setIsProcessing(false)
        console.log("Forced modal close after timeout")
      }, 100)

    } catch (error) {
      console.error('Error in bulk matching:', error)
      alert('Failed to perform bulk matching. Please try again.')
      setIsProcessing(false)
      console.log("Bulk match process failed, processing state reset")
    }
  }
  // Reset processing state when modal opens
  useEffect(() => {
    if (showMatchModal) {
      console.log("Modal opened, resetting processing state")
      setIsProcessing(false)
      setProcessingCancelled(false)
      setProcessingSuccess(false)
      // Clear any existing errors when modal opens
      if (matchError) {
        console.log("Clearing match error:", matchError)
        clearError()
      }
    }
  }, [showMatchModal, matchError, clearError])

  const handleCancelProcessing = () => {
    console.log("User cancelled processing")
    setProcessingCancelled(true)
    setIsProcessing(false)
  }

  const handleManualMatch = async (entryA: GLEntry, entryB: GLEntry) => {
    try {
      // Update both entries to Match status using the hook
      await updateMatchStatus({
        voucher_type: entryA.voucher_type,
        voucher_no: entryA.voucher_no,
        company: companyA,
        status: 'Match',
        matched_with: entryB
      })

      await updateMatchStatus({
        voucher_type: entryB.voucher_type,
        voucher_no: entryB.voucher_no,
        company: companyB,
        status: 'Match',
        matched_with: entryA
      })

      // Refresh backend match status
      const statusMap = { ...backendMatchStatus }

      // Update the status map with new data
      const keyA = `${entryA.voucher_type}-${entryA.voucher_no}`
      const keyB = `${entryB.voucher_type}-${entryB.voucher_no}`

      statusMap[keyA] = {
        success: true,
        status: 'Match',
        matched_with: JSON.stringify(entryB),
        matched_by: 'current_user', // This will be set by backend
        matched_on: new Date().toISOString()
      }

      statusMap[keyB] = {
        success: true,
        status: 'Match',
        matched_with: JSON.stringify(entryA),
        matched_by: 'current_user', // This will be set by backend
        matched_on: new Date().toISOString()
      }

      setBackendMatchStatus(statusMap)
      setShowMatchModal(false)
      setMatchingEntry(null)
    } catch (error) {
      console.error('Error matching entries:', error)
      alert('Failed to match entries. Please try again.')
    }
  }

  // Filter entries by status
  const filterEntriesByStatus = (entries: GLEntry[]) => {
    if (statusFilter === 'All') return entries
    return entries.filter(entry => entry.status === statusFilter)
  }

  // Determine loading and error states
  const isLoading = glLoadingA || glLoadingB
  const error = companiesError || partiesAError || partiesBError || glErrorA || glErrorB

  // Get status badge component
  const getStatusBadge = (status: 'Match' | 'Mismatch' | 'Pending') => {
    switch (status) {
      case 'Match':
        return <Badge className="bg-green-100 text-green-800 border-green-200">✓ Match</Badge>
      case 'Mismatch':
        return <Badge className="bg-red-100 text-red-800 border-red-200">✗ Mismatch</Badge>
      default:
        return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">? Pending</Badge>
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50 p-4">
      <div className="max-w-8xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-blue-800 bg-clip-text text-transparent">
            Intercompany General Ledger Reconciliation
          </h1>
          <p className="text-gray-600 text-lg">
            Compare and reconcile General Ledger entries between intercompany transactions
          </p>
        </div>

        {/* Company Selection */}
        <Card className="border-blue-200 shadow-lg">
          <CardHeader className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg">
            <CardTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5" />
              General Ledger Selection
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Company A Selection */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-blue-800 border-b border-blue-200 pb-2">
                  Company A (Customer View)
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">Company</label>
                    <Select value={companyA} onValueChange={setCompanyA} disabled={companiesLoading}>
                      <SelectTrigger className="border-blue-200 focus:border-blue-400">
                        <SelectValue placeholder={companiesLoading ? "Loading..." : "Select Company"} />
                      </SelectTrigger>
                      <SelectContent className="bg-blue-200">
                        {companies.map((company) => (
                          <SelectItem key={company.name} value={company.name}>
                            {company.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">Party Type</label>
                    <Select value="Customer" disabled>
                      <SelectTrigger className="border-blue-200 bg-blue-50">
                        <SelectValue placeholder="Customer" />
                      </SelectTrigger>
                      <SelectContent className="bg-blue-200">
                        <SelectItem value="Supplier">Supplier</SelectItem>
                        <SelectItem value="Customer">Customer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">Party</label>
                    <Select value={partyA} onValueChange={setPartyA} disabled={!companyA || partiesALoading}>
                      <SelectTrigger className="border-blue-200 focus:border-blue-400">
                        <SelectValue placeholder={partiesALoading ? "Loading..." : "Select Party"} />
                      </SelectTrigger>
                      <SelectContent className="bg-blue-200">
                        {partiesA.map((party) => (
                          <SelectItem key={party.name} value={party.name}>
                            {party.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Company B Selection */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-blue-800 border-b border-blue-200 pb-2">
                  Company B (Supplier View)
                  {isAutoFilled && (
                    <Badge variant="secondary" className="ml-2 bg-green-100 text-green-700">
                      Auto-filled
                    </Badge>
                  )}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">Company</label>
                    <Select
                      value={companyB}
                      onValueChange={handleCompanyBChange}
                      disabled={companiesLoading}
                    >
                      <SelectTrigger className="border-blue-200 focus:border-blue-400">
                        <SelectValue placeholder={companiesLoading ? "Loading..." : "Select Company"} />
                      </SelectTrigger>
                      <SelectContent className="bg-blue-200">
                        {companies.map((company) => (
                          <SelectItem key={company.name} value={company.name}>
                            {company.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">Party Type</label>
                    <Select value={partyTypeB} onValueChange={handlePartyTypeBChange}>
                      <SelectTrigger className="border-blue-200 focus:border-blue-400">
                        <SelectValue placeholder="Select Party Type" />
                      </SelectTrigger>
                      <SelectContent className="bg-blue-200">
                        <SelectItem value="Supplier">Supplier</SelectItem>
                        <SelectItem value="Customer">Customer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">Party</label>
                    <Select
                      value={partyB}
                      onValueChange={handlePartyBChange}
                      disabled={!companyB || partiesBLoading}
                    >
                      <SelectTrigger className="border-blue-200 focus:border-blue-400">
                        <SelectValue placeholder={partiesBLoading ? "Loading..." : "Select Party"} />
                      </SelectTrigger>
                      <SelectContent className="bg-blue-200">
                        {partiesB.map((party) => (
                          <SelectItem key={party.name} value={party.name}>
                            {party.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>

            {/* Date Range */}
            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">From Date</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full p-2 border border-blue-200 rounded-md focus:border-blue-400 focus:outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">To Date</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full p-2 border border-blue-200 rounded-md focus:border-blue-400 focus:outline-none"
                />
              </div>
            </div>

                        {/* Debug Section */}
            <div className="mt-6 pt-4 border-t border-gray-200">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-gray-600">Debug Tools</h4>
                <div className="flex gap-2">
                  <Button
                    onClick={testEndpoint}
                    variant="outline"
                    size="sm"
                    className="text-xs"
                  >
                    Test API Endpoint
                  </Button>
                  <Button
                    onClick={refreshCSRFToken}
                    variant="outline"
                    size="sm"
                    className="text-xs"
                  >
                    Refresh CSRF Token
                  </Button>
                </div>
              </div>
              {companiesError && (
                <Alert className="mt-2">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    Companies Error: {companiesError}
                  </AlertDescription>
                </Alert>
              )}
            </div>

            {error && (
              <Alert className="mt-4 border-red-200 bg-red-50">
                <XCircle className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-red-800">{error}</AlertDescription>
              </Alert>
            )}

            <div className="flex justify-center mt-6">
              <Button
                onClick={handleLoadData}
                disabled={!companyA || !partyA || !companyB || !partyB || isLoading}
                className="bg-blue-600 hover:bg-blue-700 text-white px-8"
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Loading...
                  </>
                ) : (
                  "Load General Ledger Data"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Reconciliation Analysis */}
        {reconciliationAnalysis && (
          <Card className="border-blue-200 shadow-lg">
            <CardHeader className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg">
              <CardTitle className="flex items-center gap-2">
                {reconciliationAnalysis.isFullyReconciled ? (
                  <CheckCircle className="h-5 w-5 text-green-300" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-yellow-300" />
                )}
                Reconciliation Analysis
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                {/* Company A Cards */}
                <Card className="border-blue-200">
                  <CardHeader className="bg-gray-50 border-b border-gray-200">
                    <CardTitle className="text-lg text-gray-800">
                      {companyA} Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-blue-600">
                          {formatCurrency(reconciliationAnalysis.totalDebitA)}
                        </div>
                        <div className="text-sm text-gray-600">Total Debit</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-green-600">
                          {formatCurrency(reconciliationAnalysis.totalCreditA)}
                        </div>
                        <div className="text-sm text-gray-600">Total Credit</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Company B Cards */}
                <Card className="border-blue-200">
                  <CardHeader className="bg-gray-50 border-b border-gray-200">
                    <CardTitle className="text-lg text-gray-800">
                      {companyB} Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-blue-600">
                          {formatCurrency(reconciliationAnalysis.totalDebitB)}
                        </div>
                        <div className="text-sm text-gray-600">Total Debit</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-green-600">
                          {formatCurrency(reconciliationAnalysis.totalCreditB)}
                        </div>
                        <div className="text-sm text-gray-600">Total Credit</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-3">
                <Alert
                  className={`border-2 ${reconciliationAnalysis.debitCreditMatch ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}
                >
                  <div className="flex items-center gap-2">
                    {reconciliationAnalysis.debitCreditMatch ? (
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-600" />
                    )}
                    <AlertDescription
                      className={reconciliationAnalysis.debitCreditMatch ? "text-green-800" : "text-red-800"}
                    >
                      <strong>Debit-Credit Match:</strong> Company A Debit ({formatCurrency(reconciliationAnalysis.totalDebitA)})
                      {reconciliationAnalysis.debitCreditMatch ? " matches " : " does not match "}
                      Company B Credit ({formatCurrency(reconciliationAnalysis.totalCreditB)})
                      {!reconciliationAnalysis.debitCreditMatch && (
                        <div className="mt-1">
                          Difference: {formatCurrency(Math.abs(reconciliationAnalysis.totalDebitA - reconciliationAnalysis.totalCreditB))}
                        </div>
                      )}
                    </AlertDescription>
                  </div>
                </Alert>

                <Alert
                  className={`border-2 ${reconciliationAnalysis.creditDebitMatch ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}
                >
                  <div className="flex items-center gap-2">
                    {reconciliationAnalysis.creditDebitMatch ? (
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-600" />
                    )}
                    <AlertDescription
                      className={reconciliationAnalysis.creditDebitMatch ? "text-green-800" : "text-red-800"}
                    >
                      <strong>Credit-Debit Match:</strong> Company A Credit ({formatCurrency(reconciliationAnalysis.totalCreditA)})
                      {reconciliationAnalysis.creditDebitMatch ? " matches " : " does not match "}
                      Company B Debit ({formatCurrency(reconciliationAnalysis.totalDebitB)})
                      {!reconciliationAnalysis.creditDebitMatch && (
                        <div className="mt-1">
                          Difference: {formatCurrency(Math.abs(reconciliationAnalysis.totalCreditA - reconciliationAnalysis.totalDebitB))}
                        </div>
                      )}
                    </AlertDescription>
                  </div>
                </Alert>

                {/* Overall Balance Comparison */}
                <Alert className="border-2 border-blue-200 bg-blue-50">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-blue-600" />
                    <AlertDescription className="text-blue-800">
                      <strong>Balance Summary:</strong>
                      <div className="mt-2 grid grid-cols-2 gap-4">
                        <div>{companyA} Balance: {formatCurrency(reconciliationAnalysis.balanceA)}</div>
                        <div>{companyB} Balance: {formatCurrency(reconciliationAnalysis.balanceB)}</div>
                      </div>
                    </AlertDescription>
                  </div>
                </Alert>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Status Filter and Actions */}
        {(findMatchingEntries.glDataAWithStatus.length > 0 || findMatchingEntries.glDataBWithStatus.length > 0) && (
          <Card className="border-blue-200 shadow-lg">
            <CardHeader className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg">
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5" />
                Status Filter & Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">Filter by Status</label>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="w-48 border-blue-200 focus:border-blue-400">
                        <SelectValue placeholder="Select Status" />
                      </SelectTrigger>
                      <SelectContent className="bg-blue-200">
                        <SelectItem value="All">All Entries</SelectItem>
                        <SelectItem value="Match">✓ Matched</SelectItem>
                        <SelectItem value="Mismatch">✗ Mismatched</SelectItem>
                        <SelectItem value="Pending">? Pending</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="text-sm text-gray-600">
                    Showing {filterEntriesByStatus(findMatchingEntries.glDataAWithStatus).length} of {findMatchingEntries.glDataAWithStatus.length} entries
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      console.log("Opening match modal with", selectedEntries.size, "selected entries")
                      console.log("Current matchLoading state:", matchLoading)
                      console.log("Current isProcessing state:", isProcessing)
                      setShowMatchModal(true)
                    }}
                    disabled={selectedEntries.size === 0 || isProcessing}
                    variant="outline"
                    className="border-green-200 text-green-700 hover:bg-green-50"
                  >
                    {isProcessing ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Match Selected ({selectedEntries.size})
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* General Ledger Data */}
        {(findMatchingEntries.glDataAWithStatus.length > 0 || findMatchingEntries.glDataBWithStatus.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Company A GL */}
            <Card className="border-blue-200 shadow-lg">
              <CardHeader className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg">
                <CardTitle>
                  {companies.find((c) => c.name === companyA)?.name || companyA} - General Ledger
                  <Badge variant="secondary" className="ml-2 bg-blue-100 text-blue-700">
                    Customer View
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-blue-50">
                        <TableHead className="text-blue-800 w-12">
                          <input
                            type="checkbox"
                            onChange={(e) => {
                              const isChecked = e.target.checked
                              const entryKeys = filterEntriesByStatus(findMatchingEntries.glDataAWithStatus).map(entry => `${entry.voucher_type}-${entry.voucher_no}`)
                              if (isChecked) {
                                setSelectedEntries(new Set([...selectedEntries, ...entryKeys]))
                              } else {
                                const newSelected = new Set(selectedEntries)
                                entryKeys.forEach(key => newSelected.delete(key))
                                setSelectedEntries(newSelected)
                              }
                            }}
                            className="rounded border-blue-300"
                          />
                        </TableHead>
                        <TableHead className="text-blue-800">Date</TableHead>
                        <TableHead className="text-blue-800">Voucher</TableHead>
                        <TableHead className="text-blue-800 text-right">Debit</TableHead>
                        <TableHead className="text-blue-800 text-right">Credit</TableHead>
                        <TableHead className="text-blue-800 text-right">Balance</TableHead>
                        <TableHead className="text-blue-800 text-center">Status</TableHead>
                        <TableHead className="text-blue-800 text-center">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filterEntriesByStatus(findMatchingEntries.glDataAWithStatus).map((entry, index) => {
                        const entryKey = `${entry.voucher_type}-${entry.voucher_no}`
                        return (
                          <TableRow key={entry.gl_entry || index} className="hover:bg-blue-50">
                            <TableCell>
                              <input
                                type="checkbox"
                                checked={selectedEntries.has(entryKey)}
                                onChange={(e) => handleEntrySelect(entryKey, e.target.checked)}
                                className="rounded border-blue-300"
                              />
                            </TableCell>
                            <TableCell className="font-medium">{entry.posting_date}</TableCell>
                            <TableCell>
                              <div>
                                <div className="font-medium">{entry.voucher_type}</div>
                                <div className="text-sm text-gray-600">{entry.voucher_no}</div>
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-medium text-blue-600">
                              {entry.debit > 0 ? formatCurrency(entry.debit) : "-"}
                            </TableCell>
                            <TableCell className="text-right font-medium text-green-600">
                              {entry.credit > 0 ? formatCurrency(entry.credit) : "-"}
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {formatCurrency(entry.balance)}
                            </TableCell>
                            <TableCell className="text-center">
                              {getStatusBadge(entry.status || 'Pending')}
                            </TableCell>
                            <TableCell className="text-center">
                              {entry.status === 'Mismatch' && entry.matchedEntry && (
                                <Button
                                  onClick={() => handleManualMatch(entry, entry.matchedEntry!)}
                                  size="sm"
                                  variant="outline"
                                  className="border-green-200 text-green-700 hover:bg-green-50"
                                >
                                  <CheckCircle className="h-3 w-3 mr-1" />
                                  Match
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                      {filterEntriesByStatus(findMatchingEntries.glDataAWithStatus).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center text-gray-500 py-8">
                            No data found for selected criteria
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Company B GL */}
            <Card className="border-blue-200 shadow-lg">
              <CardHeader className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg">
                <CardTitle>
                  {companies.find((c) => c.name === companyB)?.name || companyB} - General Ledger
                  <Badge variant="secondary" className="ml-2 bg-blue-100 text-blue-700">
                    {partyTypeB} View
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-blue-50">
                        <TableHead className="text-blue-800 w-12">
                          <input
                            type="checkbox"
                            onChange={(e) => {
                              const isChecked = e.target.checked
                              const entryKeys = filterEntriesByStatus(findMatchingEntries.glDataBWithStatus).map(entry => `${entry.voucher_type}-${entry.voucher_no}`)
                              if (isChecked) {
                                setSelectedEntries(new Set([...selectedEntries, ...entryKeys]))
                              } else {
                                const newSelected = new Set(selectedEntries)
                                entryKeys.forEach(key => newSelected.delete(key))
                                setSelectedEntries(newSelected)
                              }
                            }}
                            className="rounded border-blue-300"
                          />
                        </TableHead>
                        <TableHead className="text-blue-800">Date</TableHead>
                        <TableHead className="text-blue-800">Voucher</TableHead>
                        <TableHead className="text-blue-800 text-right">Debit</TableHead>
                        <TableHead className="text-blue-800 text-right">Credit</TableHead>
                        <TableHead className="text-blue-800 text-right">Balance</TableHead>
                        <TableHead className="text-blue-800 text-center">Status</TableHead>
                        <TableHead className="text-blue-800 text-center">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filterEntriesByStatus(findMatchingEntries.glDataBWithStatus).map((entry, index) => {
                        const entryKey = `${entry.voucher_type}-${entry.voucher_no}`
                        return (
                          <TableRow key={entry.gl_entry || index} className="hover:bg-blue-50">
                            <TableCell>
                              <input
                                type="checkbox"
                                checked={selectedEntries.has(entryKey)}
                                onChange={(e) => handleEntrySelect(entryKey, e.target.checked)}
                                className="rounded border-blue-300"
                              />
                            </TableCell>
                            <TableCell className="font-medium">{entry.posting_date}</TableCell>
                            <TableCell>
                              <div>
                                <div className="font-medium">{entry.voucher_type}</div>
                                <div className="text-sm text-gray-600">{entry.voucher_no}</div>
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-medium text-blue-600">
                              {entry.debit > 0 ? formatCurrency(entry.debit) : "-"}
                            </TableCell>
                            <TableCell className="text-right font-medium text-green-600">
                              {entry.credit > 0 ? formatCurrency(entry.credit) : "-"}
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {formatCurrency(entry.balance)}
                            </TableCell>
                            <TableCell className="text-center">
                              {getStatusBadge(entry.status || 'Pending')}
                            </TableCell>
                            <TableCell className="text-center">
                              {entry.status === 'Mismatch' && entry.matchedEntry && (
                                <Button
                                  onClick={() => handleManualMatch(entry, entry.matchedEntry!)}
                                  size="sm"
                                  variant="outline"
                                  className="border-green-200 text-green-700 hover:bg-green-50"
                                >
                                  <CheckCircle className="h-3 w-3 mr-1" />
                                  Match
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                      {filterEntriesByStatus(findMatchingEntries.glDataBWithStatus).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center text-gray-500 py-8">
                            No data found for selected criteria
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Match Confirmation Modal */}
        {showMatchModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-semibold mb-4">
                {processingSuccess ? "Success!" : isProcessing ? "Processing Bulk Matching" : "Confirm Bulk Matching"}
              </h3>
              <p className="text-gray-600 mb-4">
                {processingSuccess
                  ? `Successfully matched ${selectedEntries.size} entries! Modal will close automatically.`
                  : isProcessing
                    ? `Processing ${selectedEntries.size} selected entries... This may take a moment.`
                    : `Are you sure you want to mark ${selectedEntries.size} selected entries as matched? This action will update the status in the backend.`
                }
              </p>
              {isProcessing && (
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <RefreshCw className="h-4 w-4 animate-spin text-blue-600" />
                    <span className="text-sm text-blue-600">Processing entries...</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-blue-600 h-2 rounded-full animate-pulse" style={{ width: '100%' }}></div>
                  </div>
                </div>
              )}
              {processingSuccess && (
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <span className="text-sm text-green-600">Successfully completed!</span>
                  </div>
                </div>
              )}
              {matchError && (
                <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded text-red-700">
                  <div className="flex justify-between items-center">
                    <span>{matchError}</span>
                    <Button
                      onClick={clearError}
                      size="sm"
                      variant="outline"
                      className="ml-2 text-xs"
                    >
                      Clear
                    </Button>
                  </div>
                </div>
              )}
              <div className="flex gap-3 justify-end">
                {processingSuccess ? (
                  <Button
                    onClick={() => {
                      setShowMatchModal(false)
                      setIsProcessing(false)
                      setProcessingSuccess(false)
                    }}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    Close
                  </Button>
                ) : isProcessing ? (
                  <Button
                    onClick={handleCancelProcessing}
                    variant="outline"
                    className="border-orange-200 text-orange-700 hover:bg-orange-50"
                  >
                    Stop Processing
                  </Button>
                ) : (
                  <>
                    <Button
                      onClick={() => {
                        console.log("Modal cancelled, closing modal")
                        setShowMatchModal(false)
                      }}
                      variant="outline"
                      disabled={isProcessing}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={() => {
                        console.log("Confirm button clicked, starting bulk match process")
                        handleBulkMatch()
                      }}
                      className="bg-green-600 hover:bg-green-700"
                      disabled={isProcessing}
                    >
                      {isProcessing ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        `Confirm Match (${selectedEntries.size})`
                      )}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

