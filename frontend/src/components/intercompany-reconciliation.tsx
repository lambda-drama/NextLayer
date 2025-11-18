"use client"

import { useState, useMemo, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { Button } from "./ui/button"
import { Badge } from "./ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table"
import { Alert, AlertDescription } from "./ui/alert"
import { Checkbox } from "../../components/ui/checkbox"
import { ArrowLeftRight, CheckCircle, XCircle, AlertTriangle, RefreshCw, Building2, BarChart3 } from "lucide-react"
import { Link } from "react-router-dom"
import { useCompanies } from "../hook/useCompanies"
import { usePermissionAwareCompanies } from "../hook/usePermissionAwareCompanies"
import { useAllCompaniesForUI } from "../hook/useAllCompaniesForUI"
import { usePartiesForAutofill } from "../hook/usePartiesForAutofill"
import { usePermissionAwareParties } from "../hook/usePermissionAwareParties"
import { useGeneralLedgerData } from "../hook/useGeneralLedgerData"
import { usePermissionAwareGLData } from "../hook/usePermissionAwareGLData"
import { useMatchStatus } from "../hook/useMatchStatus"
import { useUserRoles } from "../hook/useUserRoles"
import HiddenDocumentsSummary from "./hidden-documents-summary"
import AdminPasswordDialog from "./admin-password-dialog"
import HiddenTransactionsModal from "./hidden-transactions-modal"
import { GLEntry } from "../types/gl-entry"

export default function IntercompanyReconciliation() {
  // State for selections
  const [companyA, setCompanyA] = useState<string>("")
  const [partyA, setPartyA] = useState<string>("")
  const [companyB, setCompanyB] = useState<string>("")
  const [partyTypeB, setPartyTypeB] = useState<string>("Supplier")
  const [partyB, setPartyB] = useState<string>("")
  const [fromDate, setFromDate] = useState<string>(`${new Date().getFullYear()}-01-01`)
  const [toDate, setToDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [currency, setCurrency] = useState<string>("all")
  const [ignoreExchangeRateRevaluation, setIgnoreExchangeRateRevaluation] = useState<boolean>(true)
  const [ignoreSystemGeneratedNotes, setIgnoreSystemGeneratedNotes] = useState<boolean>(true)
  const [isAutoFilled, setIsAutoFilled] = useState(false)
  const [automatchEnabled, setAutomatchEnabled] = useState(false)
  const [bypassTotalCalculation, setBypassTotalCalculation] = useState(false)

  // State for view checkboxes
  const [customerViewEnabled, setCustomerViewEnabled] = useState<boolean>(true)
  const [supplierViewEnabled, setSupplierViewEnabled] = useState<boolean>(false)
  const [showOpeningEntries, setShowOpeningEntries] = useState<boolean>(false)
  const [shouldLoadData, setShouldLoadData] = useState(false)
  const [hasLoadedData, setHasLoadedData] = useState(false)

  // Status filtering and matching
  const [statusFilter, setStatusFilter] = useState<string>("Mismatch")
  const [debitCreditFilter, setDebitCreditFilter] = useState<string>("All")
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set())
  const [showMatchModal, setShowMatchModal] = useState(false)
  const [showValidationError, setShowValidationError] = useState(false)
  const [validationErrorMessage, setValidationErrorMessage] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingCancelled, setProcessingCancelled] = useState(false)

  // State for hidden transactions modal
  const [showAdminPasswordDialog, setShowAdminPasswordDialog] = useState(false)
  const [showHiddenTransactionsModal, setShowHiddenTransactionsModal] = useState(false)
  const [isVerifyingPassword, setIsVerifyingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState("")
  const [hiddenTransactionsData, setHiddenTransactionsData] = useState<{
    companyA: GLEntry[]
    companyB: GLEntry[]
  }>({ companyA: [], companyB: [] })
  const [processingSuccess, setProcessingSuccess] = useState(false)
  const [showRestoreNotification, setShowRestoreNotification] = useState(false)

  // Individual confirmation dialogs
  const [showIndividualMatchModal, setShowIndividualMatchModal] = useState(false)
  const [showIndividualUnmatchModal, setShowIndividualUnmatchModal] = useState(false)
  const [selectedEntryForAction, setSelectedEntryForAction] = useState<GLEntry | null>(null)
  const [isIndividualProcessing, setIsIndividualProcessing] = useState(false)

  // Bulk modal details expansion
  const [showBulkMatchDetails, setShowBulkMatchDetails] = useState(false)

  // Manual matching state
  const [manualMatchMode, setManualMatchMode] = useState(false)
  const [selectedForManualMatch, setSelectedForManualMatch] = useState<GLEntry | null>(null)

  // Use the custom hooks
  const { companies, isLoading: companiesLoading, error: companiesError } = useCompanies()
  const { companies: permissionAwareCompanies } = usePermissionAwareCompanies()
  const { companies: allCompanies, isLoading: allCompaniesLoading, error: allCompaniesError } = useAllCompaniesForUI()
  const { updateMatchStatus, getMatchStatus, bulkUpdateMatchStatus, refreshMatchStatuses, error: matchError, clearError } = useMatchStatus()
  const { isSystemManagerOrAdmin } = useUserRoles()

  const { parties: partiesA, isLoading: partiesALoading, error: partiesAError } = usePermissionAwareParties("Customer")

  const { parties: partiesB, isLoading: partiesBLoading, error: partiesBError } = usePermissionAwareParties(partyTypeB as "Customer" | "Supplier")

  // Auto-fill parties hooks - bypasses permission checks for UI auto-filling
  const { parties: autofillPartiesA } = usePartiesForAutofill("Customer", companyA)
  const { parties: autofillPartiesB } = usePartiesForAutofill(partyTypeB, companyB)

  // Conditional party selection based on checkbox state
  // When checkbox is ticked: use permission-aware parties (restricted)
  // When checkbox is unchecked: use all parties for autofill functionality
  const displayPartiesA = customerViewEnabled ? partiesA : autofillPartiesA
  const displayPartiesB = supplierViewEnabled ? partiesB : autofillPartiesB

  // Conditional company selection based on checkbox state
  // When checkbox is ticked: use permission-aware companies (restricted)
  // When checkbox is unchecked: use all companies for autofill functionality
  const displayCompaniesA = customerViewEnabled ? permissionAwareCompanies : allCompanies
  const displayCompaniesB = supplierViewEnabled ? permissionAwareCompanies : allCompanies

  // GL Data hooks - get all data for transaction tables
  const {
    data: glDataA,
    reconciliationTotals: totalsA,
    loading: glLoadingA,
    error: glErrorA
  } = useGeneralLedgerData({
    company: companyA,
    partyType: "Customer",
    party: partyA,
    fromDate,
    toDate,
    currency: currency === "all" ? "" : currency,
    ignoreExchangeRateRevaluation,
    ignoreSystemGeneratedNotes,
    showOpeningEntries,
    shouldLoadData
  })

  const {
    data: glDataB,
    reconciliationTotals: totalsB,
    loading: glLoadingB,
    error: glErrorB
  } = useGeneralLedgerData({
    company: companyB,
    partyType: partyTypeB,
    party: partyB,
    fromDate,
    toDate,
    currency: currency === "all" ? "" : currency,
    ignoreExchangeRateRevaluation,
    ignoreSystemGeneratedNotes,
    showOpeningEntries,
    shouldLoadData
  })

  // Permission-aware GL Data hooks for enhanced security
  const {
    data: permissionAwareDataA,
    hiddenSummary: hiddenSummaryA,
    totalHiddenEntries: totalHiddenA
  } = usePermissionAwareGLData({
    company: companyA,
    partyType: "Customer",
    party: partyA,
    fromDate,
    toDate,
    currency: currency === "all" ? "" : currency,
    ignoreExchangeRateRevaluation,
    ignoreSystemGeneratedNotes,
    showOpeningEntries,
    shouldLoadData
  })

  const {
    data: permissionAwareDataB,
    hiddenSummary: hiddenSummaryB,
    totalHiddenEntries: totalHiddenB
  } = usePermissionAwareGLData({
    company: companyB,
    partyType: partyTypeB,
    party: partyB,
    fromDate,
    toDate,
    currency: currency === "all" ? "" : currency,
    ignoreExchangeRateRevaluation,
    ignoreSystemGeneratedNotes,
    showOpeningEntries,
    shouldLoadData
  })
  // Debug log for hidden summary - only log when value changes
  useEffect(() => {
    // console.log("Hidden Summary A:", hiddenSummaryA)
    // console.log("Hidden Summary B:", hiddenSummaryB)
    // console.log("Permission-aware Data A:", permissionAwareDataA.length, "entries")
    // console.log("Permission-aware Data B:", permissionAwareDataB.length, "entries")
    // console.log("Data", permissionAwareDataB)
  }, [hiddenSummaryA, hiddenSummaryB, permissionAwareDataA, permissionAwareDataB])

  // Auto-fill Company B when Company A and Party A are selected
  useEffect(() => {
    if (companyA && partyA && !companyB && !partyB) {
      const selectedParty = displayPartiesA.find(p => p.name === partyA)
      if (selectedParty) {
        setCompanyB(selectedParty.name)
        setPartyB(companyA)
        setIsAutoFilled(true)
      }
    }
  }, [companyA, partyA, displayPartiesA, companyB, partyB])

  // Auto-fill Company A when Company B and Party B are selected (reverse)
  useEffect(() => {
    if (companyB && partyB && !companyA && !partyA) {
      const selectedParty = displayPartiesB.find(p => p.name === partyB)
      if (selectedParty) {
        setCompanyA(selectedParty.name)
        setPartyA(companyB)
        setIsAutoFilled(true)
      }
    }
  }, [companyB, partyB, displayPartiesB, companyA, partyA])

  // Helper function to find corresponding company for intercompany transactions
  const findCorrespondingCompany = (selectedCompany: string): string | null => {
    if (!allCompanies.length) return null

    // Define company relationships/mappings
    const companyMappings: {[key: string]: string[]} = {
      // Add your specific company relationships here
      // Example: 'Company A' should be paired with 'Company B'
    }

    // If there's a specific mapping, use it
    if (companyMappings[selectedCompany]) {
      const mappedCompany = companyMappings[selectedCompany].find(company =>
        allCompanies.some(c => c.name === company)
      )
      if (mappedCompany) return mappedCompany
    }

    // Fallback: find a different company (preferably one the user has permission to)
    const otherCompanies = allCompanies.filter(company => company.name !== selectedCompany)

    // First try to find a company the user has permission to
    const permittedCompany = otherCompanies.find(company =>
      permissionAwareCompanies.some(pc => pc.name === company.name)
    )

    if (permittedCompany) return permittedCompany.name

    // If no permitted company found, return the first available company
    return otherCompanies.length > 0 ? otherCompanies[0].name : null
  }

  // Handle manual changes to Company A
  const handleCompanyAChange = (value: string) => {
    setCompanyA(value)
    setPartyA("")
    setIsAutoFilled(false)

    // Autofill Company B using all companies API (only if customer view is enabled)
    if (value && customerViewEnabled && allCompanies.length > 0) {
      const correspondingCompany = findCorrespondingCompany(value)
      if (correspondingCompany) {
        setCompanyB(correspondingCompany)
        setIsAutoFilled(true)
      }
    }
  }

  // Handle manual changes to Company B
  const handleCompanyBChange = (value: string) => {
    setCompanyB(value)
    setPartyB("")
    setIsAutoFilled(false)

    // Autofill Company A using all companies API (only if supplier view is enabled)
    if (value && supplierViewEnabled && allCompanies.length > 0) {
      const correspondingCompany = findCorrespondingCompany(value)
      if (correspondingCompany) {
        setCompanyA(correspondingCompany)
        setIsAutoFilled(true)
      }
    }
  }

  const handlePartyTypeBChange = (value: string) => {
    setPartyTypeB(value)
    setPartyB("")
    setIsAutoFilled(false)
  }

  // Handle checkbox changes
  const handleCustomerViewChange = (checked: boolean) => {
    setCustomerViewEnabled(checked)
    if (checked) {
      setSupplierViewEnabled(false)
      // Clear Company B when switching to customer view
      setCompanyB("")
      setPartyB("")
    }
  }

  const handleSupplierViewChange = (checked: boolean) => {
    setSupplierViewEnabled(checked)
    if (checked) {
      setCustomerViewEnabled(false)
      // Clear Company A when switching to supplier view
      setCompanyA("")
      setPartyA("")
    }
  }

  const handleAutomatchChange = (checked: boolean) => {
    setAutomatchEnabled(checked)
  }

  const handleBypassTotalCalculationChange = (checked: boolean) => {
    setBypassTotalCalculation(checked)
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
    setHasLoadedData(true)
  }

  // Handle voucher click - cache data and navigate to ERPNext
  const handleVoucherClick = (_entry: GLEntry) => {
    // Cache current state
    const currentState = {
      companyA,
      partyA,
      companyB,
      partyTypeB,
      partyB,
      fromDate,
      toDate,
      currency,
      ignoreExchangeRateRevaluation,
      ignoreSystemGeneratedNotes,
      showOpeningEntries,
      statusFilter,
      selectedEntries: Array.from(selectedEntries),
      glDataA,
      glDataB,
      totalsA,
      totalsB,
      backendMatchStatus,
      timestamp: Date.now()
    }

    localStorage.setItem('intercompanyReconciliationState', JSON.stringify(currentState))

    // Show a brief notification
    // console.log(`Navigating to ${entry.voucher_type} ${entry.voucher_no}. Your data will be preserved when you return.`)
  }

  // Generate proper ERPNext URL for different voucher types
  const getVoucherUrl = (voucherType: string, voucherNo: string) => {
    const typeMap: { [key: string]: string } = {
      'Journal Entry': 'journal-entry',
      'Sales Invoice': 'sales-invoice',
      'Purchase Invoice': 'purchase-invoice',
      'Payment Entry': 'payment-entry',
      'Sales Order': 'sales-order',
      'Purchase Order': 'purchase-order',
      'Delivery Note': 'delivery-note',
      'Purchase Receipt': 'purchase-receipt',
      'Stock Entry': 'stock-entry',
      'Material Request': 'material-request',
      'Request for Quotation': 'request-for-quotation',
      'Supplier Quotation': 'supplier-quotation'
    }

    const docType = typeMap[voucherType] || voucherType.toLowerCase().replace(/\s+/g, '-')
    return `/app/${docType}/${voucherNo}`
  }

  // Restore cached data on component mount
  useEffect(() => {
    const cachedState = localStorage.getItem('intercompanyReconciliationState')
    if (cachedState) {
      try {
        const state = JSON.parse(cachedState)
        // Only restore if cache is less than 1 hour old
        if (Date.now() - state.timestamp < 3600000) {
          setCompanyA(state.companyA || "")
          setPartyA(state.partyA || "")
          setCompanyB(state.companyB || "")
          setPartyTypeB(state.partyTypeB || "Supplier")
          setPartyB(state.partyB || "")
          setFromDate(state.fromDate || `${new Date().getFullYear()}-01-01`)
          setToDate(state.toDate || new Date().toISOString().split('T')[0])
          setCurrency(state.currency || "all")
          setIgnoreExchangeRateRevaluation(state.ignoreExchangeRateRevaluation !== undefined ? state.ignoreExchangeRateRevaluation : true)
          setIgnoreSystemGeneratedNotes(state.ignoreSystemGeneratedNotes !== undefined ? state.ignoreSystemGeneratedNotes : true)
          setShowOpeningEntries(state.showOpeningEntries || false)
          setStatusFilter(state.statusFilter || "Mismatch")
          setSelectedEntries(new Set(state.selectedEntries || []))

          // Restore data if available
          if (state.glDataA && state.glDataB) {
            // Note: We can't directly set the hook data, but we can trigger a refetch
            // The user will need to click "Load General Ledger Data" to refresh
            setShowRestoreNotification(true)
            // Auto-hide notification after 5 seconds
            setTimeout(() => setShowRestoreNotification(false), 5000)
          }

          // Clear the cache after restoring
          localStorage.removeItem('intercompanyReconciliationState')
        }
      } catch (error) {
        console.error('Error restoring cached state:', error)
        localStorage.removeItem('intercompanyReconciliationState')
      }
    }
  }, [])

  // Reset data loading flag when selections change, but allow refetch if data was previously loaded
  useEffect(() => {
    if (hasLoadedData) {
      // If data was previously loaded, keep shouldLoadData true to allow refetch with new parameters
      setShouldLoadData(true)
    } else {
      // If data was never loaded, reset the flag
      setShouldLoadData(false)
    }
  }, [companyA, partyA, companyB, partyTypeB, partyB, fromDate, toDate, currency, ignoreExchangeRateRevaluation, ignoreSystemGeneratedNotes, showOpeningEntries, hasLoadedData])

    // State for storing backend match status
  const [backendMatchStatus, setBackendMatchStatus] = useState<{[key: string]: any}>({})
  const [isFetchingBackendStatus, setIsFetchingBackendStatus] = useState(false)
  const [hasBackendStatusData, setHasBackendStatusData] = useState(false)

  // Smart status fetching: Fetch on initial load and when user changes to "Match" filter
  useEffect(() => {
    const fetchMatchStatus = async () => {
      // Skip if we already have backend status data
      if (hasBackendStatusData) return

      if (!glDataA.length || !glDataB.length || !companyA || !companyB) return

      setIsFetchingBackendStatus(true)
      const statusMap: {[key: string]: any} = {}

      // Create all API calls for Company A entries
      const companyAPromises = glDataA.map(async (entry) => {
        try {
          const result = await getMatchStatus(entry.voucher_type, entry.voucher_no, companyA)
          if (result.success) {
            const key = `${entry.voucher_type}-${entry.voucher_no}`
            return { key, result }
          }
        } catch (error) {
          console.error(`Error fetching match status for ${entry.voucher_type} ${entry.voucher_no}:`, error)
        }
        return null
      })

      // Create all API calls for Company B entries
      const companyBPromises = glDataB.map(async (entry) => {
        try {
          const result = await getMatchStatus(entry.voucher_type, entry.voucher_no, companyB)
          if (result.success) {
            const key = `${entry.voucher_type}-${entry.voucher_no}`
            return { key, result }
          }
        } catch (error) {
          console.error(`Error fetching match status for ${entry.voucher_type} ${entry.voucher_no}:`, error)
        }
        return null
      })

      // Execute all API calls in parallel
      const allResults = await Promise.all([...companyAPromises, ...companyBPromises])

      // Process results
      allResults.forEach(item => {
        if (item) {
          statusMap[item.key] = item.result
        }
      })

      setBackendMatchStatus(statusMap)
      setIsFetchingBackendStatus(false)
      setHasBackendStatusData(true)
    }

    fetchMatchStatus()
  }, [glDataA, glDataB, companyA, companyB, hasBackendStatusData])

  // Reset backend status cache when GL data changes (new data load)
  useEffect(() => {
    setHasBackendStatusData(false)
  }, [glDataA, glDataB])

  // Function to refresh backend statuses when needed (after matching operations)
  const refreshBackendStatuses = async () => {
    if (!glDataA.length || !glDataB.length || !companyA || !companyB) return

    setIsFetchingBackendStatus(true)
    const statusMap: {[key: string]: any} = {}

    // Create all API calls for Company A entries
    const companyAPromises = glDataA.map(async (entry) => {
      try {
        const result = await getMatchStatus(entry.voucher_type, entry.voucher_no, companyA)
        if (result.success) {
          const key = `${entry.voucher_type}-${entry.voucher_no}`
          return { key, result }
        }
      } catch (error) {
        console.error(`Error fetching match status for ${entry.voucher_type} ${entry.voucher_no}:`, error)
      }
      return null
    })

    // Create all API calls for Company B entries
    const companyBPromises = glDataB.map(async (entry) => {
      try {
        const result = await getMatchStatus(entry.voucher_type, entry.voucher_no, companyB)
        if (result.success) {
          const key = `${entry.voucher_type}-${entry.voucher_no}`
          return { key, result }
        }
      } catch (error) {
        console.error(`Error fetching match status for ${entry.voucher_type} ${entry.voucher_no}:`, error)
      }
      return null
    })

    // Execute all API calls in parallel
    const allResults = await Promise.all([...companyAPromises, ...companyBPromises])

    // Process results
    allResults.forEach(item => {
      if (item) {
        statusMap[item.key] = item.result
      }
    })

    setBackendMatchStatus(statusMap)
    setIsFetchingBackendStatus(false)
    setHasBackendStatusData(true) // Mark that we have fresh backend data
  }

  // Function to handle viewing hidden transactions
  const handleViewHiddenTransactions = () => {
    setShowAdminPasswordDialog(true)
    setPasswordError("")
  }

  // Function to verify admin password and fetch hidden transactions
  const handlePasswordVerification = async (password: string) => {
    setIsVerifyingPassword(true)
    setPasswordError("")

    try {
      // Call Frappe API to verify admin password and fetch hidden transactions
      const response = await fetch('/api/method/nextlayer.next_layer.api.general_ledger.verify_admin_password_and_get_hidden_transactions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
           'X-Frappe-CSRF-Token': window.csrf_token || ''
        },
        body: JSON.stringify({
          admin_password: password,
          company_a: companyA,
          company_b: companyB,
          party_a: partyA,
          party_b: partyB,
          party_type_b: partyTypeB,
          from_date: fromDate,
          to_date: toDate,
          currency: currency,
          ignore_exchange_rate_revaluation: ignoreExchangeRateRevaluation,
          ignore_system_generated_notes: ignoreSystemGeneratedNotes,
          show_opening_entries: showOpeningEntries
        }),
        credentials: 'include'
      })

      const data = await response.json()

      if (!response.ok || data.error) {
        throw new Error(data.error?.message || 'Invalid admin password')
      }

      if (!data.message || !data.message.success) {
        throw new Error(data.message?.error || 'Failed to verify password')
      }

      // Set the hidden transactions data
      setHiddenTransactionsData({
        companyA: data.message.hidden_transactions_a || [],
        companyB: data.message.hidden_transactions_b || []
      })

      // Close password dialog and open hidden transactions modal
      setShowAdminPasswordDialog(false)
      setShowHiddenTransactionsModal(true)

    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : 'Failed to verify password')
    } finally {
      setIsVerifyingPassword(false)
    }
  }

  // Function to find matching entries between Company A and Company B (on FULL data first)
  const findMatchingEntries = useMemo(() => {
    // Allow processing if at least one company has data (don't require both)
    if (!glDataA.length && !glDataB.length) {
      return { glDataAWithStatus: [], glDataBWithStatus: [] }
    }

    // Create a map to track which entries have been matched to prevent duplicates
    const matchedEntriesB = new Set<string>()
    const matchedEntriesA = new Set<string>()

    // First pass: Process Company A entries and find their matches
    const glDataAWithStatus: GLEntry[] = glDataA.map(entryA => {
      // Find matching entry in Company B based on automatch setting
      // But ensure we don't match with an entry that's already been matched
      const matchingEntry = glDataB.find(entryB => {
        const entryBKey = `${entryB.voucher_type}-${entryB.voucher_no}`

        // Skip if this entry B has already been matched
        if (matchedEntriesB.has(entryBKey)) {
          return false
        }

        // If automatch is disabled, only consider transaction status (no amount/date matching)
        if (!automatchEnabled) {
          return false // Don't auto-match based on amounts/dates
        }

        // Check if dates match (both entries must be on the same date)
        const dateMatch = entryA.posting_date === entryB.posting_date

        // If bypass total calculation is enabled, check net totals instead of individual amounts
        if (bypassTotalCalculation) {
          // Calculate net total for both entries (credit - debit)
          const netTotalA = entryA.credit - entryA.debit
          const netTotalB = entryB.credit - entryB.debit

          // Check if absolute values of net totals match with small tolerance
          const netTotalMatch = Math.abs(Math.abs(netTotalA) - Math.abs(netTotalB)) < 0.01

          return netTotalMatch && dateMatch
        } else {
          // Original logic: Check if amounts match (debit on one side should equal credit on other side)
          const debitCreditMatch = Math.abs(entryA.debit - entryB.credit) < 0.01
          const creditDebitMatch = Math.abs(entryA.credit - entryB.debit) < 0.01

          // Return true only if amounts match AND dates match
          return (debitCreditMatch || creditDebitMatch) && dateMatch
        }
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
      if (backendStatus && backendStatus.status && backendStatus.status !== null && backendStatus.status !== undefined) {
        status = backendStatus.status
      } else {
        // If backend status is null/undefined or doesn't exist, check if there's a frontend match
        // Only show Match if auto-match is enabled AND there's actually a matching entry
        if (automatchEnabled && matchingEntry) {
          status = 'Match'
        } else {
          status = 'Mismatch'
        }
      }

      return {
        ...entryA,
        status,
        matchedEntry: matchingEntry,
        backendMatchData: backendStatus
      }
    })

    // Second pass: Process Company B entries and find their matches
    // console.log("Processing Company B entries...")
    const glDataBWithStatus: GLEntry[] = glDataB.map(entryB => {
      // Find matching entry in Company A based on amount AND date equality
      const matchingEntry = glDataA.find(entryA => {
        const entryAKey = `${entryA.voucher_type}-${entryA.voucher_no}`

        // Skip if this entry A has already been matched
        if (matchedEntriesA.has(entryAKey)) {
          return false
        }

        // Check if dates match (both entries must be on the same date)
        const dateMatch = entryA.posting_date === entryB.posting_date

        // If bypass total calculation is enabled, check net totals instead of individual amounts
        if (bypassTotalCalculation) {
          // Calculate net total for both entries (credit - debit)
          const netTotalA = entryA.credit - entryA.debit
          const netTotalB = entryB.credit - entryB.debit

          // Check if absolute values of net totals match with small tolerance
          const netTotalMatch = Math.abs(Math.abs(netTotalA) - Math.abs(netTotalB)) < 0.01

          return netTotalMatch && dateMatch
        } else {
          // Original logic: Check if amounts match (debit on one side should equal credit on other side)
          const debitCreditMatch = Math.abs(entryA.debit - entryB.credit) < 0.01
          const creditDebitMatch = Math.abs(entryA.credit - entryB.debit) < 0.01

          // Return true only if amounts match AND dates match
          return (debitCreditMatch || creditDebitMatch) && dateMatch
        }
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
      if (backendStatus && backendStatus.status && backendStatus.status !== null && backendStatus.status !== undefined) {
        status = backendStatus.status
      } else {
        // If backend status is null/undefined or doesn't exist, check if there's a frontend match
        // Only show Match if auto-match is enabled AND there's actually a matching entry
        if (automatchEnabled && matchingEntry) {
          status = 'Match'
        } else {
          status = 'Mismatch'
        }
      }

      return {
        ...entryB,
        status: status,
        matchedEntry: matchingEntry,
        backendMatchData: backendStatus
      }
    })

    // Now apply permission filtering to only show visible entries
    // Create sets of visible voucher keys for quick lookup
    const visibleKeysA = new Set(permissionAwareDataA.map(entry => `${entry.voucher_type}-${entry.voucher_no}`))
    const visibleKeysB = new Set(permissionAwareDataB.map(entry => `${entry.voucher_type}-${entry.voucher_no}`))

    // Filter the matched entries to only show visible ones
    const filteredGlDataAWithStatus = glDataAWithStatus.filter(entry => {
      const key = `${entry.voucher_type}-${entry.voucher_no}`
      return visibleKeysA.has(key)
    })

    const filteredGlDataBWithStatus = glDataBWithStatus.filter(entry => {
      const key = `${entry.voucher_type}-${entry.voucher_no}`
      return visibleKeysB.has(key)
    })

    return { glDataAWithStatus: filteredGlDataAWithStatus, glDataBWithStatus: filteredGlDataBWithStatus }
  }, [glDataA, glDataB, permissionAwareDataA, permissionAwareDataB, backendMatchStatus, automatchEnabled, bypassTotalCalculation])

  // Updated reconciliation analysis using reconciliationTotals
  const reconciliationAnalysis = useMemo(() => {
    if (!totalsA || !totalsB) return null

    const totalDebitA = totalsA.totalDebit
    const totalCreditA = totalsA.totalCredit
    const totalDebitB = totalsB.totalDebit
    const totalCreditB = totalsB.totalCredit

    let debitCreditMatch = false
    let creditDebitMatch = false
    let isFullyReconciled = false

    if (bypassTotalCalculation) {
      // Calculate net totals for both companies
      const netTotalA = totalCreditA - totalDebitA
      const netTotalB = totalCreditB - totalDebitB
      const netTotalMatch = Math.abs(netTotalA - netTotalB) < 0.01

      // For bypass mode, we consider it reconciled if net totals match
      debitCreditMatch = netTotalMatch
      creditDebitMatch = netTotalMatch
      isFullyReconciled = netTotalMatch
    } else {
      // Original logic
      debitCreditMatch = Math.abs(totalDebitA - totalCreditB) < 0.01
      creditDebitMatch = Math.abs(totalCreditA - totalDebitB) < 0.01
      isFullyReconciled = debitCreditMatch && creditDebitMatch
    }

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
  }, [totalsA, totalsB, bypassTotalCalculation])

  // Calculate summary statistics for match/mismatch counts
  const summaryStats = useMemo(() => {
    if (!findMatchingEntries.glDataAWithStatus.length && !findMatchingEntries.glDataBWithStatus.length) {
      return null
    }

    // Don't calculate stats until we have backend status data to avoid race conditions
    // This prevents showing incorrect totals on first fetch when backend status is still loading
    if (!hasBackendStatusData && (glDataA.length > 0 || glDataB.length > 0)) {
      return null
    }

    // Count Company A entries by status
    let matchedA = 0
    let mismatchedA = 0
    let pendingA = 0

    findMatchingEntries.glDataAWithStatus.forEach(entry => {
      switch (entry.status) {
        case 'Match':
          matchedA++
          break
        case 'Mismatch':
          mismatchedA++
          break
        case 'Pending':
          pendingA++
          break
      }
    })

    // Count Company B entries by status
    let matchedB = 0
    let mismatchedB = 0
    let pendingB = 0

    findMatchingEntries.glDataBWithStatus.forEach(entry => {
      switch (entry.status) {
        case 'Match':
          matchedB++
          break
        case 'Mismatch':
          mismatchedB++
          break
        case 'Pending':
          pendingB++
          break
      }
    })

    const totalA = findMatchingEntries.glDataAWithStatus.length
    const totalB = findMatchingEntries.glDataBWithStatus.length

    return {
      companyA: {
        total: totalA,
        matched: matchedA,
        mismatched: mismatchedA,
        pending: pendingA
      },
      companyB: {
        total: totalB,
        matched: matchedB,
        mismatched: mismatchedB,
        pending: pendingB
      },
      overall: {
        total: totalA + totalB,
        matched: matchedA + matchedB,
        mismatched: mismatchedA + mismatchedB,
        pending: pendingA + pendingB
      }
    }
  }, [findMatchingEntries, hasBackendStatusData, glDataA, glDataB])

  const formatCurrency = (amount: number, currencyCode: string = 'USD', partyName?: string, partyType?: string) => {
    // Use selected currency if it's not "all", otherwise use party currency or provided currencyCode
    let displayCurrency = currencyCode
    if (currency !== 'all') {
      displayCurrency = currency
    } else if (partyName && partyType) {
      displayCurrency = getPartyCurrency(partyName, partyType)
    }

    // Choose appropriate locale based on currency
    let locale = 'en-US' // Default to US formatting
    if (displayCurrency === 'INR') {
      locale = 'en-IN'
    } else if (displayCurrency === 'EUR') {
      locale = 'en-EU'
    } else if (displayCurrency === 'GBP') {
      locale = 'en-GB'
    }

    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: displayCurrency,
      minimumFractionDigits: 0
    }).format(amount)
  }

  // Get party currencies for display
  const getPartyCurrency = (partyName: string, partyType: string) => {
    if (currency !== 'all') {
      return currency
    }

    if (partyType === 'Customer') {
      const party = displayPartiesA.find(p => p.name === partyName || p.party_name === partyName)
      return party?.default_currency || 'USD'
    } else if (partyType === 'Supplier') {
      // Right side: Supplier from Company B
      const party = displayPartiesB.find(p => p.name === partyName || p.party_name === partyName)
      return party?.default_currency || 'USD'
    }

    return 'USD'
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

  // Get selected entries for bulk modal display (shows all selected, not just matched ones)
  const getSelectedEntriesForDisplay = useMemo(() => {
    const selectedEntriesArray = Array.from(selectedEntries)
    const selectedEntriesList: Array<{ entry: GLEntry; side: 'A' | 'B' }> = []

    for (const entryKey of selectedEntriesArray) {
      // Find the entry in both Company A and Company B data
      const entryA = findMatchingEntries.glDataAWithStatus.find(entry =>
        `${entry.voucher_type}-${entry.voucher_no}` === entryKey
      )
      const entryB = findMatchingEntries.glDataBWithStatus.find(entry =>
        `${entry.voucher_type}-${entry.voucher_no}` === entryKey
      )

      if (entryA) {
        selectedEntriesList.push({ entry: entryA, side: 'A' })
      } else if (entryB) {
        selectedEntriesList.push({ entry: entryB, side: 'B' })
      }
    }

    return selectedEntriesList
  }, [selectedEntries, findMatchingEntries])

  // Check if selected entries are already matched
  const areSelectedEntriesMatched = useMemo(() => {
    if (selectedEntries.size === 0) return false

    const selectedEntriesArray = Array.from(selectedEntries)

    // Check if all selected entries have Match status
    for (const entryKey of selectedEntriesArray) {
      const entryA = findMatchingEntries.glDataAWithStatus.find(entry =>
        `${entry.voucher_type}-${entry.voucher_no}` === entryKey
      )
      const entryB = findMatchingEntries.glDataBWithStatus.find(entry =>
        `${entry.voucher_type}-${entry.voucher_no}` === entryKey
      )

      const entry = entryA || entryB
      if (entry && entry.status !== 'Match') {
        return false
      }
    }

    return true
  }, [selectedEntries, findMatchingEntries])

  // Handle bulk unmatching
  const handleBulkUnmatch = async () => {
    setIsProcessing(true)
    setProcessingCancelled(false)

    try {
      const selectedEntriesArray = Array.from(selectedEntries)

      // OPTIMISTIC UPDATE: Immediately update UI
      const optimisticStatusMap = { ...backendMatchStatus }
      const pairedEntriesSet = new Set<string>()
      
      selectedEntriesArray.forEach(entryKey => {
        optimisticStatusMap[entryKey] = {
          status: 'Mismatch',
          matched_with: null,
          matched_with_parsed: null, // Clear the parsed match data
          matched_by: null,
          matched_on: null
        }
        
        // Find the entry to check for paired transactions
        const entryA = findMatchingEntries.glDataAWithStatus.find(entry =>
          `${entry.voucher_type}-${entry.voucher_no}` === entryKey
        )
        const entryB = findMatchingEntries.glDataBWithStatus.find(entry =>
          `${entry.voucher_type}-${entry.voucher_no}` === entryKey
        )
        
        const entry = entryA || entryB
        if (entry) {
          // Check for backend matched_with data
          if (entry.backendMatchData?.matched_with_parsed) {
            const matchedData = entry.backendMatchData.matched_with_parsed
            // Handle both single match (object) and multiple matches (array)
            const matches = Array.isArray(matchedData) ? matchedData : [matchedData]
            
            matches.forEach((match: any) => {
              if (match && match.voucher_type && match.voucher_no) {
                const pairedKey = `${match.voucher_type}-${match.voucher_no}`
                pairedEntriesSet.add(pairedKey)
              }
            })
          }
          
          // Also check for frontend matchedEntry
          if (entry.matchedEntry) {
            const pairedKey = `${entry.matchedEntry.voucher_type}-${entry.matchedEntry.voucher_no}`
            pairedEntriesSet.add(pairedKey)
          }
        }
      })
      
      // Also update paired entries optimistically
      pairedEntriesSet.forEach(pairedKey => {
        optimisticStatusMap[pairedKey] = {
          status: 'Mismatch',
          matched_with: null,
          matched_with_parsed: null, // Clear the parsed match data
          matched_by: null,
          matched_on: null
        }
      })
      
      setBackendMatchStatus(optimisticStatusMap)
      setHasBackendStatusData(true) // Mark that we have fresh backend data

      // Clear selections and close modal immediately
      setSelectedEntries(new Set())
      setShowMatchModal(false)
      setIsProcessing(false)

      const bulkData = []

      for (const entryKey of selectedEntriesArray) {
        // Check if processing was cancelled
        if (processingCancelled) {
          // console.log("Processing cancelled by user")
          return
        }

        // Find the entry in both Company A and Company B data
        const entryA = findMatchingEntries.glDataAWithStatus.find(entry =>
          `${entry.voucher_type}-${entry.voucher_no}` === entryKey
        )
        const entryB = findMatchingEntries.glDataBWithStatus.find(entry =>
          `${entry.voucher_type}-${entry.voucher_no}` === entryKey
        )

        if (entryA) {
          bulkData.push({
            voucher_type: entryA.voucher_type,
            voucher_no: entryA.voucher_no,
            company: companyA,
            status: 'Mismatch' as const,
            matched_with: null
          })
        }

        if (entryB) {
          bulkData.push({
            voucher_type: entryB.voucher_type,
            voucher_no: entryB.voucher_no,
            company: companyB,
            status: 'Mismatch' as const,
            matched_with: null
          })
        }
      }

      // console.log("Prepared bulk unmatch data:", bulkData)

      // Perform API call in background
      try {
        // Check if processing was cancelled before API call
        if (processingCancelled) {
          // console.log("Processing cancelled before API call")
          return
        }

        // Perform bulk update
        // console.log("Calling bulkUpdateMatchStatus for unmatch...")
        const result = await bulkUpdateMatchStatus(bulkData)
        // console.log("Bulk unmatch result:", result)

        if (result.failed > 0) {
          alert(`Bulk unmatching completed with ${result.success} successful and ${result.failed} failed updates.\n\nErrors:\n${result.errors.join('\n')}`)
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
          // console.log("Processing cancelled before refresh")
          return
        }

        // Refresh match statuses
        // console.log("Refreshing match statuses after unmatch...")
        await refreshMatchStatuses(bulkData.map(entry => ({
          voucher_type: entry.voucher_type,
          voucher_no: entry.voucher_no,
          company: entry.company
        })))

        setSelectedEntries(new Set())
        // console.log("Bulk unmatch process completed successfully")
      } catch (apiError) {
        console.error("API Error in background:", apiError)
        // Revert optimistic update on API error
        const revertedStatusMap = { ...backendMatchStatus }
        selectedEntriesArray.forEach(entryKey => {
          delete revertedStatusMap[entryKey]
        })
        setBackendMatchStatus(revertedStatusMap)
        alert("Failed to update match status. Please try again.")
      }
    } catch (error) {
      // console.error("Bulk unmatch process failed:", error)
      alert(`Bulk unmatch failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsProcessing(false)
      // console.log("Bulk unmatch process failed, processing state reset")
    }
  }

  // Handle bulk matching
  const handleBulkMatch = async () => {
    setIsProcessing(true)
    setProcessingCancelled(false)

    try {
      // First, validate that selected entries can be matched by checking total amounts
      const selectedEntriesArray = Array.from(selectedEntries)
      const selectedEntriesA = selectedEntriesArray.filter(entryKey =>
        findMatchingEntries.glDataAWithStatus.some(entry =>
          `${entry.voucher_type}-${entry.voucher_no}` === entryKey
        )
      )
      const selectedEntriesB = selectedEntriesArray.filter(entryKey =>
        findMatchingEntries.glDataBWithStatus.some(entry =>
          `${entry.voucher_type}-${entry.voucher_no}` === entryKey
        )
      )

      // Calculate totals for selected entries from both sides
      const totalDebitLeft = selectedEntriesA.reduce((sum, entryKey) => {
        const entry = findMatchingEntries.glDataAWithStatus.find(e => `${e.voucher_type}-${e.voucher_no}` === entryKey)
        return sum + (entry?.debit || 0)
      }, 0)

      const totalCreditLeft = selectedEntriesA.reduce((sum, entryKey) => {
        const entry = findMatchingEntries.glDataAWithStatus.find(e => `${e.voucher_type}-${e.voucher_no}` === entryKey)
        return sum + (entry?.credit || 0)
      }, 0)

      const totalDebitRight = selectedEntriesB.reduce((sum, entryKey) => {
        const entry = findMatchingEntries.glDataBWithStatus.find(e => `${e.voucher_type}-${e.voucher_no}` === entryKey)
        return sum + (entry?.debit || 0)
      }, 0)

      const totalCreditRight = selectedEntriesB.reduce((sum, entryKey) => {
        const entry = findMatchingEntries.glDataBWithStatus.find(e => `${e.voucher_type}-${e.voucher_no}` === entryKey)
        return sum + (entry?.credit || 0)
      }, 0)

      // Check if bypass total calculation is enabled
      let validationPassed = false


      if (bypassTotalCalculation) {
        // Calculate net totals for both sides
        const netTotalLeft = totalCreditLeft - totalDebitLeft
        const netTotalRight = totalCreditRight - totalDebitRight

        // For bypass mode, compare absolute values of net totals with small tolerance
        // This ensures we match regardless of which side is positive/negative
        const netTotalMatch = Math.abs(Math.abs(netTotalLeft) - Math.abs(netTotalRight)) < 0.01

        console.log("Validating bulk match with bypass total calculation...", {
          bypassTotalCalculation,
          totalCreditLeft,
          totalDebitLeft,
          totalCreditRight,
          totalDebitRight,
          netTotalLeft,
          netTotalRight,
          absNetTotalLeft: Math.abs(netTotalLeft),
          absNetTotalRight: Math.abs(netTotalRight),
          comparison: `${Math.abs(netTotalLeft)} === ${Math.abs(netTotalRight)}`,
          netTotalMatch,
          validationPassed: netTotalMatch
        })
        validationPassed = netTotalMatch
      } else {
        // Original validation logic
        const debitCreditMatch = Math.abs(totalDebitLeft - totalCreditRight) < 0.01
        const creditDebitMatch = Math.abs(totalCreditLeft - totalDebitRight) < 0.01
        validationPassed = debitCreditMatch && creditDebitMatch
      }


      // Always validate amounts for manual matching (regardless of automatch setting)
      if (!validationPassed) {
        let errorMessage = `Cannot match selected entries because amounts don't balance:\n\n` +
              `${companyA} Total Debit: ${formatCurrency(totalDebitLeft, getPartyCurrency(partyA, 'Customer'), partyA, 'Customer')}\n` +
              `${companyA} Total Credit: ${formatCurrency(totalCreditLeft, getPartyCurrency(partyA, 'Customer'), partyA, 'Customer')}\n` +
              `${companyB} Total Debit: ${formatCurrency(totalDebitRight, getPartyCurrency(partyB, partyTypeB), partyB, partyTypeB)}\n` +
              `${companyB} Total Credit: ${formatCurrency(totalCreditRight, getPartyCurrency(partyB, partyTypeB), partyB, partyTypeB)}\n\n`

        if (bypassTotalCalculation) {
          const netTotalLeft = totalCreditLeft - totalDebitLeft
          const netTotalRight = totalCreditRight - totalDebitRight
          errorMessage += `For matching with bypass total calculation:\n` +
                `- ${companyA} Net Total (${formatCurrency(netTotalLeft, getPartyCurrency(partyA, 'Customer'), partyA, 'Customer')}) should equal ${companyB} Net Total (${formatCurrency(netTotalRight, getPartyCurrency(partyB, partyTypeB), partyB, partyTypeB)})\n` +
                `- Net Total = Credit - Debit`
        } else {
          errorMessage += `For matching, either:\n` +
                `- ${companyA} Debit (${formatCurrency(totalDebitLeft, getPartyCurrency(partyA, 'Customer'), partyA, 'Customer')}) should equal ${companyB} Credit (${formatCurrency(totalCreditRight, getPartyCurrency(partyB, partyTypeB), partyB, partyTypeB)})\n` +
                `- ${companyA} Credit (${formatCurrency(totalCreditLeft, getPartyCurrency(partyA, 'Customer'), partyA, 'Customer')}) should equal ${companyB} Debit (${formatCurrency(totalDebitRight, getPartyCurrency(partyB, partyTypeB), partyB, partyTypeB)})`
        }

        setValidationErrorMessage(errorMessage)
        setShowValidationError(true)
        setIsProcessing(false)
        return
      }

      // OPTIMISTIC UPDATE: Immediately update UI and close modal
      // First, prepare the bulk data to determine proper pairings
      const bulkData = []

      // Separate selected entries by company
      const companyAEntries = []
      const companyBEntries = []

      for (const entryKey of selectedEntries) {
        // Find the entry in both Company A and Company B data
        const entryA = findMatchingEntries.glDataAWithStatus.find(entry =>
          `${entry.voucher_type}-${entry.voucher_no}` === entryKey
        )
        const entryB = findMatchingEntries.glDataBWithStatus.find(entry =>
          `${entry.voucher_type}-${entry.voucher_no}` === entryKey
        )

        if (entryA) {
          companyAEntries.push(entryA)
        }
        if (entryB) {
          companyBEntries.push(entryB)
        }
      }

      // Create pairs: match entries from Company A with entries from Company B
      const maxPairs = Math.max(companyAEntries.length, companyBEntries.length)

      for (let i = 0; i < maxPairs; i++) {
        const entryA = companyAEntries[i]
        const entryB = companyBEntries[i]

        if (entryA) {
          // Find the matched entry for entryA
          let matchedEntry = entryA.matchedEntry

          // If no matchedEntry found by frontend logic, try to find it manually
          if (!matchedEntry && automatchEnabled) {
            // Look for a corresponding entry in Company B with same amount and date
            matchedEntry = findMatchingEntries.glDataBWithStatus.find(entryB => {
              const dateMatch = entryA.posting_date === entryB.posting_date

              if (bypassTotalCalculation) {
                // Calculate net totals for both entries (credit - debit)
                const netTotalA = entryA.credit - entryA.debit
                const netTotalB = entryB.credit - entryB.debit
                const netTotalMatch = Math.abs(netTotalA - netTotalB) < 0.01
                return netTotalMatch && dateMatch
              } else {
                const debitCreditMatch = Math.abs(entryA.debit - entryB.credit) < 0.01
                const creditDebitMatch = Math.abs(entryA.credit - entryB.debit) < 0.01
                return (debitCreditMatch || creditDebitMatch) && dateMatch
              }
            })
          }

          // If still no match found, pair with the corresponding entryB from our selection
          if (!matchedEntry && entryB) {
            matchedEntry = entryB
          }

          bulkData.push({
            voucher_type: entryA.voucher_type,
            voucher_no: entryA.voucher_no,
            company: companyA,
            status: 'Match' as const,
            matched_with: matchedEntry || null
          })
        }

        if (entryB) {
          // Find the matched entry for entryB
          let matchedEntry = entryB.matchedEntry

          // If no matchedEntry found by frontend logic, try to find it manually
          if (!matchedEntry && automatchEnabled) {
            // Look for a corresponding entry in Company A with same amount and date
            matchedEntry = findMatchingEntries.glDataAWithStatus.find(entryA => {
              const dateMatch = entryA.posting_date === entryB.posting_date

              if (bypassTotalCalculation) {
                // Calculate net totals for both entries (credit - debit)
                const netTotalA = entryA.credit - entryA.debit
                const netTotalB = entryB.credit - entryB.debit
                const netTotalMatch = Math.abs(netTotalA - netTotalB) < 0.01
                return netTotalMatch && dateMatch
              } else {
                const debitCreditMatch = Math.abs(entryA.debit - entryB.credit) < 0.01
                const creditDebitMatch = Math.abs(entryA.credit - entryB.debit) < 0.01
                return (debitCreditMatch || creditDebitMatch) && dateMatch
              }
            })
          }

          // If still no match found, pair with the corresponding entryA from our selection
          if (!matchedEntry && entryA) {
            matchedEntry = entryA
          }

          bulkData.push({
            voucher_type: entryB.voucher_type,
            voucher_no: entryB.voucher_no,
            company: companyB,
            status: 'Match' as const,
            matched_with: matchedEntry || null
          })
        }
      }

      // Update backend match status immediately for selected entries with proper pairings
      const optimisticStatusMap = { ...backendMatchStatus }
      bulkData.forEach(entry => {
        const entryKey = `${entry.voucher_type}-${entry.voucher_no}`
        optimisticStatusMap[entryKey] = {
          status: 'Match',
          matched_with: entry.matched_with ? JSON.stringify(entry.matched_with) : null,
          matched_with_parsed: entry.matched_with, // This is what the UI uses to display matches
          matched_by: 'Manual',
          matched_on: new Date().toISOString()
        }
      })
      setBackendMatchStatus(optimisticStatusMap)
      setHasBackendStatusData(true) // Mark that we have fresh backend data

      // Clear selections and close modal immediately
      setSelectedEntries(new Set())
      setShowMatchModal(false)
      setIsProcessing(false)

      // Perform API call in background
      try {

      // Check if processing was cancelled before API call
      if (processingCancelled) {
        // console.log("Processing cancelled before API call")
        return
      }

      // Perform bulk update
      // console.log("Calling bulkUpdateMatchStatus...")
      const result = await bulkUpdateMatchStatus(bulkData)
      // console.log("Bulk update result:", result)

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
        // console.log("Processing cancelled before refresh")
        return
      }


      const allEntries = [...glDataA, ...glDataB].map(entry => ({
        voucher_type: entry.voucher_type,
        voucher_no: entry.voucher_no,
        company: glDataA.includes(entry) ? companyA : companyB
      }))

        const newStatusMap = await refreshMatchStatuses(allEntries)
        setBackendMatchStatus(newStatusMap)
      } catch (apiError) {
        console.error("API Error in background:", apiError)
        // Revert optimistic update on API error
        const revertedStatusMap = { ...backendMatchStatus }
        selectedEntriesArray.forEach(entryKey => {
          delete revertedStatusMap[entryKey]
        })
        setBackendMatchStatus(revertedStatusMap)
        alert("Failed to update match status. Please try again.")
      }

    } catch (error) {
      console.error('Error in bulk matching:', error)
      alert('Failed to perform bulk matching. Please try again.')
      setIsProcessing(false)
      // console.log("Bulk match process failed, processing state reset")
    }
  }
  // Reset processing state when modal opens
  useEffect(() => {
    if (showMatchModal) {
      setIsProcessing(false)
      setProcessingCancelled(false)
      setProcessingSuccess(false)
      setShowBulkMatchDetails(false) // Reset details expansion
      // Clear any existing errors when modal opens
      if (matchError) {
        // console.log("Clearing match error:", matchError)
        clearError()
      }
    }
  }, [showMatchModal, matchError, clearError])

  const handleCancelProcessing = () => {
    setProcessingCancelled(true)
    setIsProcessing(false)
  }

  // Show confirmation dialog for individual match
  const handleShowMatchConfirmation = (entryA: GLEntry, entryB: GLEntry) => {
    setSelectedEntryForAction({ ...entryA, matchedEntry: entryB })
    setShowIndividualMatchModal(true)
  }

  // Handle manual match selection
  const handleManualMatchSelection = (entry: GLEntry) => {
    if (!manualMatchMode) {
      // Start manual match mode
      setManualMatchMode(true)
      setSelectedForManualMatch(entry)
    } else if (selectedForManualMatch) {
      // Second selection - show confirmation
      if (selectedForManualMatch.voucher_type === entry.voucher_type &&
          selectedForManualMatch.voucher_no === entry.voucher_no) {
        // Same entry selected - cancel manual match mode
        setManualMatchMode(false)
        setSelectedForManualMatch(null)
      } else {
        // Different entry selected - show confirmation dialog
        setSelectedEntryForAction({ ...selectedForManualMatch, matchedEntry: entry })
        setShowIndividualMatchModal(true)
        setManualMatchMode(false)
        setSelectedForManualMatch(null)
      }
    }
  }

  // Cancel manual match mode
  const handleCancelManualMatch = () => {
    setManualMatchMode(false)
    setSelectedForManualMatch(null)
  }

  // Execute individual match after confirmation
  const handleConfirmIndividualMatch = async () => {
    if (!selectedEntryForAction || !selectedEntryForAction.matchedEntry) return

    setIsIndividualProcessing(true)
    try {
      const entryA = selectedEntryForAction
      const entryB = selectedEntryForAction.matchedEntry

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

      // OPTIMISTIC UPDATE: Update backend match status immediately
      const statusMap = { ...backendMatchStatus }

      // Update the status map with new data
      const keyA = `${entryA.voucher_type}-${entryA.voucher_no}`
      const keyB = `${entryB.voucher_type}-${entryB.voucher_no}`

      statusMap[keyA] = {
        success: true,
        status: 'Match',
        matched_with: JSON.stringify(entryB),
        matched_with_parsed: entryB, // This is what the UI uses to display matches
        matched_by: 'current_user', // This will be set by backend
        matched_on: new Date().toISOString()
      }

      statusMap[keyB] = {
        success: true,
        status: 'Match',
        matched_with: JSON.stringify(entryA),
        matched_with_parsed: entryA, // This is what the UI uses to display matches
        matched_by: 'current_user', // This will be set by backend
        matched_on: new Date().toISOString()
      }

      setBackendMatchStatus(statusMap)
      setHasBackendStatusData(true) // Mark that we have fresh backend data
      setShowIndividualMatchModal(false)
      setSelectedEntryForAction(null)
    } catch (error) {
      console.error('Error matching entries:', error)
      alert('Failed to match entries. Please try again.')
    } finally {
      setIsIndividualProcessing(false)
    }
  }

  // Show confirmation dialog for individual unmatch
  const handleShowUnmatchConfirmation = (entry: GLEntry) => {
    setSelectedEntryForAction(entry)
    setShowIndividualUnmatchModal(true)
  }

  // Execute individual unmatch after confirmation
  const handleConfirmIndividualUnmatch = async () => {
    if (!selectedEntryForAction) return

    // Check if entry has a match (either frontend matchedEntry or backend matched_with)
    const hasFrontendMatch = selectedEntryForAction.matchedEntry
    const hasBackendMatch = selectedEntryForAction.backendMatchData?.matched_with_parsed

    if (!hasFrontendMatch && !hasBackendMatch) {
      alert('This entry is not matched with any other transaction.')
      return
    }

    setIsIndividualProcessing(true)
    try {
      const entry = selectedEntryForAction
      
      // Determine which company this entry belongs to
      const entryCompany = findMatchingEntries.glDataAWithStatus.some(e => 
        e.voucher_type === entry.voucher_type && e.voucher_no === entry.voucher_no
      ) ? companyA : companyB

      // Update the entry - backend will automatically unmatch the paired transaction
      await updateMatchStatus({
        voucher_type: entry.voucher_type,
        voucher_no: entry.voucher_no,
        company: entryCompany,
        status: 'Mismatch',
        matched_with: null
      })

      // OPTIMISTIC UPDATE: Update backend match status immediately
      const statusMap = { ...backendMatchStatus }

      // Update the status map for the current entry
      const keyA = `${entry.voucher_type}-${entry.voucher_no}`
      statusMap[keyA] = {
        success: true,
        status: 'Mismatch',
        matched_with: null,
        matched_with_parsed: null, // Clear the parsed match data
        matched_by: null,
        matched_on: null
      }

      // Also update the paired entry if we know about it
      let pairedEntry: GLEntry | null = null
      if (hasFrontendMatch && entry.matchedEntry) {
        pairedEntry = entry.matchedEntry
      } else if (hasBackendMatch && selectedEntryForAction.backendMatchData?.matched_with_parsed) {
        const matchedData = selectedEntryForAction.backendMatchData.matched_with_parsed
        // Find the paired entry in our data
        pairedEntry = findMatchingEntries.glDataAWithStatus.find(e =>
          e.voucher_type === matchedData.voucher_type && e.voucher_no === matchedData.voucher_no
        ) || findMatchingEntries.glDataBWithStatus.find(e =>
          e.voucher_type === matchedData.voucher_type && e.voucher_no === matchedData.voucher_no
        ) || null
      }

      if (pairedEntry) {
        const keyB = `${pairedEntry.voucher_type}-${pairedEntry.voucher_no}`
        statusMap[keyB] = {
          success: true,
          status: 'Mismatch',
          matched_with: null,
          matched_with_parsed: null, // Clear the parsed match data
          matched_by: null,
          matched_on: null
        }
      }

      setBackendMatchStatus(statusMap)
      setHasBackendStatusData(true) // Mark that we have fresh backend data
      setShowIndividualUnmatchModal(false)
      setSelectedEntryForAction(null)
    } catch (error) {
      console.error('Error unmatching entries:', error)
      alert('Failed to unmatch entries. Please try again.')
    } finally {
      setIsIndividualProcessing(false)
    }
  }

  // Filter entries by status
  const filterEntriesByStatus = (entries: GLEntry[], isSideA: boolean = true) => {
    let filtered = entries
    
    // Apply status filter
    if (statusFilter !== 'All') {
      filtered = filtered.filter(entry => entry.status === statusFilter)
    }
    
    // Apply debit/credit filter
    if (debitCreditFilter === 'Debit => Credit') {
      if (isSideA) {
        // Left side (Company A): show only entries with debit != 0
        filtered = filtered.filter(entry => entry.debit !== 0)
      } else {
        // Right side (Company B): show only entries with credit != 0
        filtered = filtered.filter(entry => entry.credit !== 0)
      }
    } else if (debitCreditFilter === 'Credit => Debit') {
      if (isSideA) {
        // Left side (Company A): show only entries with credit != 0
        filtered = filtered.filter(entry => entry.credit !== 0)
      } else {
        // Right side (Company B): show only entries with debit != 0
        filtered = filtered.filter(entry => entry.debit !== 0)
      }
    }
    // If debitCreditFilter is 'All', no additional filtering needed
    
    return filtered
  }

  // Determine loading and error states
  const isLoading = glLoadingA || glLoadingB
  const isDataProcessing = !isLoading && (glDataA.length > 0 || glDataB.length > 0) && findMatchingEntries.glDataAWithStatus.length === 0 && findMatchingEntries.glDataBWithStatus.length === 0
  const isBackendStatusLoading = isFetchingBackendStatus
  const isTableLoading = isLoading || isDataProcessing
  const _error = companiesError || allCompaniesError || partiesAError || partiesBError || glErrorA || glErrorB


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
        <div className="flex items-center justify-between">
          <div className="text-center space-y-2 flex-1">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-blue-800 bg-clip-text text-transparent">
              Intercompany General Ledger Reconciliation
            </h1>
            <p className="text-gray-600 text-lg">
              Compare and reconcile General Ledger entries between intercompany transactions
            </p>
          </div>
          <div className="flex space-x-2">
            <Link to="/ledger">
              <Button
                variant="outline"
                className="flex items-center space-x-2"
              >
                <Building2 className="h-4 w-4" />
                <span>Ledger Summary</span>
              </Button>
            </Link>
          </div>
        </div>

        {/* Company Selection */}
        <Card className="border-blue-200 shadow-lg">
          <CardHeader className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg">
            <CardTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5" />
              General Ledger Selection
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 w-full">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Company A Selection */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">

                  <h3 className="text-lg font-semibold text-blue-800 border-b border-blue-200 pb-2">
                     <Checkbox
                     className="mr-2"
                      id="customer-view"
                      checked={customerViewEnabled}
                      onCheckedChange={handleCustomerViewChange}
                    />
                    Company A (Customer View)
                  </h3>

                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">Company</label>
                    <Select
                      value={companyA}
                      onValueChange={handleCompanyAChange}
                      disabled={!customerViewEnabled || allCompaniesLoading || (allCompanies.length === 0 && companies.length === 0)}
                    >
                      <SelectTrigger className="border-blue-200 focus:border-blue-400">
                        <SelectValue placeholder={
                          !customerViewEnabled ? "Enable Customer View to select" :
                          allCompaniesLoading ? "Loading..." :
                          (allCompanies.length === 0 && companies.length === 0) ? "No companies available" :
                          "Select Company"
                        } />
                      </SelectTrigger>
                      <SelectContent className="bg-blue-200">
                        {/* Use conditional companies based on checkbox state */}
                        {displayCompaniesA.map((company) => (
                          <SelectItem key={company.name} value={company.name}>
                            {company.name}
                          </SelectItem>
                        ))}
                        {/* Show autofilled company if it's not in current list */}
                        {companyA && !displayCompaniesA.some(c => c.name === companyA) && (
                          <SelectItem key={companyA} value={companyA}>
                            {companyA}
                          </SelectItem>
                        )}
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
                    <Select
                      value={partyA}
                      onValueChange={setPartyA}
                      disabled={!customerViewEnabled || partiesALoading}
                    >
                      <SelectTrigger className="border-blue-200 focus:border-blue-400">
                        <SelectValue placeholder={
                          !customerViewEnabled ? "Enable Customer View to select" :
                          partiesALoading ? "Loading..." :
                          "Select Party"
                        } />
                      </SelectTrigger>
                      <SelectContent className="bg-blue-200">
                        {/* Use conditional parties based on checkbox state */}
                        {displayPartiesA.map((party) => (
                          <SelectItem key={party.name} value={party.name}>
                            {party.name}
                          </SelectItem>
                        ))}
                        {/* Show autofilled party if it's not in current list */}
                        {partyA && !displayPartiesA.some(p => p.name === partyA) && (
                          <SelectItem key={partyA} value={partyA}>
                            {partyA}
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Company B Selection */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-blue-800 border-b border-blue-200 pb-2">
                    <Checkbox
                      className="mr-2"
                      id="supplier-view"
                      checked={supplierViewEnabled}
                      onCheckedChange={handleSupplierViewChange}
                    />
                    Company B (Supplier View)
                    {isAutoFilled && (
                      <Badge variant="secondary" className="ml-2 bg-green-100 text-green-700">
                        Auto-filled
                      </Badge>
                    )}
                  </h3>

                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">Company</label>
                    <Select
                      value={companyB}
                      onValueChange={handleCompanyBChange}
                      disabled={!supplierViewEnabled || allCompaniesLoading || (allCompanies.length === 0 && companies.length === 0)}
                    >
                      <SelectTrigger className="border-blue-200 focus:border-blue-400">
                        <SelectValue placeholder={
                          !supplierViewEnabled ? "Enable Supplier View to select" :
                          allCompaniesLoading ? "Loading..." :
                          (allCompanies.length === 0 && companies.length === 0) ? "No companies available" :
                          "Select Company"
                        } />
                      </SelectTrigger>
                      <SelectContent className="bg-blue-200">
                        {/* Use conditional companies based on checkbox state */}
                        {displayCompaniesB.map((company) => (
                          <SelectItem key={company.name} value={company.name}>
                            {company.name}
                          </SelectItem>
                        ))}
                        {/* Show autofilled company if it's not in current list */}
                        {companyB && !displayCompaniesB.some(c => c.name === companyB) && (
                          <SelectItem key={companyB} value={companyB}>
                            {companyB}
                          </SelectItem>
                        )}
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
                      disabled={!supplierViewEnabled || partiesBLoading}
                    >
                      <SelectTrigger className="border-blue-200 focus:border-blue-400">
                        <SelectValue placeholder={
                          !supplierViewEnabled ? "Enable Supplier View to select" :
                          partiesBLoading ? "Loading..." :
                          "Select Party"
                        } />
                      </SelectTrigger>
                      <SelectContent className="bg-blue-200">
                        {/* Use conditional parties based on checkbox state */}
                        {displayPartiesB.map((party) => (
                          <SelectItem key={party.name} value={party.name}>
                            {party.name}
                          </SelectItem>
                        ))}
                        {/* Show autofilled party if it's not in current list */}
                        {partyB && !displayPartiesB.some(p => p.name === partyB) && (
                          <SelectItem key={partyB} value={partyB}>
                            {partyB}
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>

            {/* Date Range, Currency and Filters */}
            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4 w-full">
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
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Currency</label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger className="border-blue-200 focus:border-blue-400">
                    <SelectValue placeholder="All Currencies" />
                  </SelectTrigger>
                  <SelectContent className="bg-blue-200">
                    <SelectItem value="all">All Currencies</SelectItem>
                    <SelectItem value="AED">AED (UAE Dirham)</SelectItem>
                    <SelectItem value="CDF">CDF (Congolese Franc)</SelectItem>
                    <SelectItem value="CNY">CNY (Chinese Yuan)</SelectItem>
                    <SelectItem value="DJF">DJF (Djiboutian Franc)</SelectItem>
                    <SelectItem value="ETB">ETB (Ethiopian Birr)</SelectItem>
                    <SelectItem value="EUR">EUR (Euro)</SelectItem>
                    <SelectItem value="GBP">GBP (British Pound)</SelectItem>
                    <SelectItem value="GNF">GNF (Guinean Franc)</SelectItem>
                    <SelectItem value="INR">INR (Indian Rupee)</SelectItem>
                    <SelectItem value="KES">KES (Kenyan Shilling)</SelectItem>
                    <SelectItem value="MZN">MZN (Mozambican Metical)</SelectItem>
                    <SelectItem value="NGN">NGN (Nigerian Naira)</SelectItem>
                    <SelectItem value="SAR">SAR (Saudi Riyal)</SelectItem>
                    <SelectItem value="SDG">SDG (Sudanese Pound)</SelectItem>
                    <SelectItem value="TRY">TRY (Turkish Lira)</SelectItem>
                    <SelectItem value="TZS">TZS (Tanzanian Shilling)</SelectItem>
                    <SelectItem value="USD">USD (US Dollar)</SelectItem>
                    <SelectItem value="XAF">XAF (Central African CFA Franc)</SelectItem>
                    <SelectItem value="XOF">XOF (West African CFA Franc)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Ignore Exchange Rate Revaluation</label>
                <div className="flex items-center space-x-2 p-2 border border-blue-200 rounded-md bg-blue-50">
                  <input
                    type="checkbox"
                    id="ignoreExchangeRateRevaluation"
                    checked={ignoreExchangeRateRevaluation}
                    onChange={(e) => setIgnoreExchangeRateRevaluation(e.target.checked)}
                    className="rounded border-blue-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label htmlFor="ignoreExchangeRateRevaluation" className="text-sm text-gray-700">
                    Enable
                  </label>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Ignore System Generated Notes</label>
                <div className="flex items-center space-x-2 p-2 border border-blue-200 rounded-md bg-blue-50">
                  <input
                    type="checkbox"
                    id="ignoreSystemGeneratedNotes"
                    checked={ignoreSystemGeneratedNotes}
                    onChange={(e) => setIgnoreSystemGeneratedNotes(e.target.checked)}
                    className="rounded border-blue-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label htmlFor="ignoreSystemGeneratedNotes" className="text-sm text-gray-700">
                    Enable
                  </label>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Show Opening Entries</label>
                <div className={`flex items-center space-x-2 p-2 border rounded-md ${hasLoadedData ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-gray-50'}`}>
                  <input
                    type="checkbox"
                    id="showOpeningEntries"
                    checked={showOpeningEntries}
                    onChange={(e) => setShowOpeningEntries(e.target.checked)}
                    disabled={!hasLoadedData}
                    className={`rounded border-blue-300 text-blue-600 focus:ring-blue-500 ${!hasLoadedData ? 'opacity-50 cursor-not-allowed' : ''}`}
                  />
                  <label htmlFor="showOpeningEntries" className={`text-sm ${hasLoadedData ? 'text-gray-700' : 'text-gray-400'}`}>
                    Enable
                  </label>
                </div>
              </div>
            </div>



            {/* {error && (
                <Alert className="mt-4 border-red-200 bg-red-50">
                  <XCircle className="h-4 w-4 text-red-600" />
                  <AlertDescription className="text-red-800">
                    {typeof error === 'string' && error.includes("permission") ?
                      "You don't have permission to access this company's data. Please contact your administrator to request access." :
                      typeof error === 'string' ? error :
                      "An error occurred while loading data. Please try again."
                    }
                  </AlertDescription>
                </Alert>
            )} */}

            {/* Show info when companies are filtered by permissions */}
            {companies.length > 0 && companies.length < 10 && (
              <Alert className="mt-4 border-blue-200 bg-blue-50">
                <AlertTriangle className="h-4 w-4 text-blue-600" />
                <AlertDescription className="text-blue-800">
                  You have access to {companies.length} company{companies.length !== 1 ? 'ies' : ''} based on your user permissions.
                  Contact your administrator if you need access to additional companies.
                </AlertDescription>
              </Alert>
            )}

            {/* Show warning when no companies are available */}
            {companies.length === 0 && !companiesLoading && !companiesError && (
              <Alert className="mt-4 border-orange-200 bg-orange-50">
                <AlertTriangle className="h-4 w-4 text-orange-600" />
                <AlertDescription className="text-orange-800">
                  <strong>No companies available:</strong> You don't have permission to access any companies.
                  Please contact your administrator to set up company permissions for your user account.
                </AlertDescription>
              </Alert>
            )}

            {/* Show restore notification */}
            {showRestoreNotification && (
              <Alert className="mt-4 border-green-200 bg-green-50">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-800">
                  <strong>Data Restored:</strong> Your previous session has been restored.
                  Click "Load General Ledger Data" to refresh the data.
                </AlertDescription>
              </Alert>
            )}

            {/* Auto-Match Toggle */}
            <div className="mt-6 p-4 bg-orange-50 border border-orange-200 rounded-lg">
              <div className="flex items-center justify-center space-x-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    className="mr-2"
                    id="automatch-enabled"
                    checked={automatchEnabled}
                    onCheckedChange={handleAutomatchChange}
                  />
                  <label htmlFor="automatch-enabled" className="text-sm font-medium text-orange-800">
                    Enable Auto-Match
                  </label>
                </div>
                <div className="text-xs text-orange-600">
                  {automatchEnabled
                    ? "Auto-match considers amounts, dates, and transaction status"
                    : "Only transaction status is considered for auto-matching. Manual matching always validates amounts."
                  }
                </div>
              </div>
            </div>

            <div className="flex justify-center mt-6">
              <Button
                onClick={handleLoadData}
                disabled={!customerViewEnabled && !supplierViewEnabled || !companyA || !partyA || !companyB || !partyB || isTableLoading}
                className="bg-blue-600 hover:bg-blue-700 text-white px-8"
              >
                {isTableLoading ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    {isLoading ? "Loading..." : "Processing..."}
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
                            {formatCurrency(reconciliationAnalysis.totalDebitA, getPartyCurrency(partyA, 'Customer'), partyA, 'Customer')}
                          </div>
                          <div className="text-sm text-gray-600">Total Debit ({getPartyCurrency(partyA, 'Customer')})</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-green-600">
                            {formatCurrency(reconciliationAnalysis.totalCreditA, getPartyCurrency(partyA, 'Customer'), partyA, 'Customer')}
                          </div>
                          <div className="text-sm text-gray-600">Total Credit ({getPartyCurrency(partyA, 'Customer')})</div>
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
                          <div className="text-2xl font-bold text-green-600">
                            {formatCurrency(reconciliationAnalysis.totalDebitB, getPartyCurrency(partyB, partyTypeB), partyB, partyTypeB)}
                          </div>
                          <div className="text-sm text-gray-600">Total Debit ({getPartyCurrency(partyB, partyTypeB)})</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-blue-600">
                            {formatCurrency(reconciliationAnalysis.totalCreditB, getPartyCurrency(partyB, partyTypeB), partyB, partyTypeB)}
                          </div>
                          <div className="text-sm text-gray-600">Total Credit ({getPartyCurrency(partyB, partyTypeB)})</div>
                        </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Opening Amounts Display */}
              {showOpeningEntries && (totalsA?.openingDebit !== undefined || totalsB?.openingDebit !== undefined) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                  {/* Company A Opening */}
                  <Card className="border-orange-200">
                    <CardHeader className="bg-orange-50 border-b border-orange-200">
                      <CardTitle className="text-lg text-orange-800">
                        {companyA} Opening Amounts
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="text-center">
                          <div className="text-2xl font-bold text-orange-600">
                            {formatCurrency(totalsA?.openingDebit || 0, getPartyCurrency(partyA, 'Customer'), partyA, 'Customer')}
                          </div>
                          <div className="text-sm text-gray-600">Opening Debit ({getPartyCurrency(partyA, 'Customer')})</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-orange-600">
                            {formatCurrency(totalsA?.openingCredit || 0, getPartyCurrency(partyA, 'Customer'), partyA, 'Customer')}
                          </div>
                          <div className="text-sm text-gray-600">Opening Credit ({getPartyCurrency(partyA, 'Customer')})</div>
                        </div>
                      </div>
                      <div className="mt-4 text-center">
                        <div className="text-lg font-semibold text-orange-700">
                          Opening Balance: {formatCurrency(totalsA?.openingBalance || 0, getPartyCurrency(partyA, 'Customer'), partyA, 'Customer')}
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Company B Opening */}
                  <Card className="border-orange-200">
                    <CardHeader className="bg-orange-50 border-b border-orange-200">
                      <CardTitle className="text-lg text-orange-800">
                        {companyB} Opening Amounts
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="text-center">
                          <div className="text-2xl font-bold text-orange-600">
                            {formatCurrency(totalsB?.openingDebit || 0, getPartyCurrency(partyB, partyTypeB), partyB, partyTypeB)}
                          </div>
                          <div className="text-sm text-gray-600">Opening Debit ({getPartyCurrency(partyB, partyTypeB)})</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-orange-600">
                            {formatCurrency(totalsB?.openingCredit || 0, getPartyCurrency(partyB, partyTypeB), partyB, partyTypeB)}
                          </div>
                          <div className="text-sm text-gray-600">Opening Credit ({getPartyCurrency(partyB, partyTypeB)})</div>
                        </div>
                      </div>
                      <div className="mt-4 text-center">
                        <div className="text-lg font-semibold text-orange-700">
                          Opening Balance: {formatCurrency(totalsB?.openingBalance || 0, getPartyCurrency(partyB, partyTypeB), partyB, partyTypeB)}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

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
                      {bypassTotalCalculation ? (
                        <>
                          <strong>Net Total Match:</strong> Company A Net Total ({formatCurrency(reconciliationAnalysis.totalCreditA - reconciliationAnalysis.totalDebitA, getPartyCurrency(partyA, 'Customer'), partyA, 'Customer')})
                          {reconciliationAnalysis.debitCreditMatch ? " matches " : " does not match "}
                          Company B Net Total ({formatCurrency(reconciliationAnalysis.totalCreditB - reconciliationAnalysis.totalDebitB, getPartyCurrency(partyB, partyTypeB), partyB, partyTypeB)})
                          <br />
                          <span className="text-xs text-gray-600">Net Total = Credit - Debit</span>
                          {!reconciliationAnalysis.debitCreditMatch && (
                            <div className="mt-1">
                              Difference: {formatCurrency(Math.abs((reconciliationAnalysis.totalCreditA - reconciliationAnalysis.totalDebitA) - (reconciliationAnalysis.totalCreditB - reconciliationAnalysis.totalDebitB)), getPartyCurrency(partyA, 'Customer'), partyA, 'Customer')}
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <strong>Debit-Credit Match:</strong> Company A Debit ({formatCurrency(reconciliationAnalysis.totalDebitA, getPartyCurrency(partyA, 'Customer'), partyA, 'Customer')})
                          {reconciliationAnalysis.debitCreditMatch ? " matches " : " does not match "}
                          Company B Credit ({formatCurrency(reconciliationAnalysis.totalCreditB, getPartyCurrency(partyB, partyTypeB), partyB, partyTypeB)})
                          {!reconciliationAnalysis.debitCreditMatch && (
                            <div className="mt-1">
                              Difference: {formatCurrency(Math.abs(reconciliationAnalysis.totalDebitA - reconciliationAnalysis.totalCreditB), getPartyCurrency(partyA, 'Customer'), partyA, 'Customer')}
                            </div>
                          )}
                        </>
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
                      <strong>Credit-Debit Match:</strong> Company A Credit ({formatCurrency(reconciliationAnalysis.totalCreditA, getPartyCurrency(partyA, 'Customer'), partyA, 'Customer')})
                      {reconciliationAnalysis.creditDebitMatch ? " matches " : " does not match "}
                      Company B Debit ({formatCurrency(reconciliationAnalysis.totalDebitB, getPartyCurrency(partyB, partyTypeB), partyB, partyTypeB)})
                      {!reconciliationAnalysis.creditDebitMatch && (
                        <div className="mt-1">
                          Difference: {formatCurrency(Math.abs(reconciliationAnalysis.totalCreditA - reconciliationAnalysis.totalDebitB), getPartyCurrency(partyA, 'Customer'), partyA, 'Customer')}
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
                          <div>{companyA} Balance: {formatCurrency(reconciliationAnalysis.balanceA, getPartyCurrency(partyA, 'Customer'), partyA, 'Customer')}</div>
                          <div>{companyB} Balance: {formatCurrency(reconciliationAnalysis.balanceB, getPartyCurrency(partyB, partyTypeB), partyB, partyTypeB)}</div>
                        </div>
                    </AlertDescription>
                  </div>
                </Alert>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Summary Statistics */}
        {hasLoadedData && summaryStats && (
          <Card className="border-blue-200 shadow-lg">
            <CardHeader className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg">
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Reconciliation Summary Statistics
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Company A Statistics */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-blue-800 flex items-center gap-2">
                    <Building2 className="h-5 w-5" />
                    {companyA} Statistics
                  </h3>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
                      <span className="text-blue-700 font-medium">Total Entries:</span>
                      <span className="text-blue-900 font-bold text-lg">{summaryStats.companyA.total}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                      <span className="text-green-700 font-medium">Matched:</span>
                      <span className="text-green-900 font-bold text-lg">{summaryStats.companyA.matched}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-red-50 rounded-lg">
                      <span className="text-red-700 font-medium">Mismatched:</span>
                      <span className="text-red-900 font-bold text-lg">{summaryStats.companyA.mismatched}</span>
                    </div>
                    {/* <div className="flex justify-between items-center p-3 bg-yellow-50 rounded-lg">
                      <span className="text-yellow-700 font-medium">Pending:</span>
                      <span className="text-yellow-900 font-bold text-lg">{summaryStats.companyA.pending}</span>
                    </div> */}
                  </div>
                </div>

                {/* Company B Statistics */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-blue-800 flex items-center gap-2">
                    <Building2 className="h-5 w-5" />
                    {companyB} Statistics
                  </h3>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
                      <span className="text-blue-700 font-medium">Total Entries:</span>
                      <span className="text-blue-900 font-bold text-lg">{summaryStats.companyB.total}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                      <span className="text-green-700 font-medium">Matched:</span>
                      <span className="text-green-900 font-bold text-lg">{summaryStats.companyB.matched}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-red-50 rounded-lg">
                      <span className="text-red-700 font-medium">Mismatched:</span>
                      <span className="text-red-900 font-bold text-lg">{summaryStats.companyB.mismatched}</span>
                    </div>
                    {/* <div className="flex justify-between items-center p-3 bg-yellow-50 rounded-lg">
                      <span className="text-yellow-700 font-medium">Pending:</span>
                      <span className="text-yellow-900 font-bold text-lg">{summaryStats.companyB.pending}</span>
                    </div> */}
                  </div>
                </div>
              </div>

              {/* Overall Progress */}
              <div className="mt-6 pt-6 border-t border-blue-200">
                <h4 className="text-lg font-semibold text-blue-800 mb-4">Overall Reconciliation Progress</h4>
                {summaryStats ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="text-center p-6 bg-gradient-to-r from-green-50 to-green-100 rounded-lg">
                      <div className="text-3xl font-bold text-green-700">
                        {summaryStats.overall.matched}
                      </div>
                      <div className="text-lg text-green-600 font-medium">Total Matched</div>
                    </div>
                    <div className="text-center p-6 bg-gradient-to-r from-red-50 to-red-100 rounded-lg">
                      <div className="text-3xl font-bold text-red-700">
                        {summaryStats.overall.mismatched}
                      </div>
                      <div className="text-lg text-red-600 font-medium">Total Mismatched</div>
                    </div>
                    {/* <div className="text-center p-6 bg-gradient-to-r from-yellow-50 to-yellow-100 rounded-lg">
                      <div className="text-3xl font-bold text-yellow-700">
                        {summaryStats.overall.pending}
                      </div>
                      <div className="text-lg text-yellow-600 font-medium">Total Pending</div>
                    </div> */}
                  </div>
                ) : (
                  <div className="text-center p-6 bg-gradient-to-r from-gray-50 to-gray-100 rounded-lg">
                    <div className="text-lg text-gray-600 font-medium">
                      {isFetchingBackendStatus ? "Calculating reconciliation totals..." : "Loading reconciliation data..."}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

         {/* Hidden Documents Summary */}
        {(totalHiddenA > 0 || totalHiddenB > 0) && (
          <div className="grid grid-cols-1 gap-6 mb-6">
            {totalHiddenA > 0 && (
              <HiddenDocumentsSummary
                hiddenSummary={hiddenSummaryA}
                totalHiddenEntries={totalHiddenA}
                companyName={(allCompanies.length > 0 ? allCompanies : companies).find((c) => c.name === companyA)?.name || companyA}
                onViewHiddenTransactions={handleViewHiddenTransactions}
              />
            )}
            {totalHiddenB > 0 && (
              <HiddenDocumentsSummary
                hiddenSummary={hiddenSummaryB}
                totalHiddenEntries={totalHiddenB}
                companyName={(allCompanies.length > 0 ? allCompanies : companies).find((c) => c.name === companyB)?.name || companyB}
                onViewHiddenTransactions={handleViewHiddenTransactions}
              />
            )}
          </div>
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
                        {/* <SelectItem value="Pending">? Pending</SelectItem> */}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">Filter by Debit/Credit</label>
                    <Select value={debitCreditFilter} onValueChange={setDebitCreditFilter}>
                      <SelectTrigger className="w-48 border-blue-200 focus:border-blue-400">
                        <SelectValue placeholder="Select Filter" />
                      </SelectTrigger>
                      <SelectContent className="bg-blue-200">
                        <SelectItem value="All">All (Default)</SelectItem>
                        <SelectItem value="Debit => Credit">Debit → Credit</SelectItem>
                        <SelectItem value="Credit => Debit">Credit → Debit</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="text-sm text-gray-600">
                    Showing {filterEntriesByStatus(findMatchingEntries.glDataAWithStatus, true).length} of {findMatchingEntries.glDataAWithStatus.length} entries
                    {isBackendStatusLoading && (
                      <span className="ml-2 inline-flex items-center px-2 py-1 bg-blue-50 border border-blue-200 rounded-full">
                        <RefreshCw className="h-3 w-3 animate-spin text-blue-600 mr-1" />
                        <span className="text-blue-600 text-xs font-medium">Syncing statuses...</span>
                      </span>
                    )}
                    {automatchEnabled && (
                      <span className="ml-2 px-2 py-1 bg-orange-100 text-orange-700 text-xs rounded-full">
                        Auto-Match Enabled
                      </span>
                    )}
                  </div>

                   {/* Bypass Total Calculation Checkbox - Only visible to System Manager or Administrator */}
                  {isSystemManagerOrAdmin() && (
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="bypass-total-calculation"
                          checked={bypassTotalCalculation}
                          onCheckedChange={handleBypassTotalCalculationChange}
                        />
                        <label htmlFor="bypass-total-calculation" className="text-sm text-gray-700">
                          Match Net Amounts
                        </label>
                      </div>
                      {/* <div className="text-xs text-gray-500">
                        {bypassTotalCalculation
                          ? "Match based on net total (credit - debit)"
                          : "Match based on individual debit/credit amounts"
                        }
                      </div> */}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      if (areSelectedEntriesMatched) {
                        handleBulkUnmatch()
                      } else {
                        setShowMatchModal(true)
                      }
                    }}
                    disabled={selectedEntries.size === 0 || isProcessing}
                    variant="outline"
                    className={areSelectedEntriesMatched
                      ? "border-red-200 text-red-700 hover:bg-red-50"
                      : "border-green-200 text-green-700 hover:bg-green-50"
                    }
                  >
                    {isProcessing ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        {areSelectedEntriesMatched ? (
                          <>
                            <XCircle className="h-4 w-4 mr-2" />
                            Unmatch Selected ({selectedEntries.size})
                          </>
                        ) : (
                          <>
                            <CheckCircle className="h-4 w-4 mr-2" />
                            Match Selected ({selectedEntries.size})
                          </>
                        )}
                      </>
                    )}
                  </Button>

                  {/* Clear Selection Button */}
                  {selectedEntries.size > 0 && !isProcessing && (
                    <Button
                      onClick={() => {
                        setSelectedEntries(new Set())
                      }}
                      variant="outline"
                      size="sm"
                      className="border-red-200 text-red-600 hover:bg-red-50 px-2"
                      title="Clear all selections"
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  )}

                  {/* Cancel Manual Match Button */}
                  {manualMatchMode && (
                    <Button
                      onClick={handleCancelManualMatch}
                      variant="outline"
                      size="sm"
                      className="border-orange-200 text-orange-600 hover:bg-orange-50 px-2"
                      title="Cancel manual match mode"
                    >
                      <XCircle className="h-4 w-4 mr-1" />
                      Cancel Manual Match
                    </Button>
                  )}
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
                  {(allCompanies.length > 0 ? allCompanies : companies).find((c) => c.name === companyA)?.name || companyA} - General Ledger
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
                              const entryKeys = filterEntriesByStatus(findMatchingEntries.glDataAWithStatus, true).map(entry => `${entry.voucher_type}-${entry.voucher_no}`)
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
                        {debitCreditFilter !== 'Credit => Debit' && (
                          <TableHead className="text-blue-800 text-right">Debit ({getPartyCurrency(partyA, 'Customer')})</TableHead>
                        )}
                        {debitCreditFilter !== 'Debit => Credit' && (
                          <TableHead className="text-blue-800 text-right">Credit ({getPartyCurrency(partyA, 'Customer')})</TableHead>
                        )}
                        <TableHead className="text-blue-800 text-right">Balance ({getPartyCurrency(partyA, 'Customer')})</TableHead>
                        <TableHead className="text-blue-800 text-center">Status</TableHead>
                        <TableHead className="text-blue-800 text-center">Matched With</TableHead>
                        <TableHead className="text-blue-800 text-center">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isTableLoading ? (
                        <TableRow>
                          <TableCell colSpan={debitCreditFilter === 'All' ? 9 : 8} className="text-center py-8">
                            <div className="flex items-center justify-center space-x-2">
                              <RefreshCw className="h-4 w-4 animate-spin text-blue-600" />
                              <span className="text-gray-600">
                                {isLoading ? "Loading data..." : "Processing and populating tables..."}
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : filterEntriesByStatus(findMatchingEntries.glDataAWithStatus, true).length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={debitCreditFilter === 'All' ? 9 : 8} className="text-center text-gray-500 py-8">
                            No data found for selected criteria
                          </TableCell>
                        </TableRow>
                      ) : (
                        filterEntriesByStatus(findMatchingEntries.glDataAWithStatus, true).map((entry, index) => {
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
                                <div className="text-sm text-gray-600">
                                  <a
                                    href={getVoucherUrl(entry.voucher_type, entry.voucher_no)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                                    onClick={() => handleVoucherClick(entry)}
                                    title={`Click to view ${entry.voucher_type} ${entry.voucher_no} in ERPNext`}
                                  >
                                    {entry.voucher_no}
                                  </a>
                                </div>
                              </div>
                            </TableCell>
                            {debitCreditFilter !== 'Credit => Debit' && (
                              <TableCell className="text-right font-medium text-blue-600">
                                {entry.debit > 0 ? formatCurrency(entry.debit, getPartyCurrency(partyA, 'Customer'), partyA, 'Customer') : "-"}
                              </TableCell>
                            )}
                            {debitCreditFilter !== 'Debit => Credit' && (
                              <TableCell className="text-right font-medium text-green-600">
                                {entry.credit > 0 ? formatCurrency(entry.credit, getPartyCurrency(partyA, 'Customer'), partyA, 'Customer') : "-"}
                              </TableCell>
                            )}
                            <TableCell className="text-right font-medium">
                              {formatCurrency(entry.balance, getPartyCurrency(partyA, 'Customer'), partyA, 'Customer')}
                            </TableCell>
                            <TableCell className="text-center">
                              {getStatusBadge(entry.status || 'Pending')}
                            </TableCell>
                            <TableCell className="text-center">
                              {(() => {
                                // First check if we have backend match data with parsed matched entry
                                if (entry.backendMatchData?.matched_with_parsed) {
                                  const matchedData = entry.backendMatchData.matched_with_parsed
                                  return (
                                    <div className="text-sm">
                                      <div className="font-medium text-blue-600">
                                        <a
                                          href={`/app/${matchedData.voucher_type.toLowerCase().replace(/\s+/g, '-')}/${matchedData.voucher_no}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="hover:underline"
                                        >
                                          {matchedData.voucher_type}
                                        </a>
                                      </div>
                                      <div className="text-gray-600">
                                        <a
                                          href={`/app/${matchedData.voucher_type.toLowerCase().replace(/\s+/g, '-')}/${matchedData.voucher_no}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="hover:underline"
                                        >
                                          {matchedData.voucher_no}
                                        </a>
                                      </div>
                                      <div className="text-xs text-gray-400">
                                        (Manual Match)
                                      </div>
                                    </div>
                                  )
                                }

                                // Only show frontend matched entry if auto-match is enabled
                                if (entry.matchedEntry && automatchEnabled) {
                                  return (
                                    <div className="text-sm">
                                      <div className="font-medium text-blue-600">
                                        <a
                                          href={`/app/${entry.matchedEntry.voucher_type.toLowerCase().replace(/\s+/g, '-')}/${entry.matchedEntry.voucher_no}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="hover:underline"
                                        >
                                          {entry.matchedEntry.voucher_type}
                                        </a>
                                      </div>
                                      <div className="text-gray-600">
                                        <a
                                          href={`/app/${entry.matchedEntry.voucher_type.toLowerCase().replace(/\s+/g, '-')}/${entry.matchedEntry.voucher_no}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="hover:underline"
                                        >
                                          {entry.matchedEntry.voucher_no}
                                        </a>
                                      </div>
                                      <div className="text-xs text-gray-400">
                                        (Automatic Match)
                                      </div>
                                    </div>
                                  )
                                }

                                return <span className="text-gray-400 text-sm">-</span>
                              })()}
                            </TableCell>
                            <TableCell className="text-center">
                              {(() => {
                                // Check if entry has a match (frontend or backend)
                                const hasFrontendMatch = entry.matchedEntry
                                const hasBackendMatch = entry.backendMatchData?.matched_with_parsed
                                const isMatched = entry.status === 'Match' || (hasFrontendMatch || hasBackendMatch)
                                
                                // If matched, show Unmatch button
                                if (isMatched && (hasFrontendMatch || hasBackendMatch)) {
                                  return (
                                    <Button
                                      onClick={() => handleShowUnmatchConfirmation(entry)}
                                      size="sm"
                                      variant="outline"
                                      className="border-red-200 text-red-700 hover:bg-red-50"
                                    >
                                      <XCircle className="h-3 w-3 mr-1" />
                                      Unmatch
                                    </Button>
                                  )
                                }
                                
                                // If status is Mismatch but has a frontend match (auto-detected), show Match to confirm
                                if (entry.status === 'Mismatch' && hasFrontendMatch) {
                                  return (
                                    <Button
                                      onClick={() => handleShowMatchConfirmation(entry, entry.matchedEntry!)}
                                      size="sm"
                                      variant="outline"
                                      className="border-green-200 text-green-700 hover:bg-green-50"
                                    >
                                      <CheckCircle className="h-3 w-3 mr-1" />
                                      Match
                                    </Button>
                                  )
                                }
                                
                                // Otherwise, show Manual Match button
                                return (
                                  <Button
                                    onClick={() => handleManualMatchSelection(entry)}
                                    size="sm"
                                    variant="outline"
                                    className={`${
                                      manualMatchMode && selectedForManualMatch?.voucher_type === entry.voucher_type && selectedForManualMatch?.voucher_no === entry.voucher_no
                                        ? "border-blue-200 text-blue-700 bg-blue-50"
                                        : "border-orange-200 text-orange-700 hover:bg-orange-50"
                                    }`}
                                  >
                                    <CheckCircle className="h-3 w-3 mr-1" />
                                    {manualMatchMode && selectedForManualMatch?.voucher_type === entry.voucher_type && selectedForManualMatch?.voucher_no === entry.voucher_no
                                      ? "Selected"
                                      : "Manual Match"
                                    }
                                  </Button>
                                )
                              })()}
                            </TableCell>
                          </TableRow>
                        )
                      })
                      )}

                      {/* Customer Table Totals Row */}
                      {filterEntriesByStatus(findMatchingEntries.glDataAWithStatus, true).length > 0 && (
                        <TableRow className="bg-beveren-50 border-t-2 border-beveren-300 font-bold">
                          <TableCell colSpan={3} className="text-center font-bold text-beveren-800">
                            TOTAL
                          </TableCell>
                          {debitCreditFilter !== 'Credit => Debit' && (
                            <TableCell className="text-right font-bold text-beveren-700">
                              {formatCurrency(
                                filterEntriesByStatus(findMatchingEntries.glDataAWithStatus, true).reduce((sum, entry) => sum + entry.debit, 0),
                                getPartyCurrency(partyA, 'Customer'),
                                partyA,
                                'Customer'
                              )}
                            </TableCell>
                          )}
                          {debitCreditFilter !== 'Debit => Credit' && (
                            <TableCell className="text-right font-bold text-beveren-700">
                              {formatCurrency(
                                filterEntriesByStatus(findMatchingEntries.glDataAWithStatus, true).reduce((sum, entry) => sum + entry.credit, 0),
                                getPartyCurrency(partyA, 'Customer'),
                                partyA,
                                'Customer'
                              )}
                            </TableCell>
                          )}
                          <TableCell className="text-right font-bold text-beveren-800">
                            {formatCurrency(
                              filterEntriesByStatus(findMatchingEntries.glDataAWithStatus, true).reduce((sum, entry) => sum + entry.balance, 0),
                              getPartyCurrency(partyA, 'Customer'),
                              partyA,
                              'Customer'
                            )}
                          </TableCell>
                          <TableCell colSpan={3}></TableCell>
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
                  {(allCompanies.length > 0 ? allCompanies : companies).find((c) => c.name === companyB)?.name || companyB} - General Ledger
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
                              const entryKeys = filterEntriesByStatus(findMatchingEntries.glDataBWithStatus, false).map(entry => `${entry.voucher_type}-${entry.voucher_no}`)
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
                        {debitCreditFilter !== 'Debit => Credit' && (
                          <TableHead className="text-blue-800 text-right">Debit ({getPartyCurrency(partyB, partyTypeB)})</TableHead>
                        )}
                        {debitCreditFilter !== 'Credit => Debit' && (
                          <TableHead className="text-blue-800 text-right">Credit ({getPartyCurrency(partyB, partyTypeB)})</TableHead>
                        )}
                        <TableHead className="text-blue-800 text-right">Balance ({getPartyCurrency(partyB, partyTypeB)})</TableHead>
                        <TableHead className="text-blue-800 text-center">Status</TableHead>
                        <TableHead className="text-blue-800 text-center">Matched With</TableHead>
                        <TableHead className="text-blue-800 text-center">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isTableLoading ? (
                        <TableRow>
                          <TableCell colSpan={debitCreditFilter === 'All' ? 9 : 8} className="text-center py-8">
                            <div className="flex items-center justify-center space-x-2">
                              <RefreshCw className="h-4 w-4 animate-spin text-blue-600" />
                              <span className="text-gray-600">
                                {isLoading ? "Loading data..." : "Processing and populating tables..."}
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : filterEntriesByStatus(findMatchingEntries.glDataBWithStatus, false).length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={debitCreditFilter === 'All' ? 9 : 8} className="text-center text-gray-500 py-8">
                            No data found for selected criteria
                          </TableCell>
                        </TableRow>
                      ) : (
                        filterEntriesByStatus(findMatchingEntries.glDataBWithStatus, false).map((entry, index) => {
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
                                <div className="text-sm text-gray-600">
                                  <a
                                    href={getVoucherUrl(entry.voucher_type, entry.voucher_no)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                                    onClick={() => handleVoucherClick(entry)}
                                    title={`Click to view ${entry.voucher_type} ${entry.voucher_no} in ERPNext`}
                                  >
                                    {entry.voucher_no}
                                  </a>
                                </div>
                              </div>
                            </TableCell>
                            {debitCreditFilter !== 'Debit => Credit' && (
                              <TableCell className="text-right font-medium text-blue-600">
                                {entry.debit > 0 ? formatCurrency(entry.debit, getPartyCurrency(partyB, partyTypeB), partyB, partyTypeB) : "-"}
                              </TableCell>
                            )}
                            {debitCreditFilter !== 'Credit => Debit' && (
                              <TableCell className="text-right font-medium text-green-600">
                                {entry.credit > 0 ? formatCurrency(entry.credit, getPartyCurrency(partyB, partyTypeB), partyB, partyTypeB) : "-"}
                              </TableCell>
                            )}
                            <TableCell className="text-right font-medium">
                              {formatCurrency(entry.balance, getPartyCurrency(partyB, partyTypeB), partyB, partyTypeB)}
                            </TableCell>
                            <TableCell className="text-center">
                              {getStatusBadge(entry.status || 'Pending')}
                            </TableCell>
                            <TableCell className="text-center">
                              {(() => {
                                // First check if we have backend match data with parsed matched entry
                                if (entry.backendMatchData?.matched_with_parsed) {
                                  const matchedData = entry.backendMatchData.matched_with_parsed
                                  return (
                                    <div className="text-sm">
                                      <div className="font-medium text-blue-600">
                                        <a
                                          href={`/app/${matchedData.voucher_type.toLowerCase().replace(/\s+/g, '-')}/${matchedData.voucher_no}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="hover:underline"
                                        >
                                          {matchedData.voucher_type}
                                        </a>
                                      </div>
                                      <div className="text-gray-600">
                                        <a
                                          href={`/app/${matchedData.voucher_type.toLowerCase().replace(/\s+/g, '-')}/${matchedData.voucher_no}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="hover:underline"
                                        >
                                          {matchedData.voucher_no}
                                        </a>
                                      </div>
                                      <div className="text-xs text-gray-400">
                                        (Manual Match)
                                      </div>
                                    </div>
                                  )
                                }

                                // Only show frontend matched entry if auto-match is enabled
                                if (entry.matchedEntry && automatchEnabled) {
                                  return (
                                    <div className="text-sm">
                                      <div className="font-medium text-blue-600">
                                        <a
                                          href={`/app/${entry.matchedEntry.voucher_type.toLowerCase().replace(/\s+/g, '-')}/${entry.matchedEntry.voucher_no}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="hover:underline"
                                        >
                                          {entry.matchedEntry.voucher_type}
                                        </a>
                                      </div>
                                      <div className="text-gray-600">
                                        <a
                                          href={`/app/${entry.matchedEntry.voucher_type.toLowerCase().replace(/\s+/g, '-')}/${entry.matchedEntry.voucher_no}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="hover:underline"
                                        >
                                          {entry.matchedEntry.voucher_no}
                                        </a>
                                      </div>
                                      <div className="text-xs text-gray-400">
                                        (Automatic Match)
                                      </div>
                                    </div>
                                  )
                                }

                                return <span className="text-gray-400 text-sm">-</span>
                              })()}
                            </TableCell>
                            <TableCell className="text-center">
                              {(() => {
                                // Check if entry has a match (frontend or backend)
                                const hasFrontendMatch = entry.matchedEntry
                                const hasBackendMatch = entry.backendMatchData?.matched_with_parsed
                                const isMatched = entry.status === 'Match' || (hasFrontendMatch || hasBackendMatch)
                                
                                // If matched, show Unmatch button
                                if (isMatched && (hasFrontendMatch || hasBackendMatch)) {
                                  return (
                                    <Button
                                      onClick={() => handleShowUnmatchConfirmation(entry)}
                                      size="sm"
                                      variant="outline"
                                      className="border-red-200 text-red-700 hover:bg-red-50"
                                    >
                                      <XCircle className="h-3 w-3 mr-1" />
                                      Unmatch
                                    </Button>
                                  )
                                }
                                
                                // If status is Mismatch but has a frontend match (auto-detected), show Match to confirm
                                if (entry.status === 'Mismatch' && hasFrontendMatch) {
                                  return (
                                    <Button
                                      onClick={() => handleShowMatchConfirmation(entry, entry.matchedEntry!)}
                                      size="sm"
                                      variant="outline"
                                      className="border-green-200 text-green-700 hover:bg-green-50"
                                    >
                                      <CheckCircle className="h-3 w-3 mr-1" />
                                      Match
                                    </Button>
                                  )
                                }
                                
                                // Otherwise, show Manual Match button
                                return (
                                  <Button
                                    onClick={() => handleManualMatchSelection(entry)}
                                    size="sm"
                                    variant="outline"
                                    className={`${
                                      manualMatchMode && selectedForManualMatch?.voucher_type === entry.voucher_type && selectedForManualMatch?.voucher_no === entry.voucher_no
                                        ? "border-blue-200 text-blue-700 bg-blue-50"
                                        : "border-orange-200 text-orange-700 hover:bg-orange-50"
                                    }`}
                                  >
                                    <CheckCircle className="h-3 w-3 mr-1" />
                                    {manualMatchMode && selectedForManualMatch?.voucher_type === entry.voucher_type && selectedForManualMatch?.voucher_no === entry.voucher_no
                                      ? "Selected"
                                      : "Manual Match"
                                    }
                                  </Button>
                                )
                              })()}
                            </TableCell>
                          </TableRow>
                        )
                      })
                      )}

                      {/* Supplier Table Totals Row */}
                      {filterEntriesByStatus(findMatchingEntries.glDataBWithStatus, false).length > 0 && (
                        <TableRow className="bg-beveren-50 border-t-2 border-beveren-300 font-bold">
                          <TableCell colSpan={3} className="text-center font-bold text-beveren-800">
                            TOTAL
                          </TableCell>
                          {debitCreditFilter !== 'Debit => Credit' && (
                            <TableCell className="text-right font-bold text-beveren-700">
                              {formatCurrency(
                                filterEntriesByStatus(findMatchingEntries.glDataBWithStatus, false).reduce((sum, entry) => sum + entry.debit, 0),
                                getPartyCurrency(partyB, partyTypeB),
                                partyB,
                                partyTypeB
                              )}
                            </TableCell>
                          )}
                          {debitCreditFilter !== 'Credit => Debit' && (
                            <TableCell className="text-right font-bold text-beveren-700">
                              {formatCurrency(
                                filterEntriesByStatus(findMatchingEntries.glDataBWithStatus, false).reduce((sum, entry) => sum + entry.credit, 0),
                                getPartyCurrency(partyB, partyTypeB),
                                partyB,
                                partyTypeB
                              )}
                            </TableCell>
                          )}
                          <TableCell className="text-right font-bold text-beveren-800">
                            {formatCurrency(
                              filterEntriesByStatus(findMatchingEntries.glDataBWithStatus, false).reduce((sum, entry) => sum + entry.balance, 0),
                              getPartyCurrency(partyB, partyTypeB),
                              partyB,
                              partyTypeB
                            )}
                          </TableCell>
                          <TableCell colSpan={3}></TableCell>
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
            <div className="bg-white rounded-lg p-6 max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg font-semibold mb-4">
                {processingSuccess ? "Success!" : isProcessing ? `Processing Bulk ${areSelectedEntriesMatched ? 'Unmatching' : 'Matching'}` : `Confirm Bulk ${areSelectedEntriesMatched ? 'Unmatching' : 'Matching'}`}
              </h3>
              <p className="text-gray-600 mb-4">
                {processingSuccess
                  ? `Successfully ${areSelectedEntriesMatched ? 'unmatched' : 'matched'} ${selectedEntries.size} entries! Modal will close automatically.`
                  : isProcessing
                    ? `Processing ${selectedEntries.size} selected entries... This may take a moment.`
                    : `Are you sure you want to ${areSelectedEntriesMatched ? 'unmatch' : 'match'} ${selectedEntries.size} selected entries? This action will update the status in the backend.`
                }
              </p>

              {/* Expandable Transaction Details */}
              {!processingSuccess && !isProcessing && selectedEntries.size > 0 && (
                <div className="mb-4">
                  <button
                    onClick={() => setShowBulkMatchDetails(!showBulkMatchDetails)}
                    className="flex items-center gap-2 text-blue-600 hover:text-blue-800 text-sm font-medium"
                  >
                    {showBulkMatchDetails ? (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                        Hide Transaction Details
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        Show Transaction Details ({getSelectedEntriesForDisplay.length} selected)
                      </>
                    )}
                  </button>

                  {showBulkMatchDetails && (
                    <div className="mt-3 bg-gray-50 rounded-lg p-4 max-h-60 overflow-y-auto">
                      <div className="space-y-3">
                        {getSelectedEntriesForDisplay.map((item, index) => (
                          <div key={index} className="bg-white p-3 rounded border">
                            <div className="flex items-center">
                              <div className="flex-1">
                                <div className="font-medium text-blue-600">
                                  {item.entry.voucher_type} {item.entry.voucher_no}
                                </div>
                                <div className="text-sm text-gray-600">
                                  {item.side === 'A' ? companyA : companyB} - {item.entry.posting_date}
                                </div>
                                <div className="text-sm font-medium">
                                  {item.entry.debit > 0 ?
                                    `Debit: ${formatCurrency(item.entry.debit,
                                      item.side === 'A' ? getPartyCurrency(partyA, 'Customer') : getPartyCurrency(partyB, partyTypeB),
                                      item.side === 'A' ? partyA : partyB,
                                      item.side === 'A' ? 'Customer' : partyTypeB
                                    )}` :
                                    `Credit: ${formatCurrency(item.entry.credit,
                                      item.side === 'A' ? getPartyCurrency(partyA, 'Customer') : getPartyCurrency(partyB, partyTypeB),
                                      item.side === 'A' ? partyA : partyB,
                                      item.side === 'A' ? 'Customer' : partyTypeB
                                    )}`
                                  }
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                  Status: {item.entry.status || 'Pending'}
                                </div>
                              </div>
                              <div className="ml-4">
                                <div className={`px-2 py-1 rounded text-xs font-medium ${
                                  item.side === 'A'
                                    ? 'bg-blue-100 text-blue-700'
                                    : 'bg-green-100 text-green-700'
                                }`}>
                                  {item.side === 'A' ? 'Company A' : 'Company B'}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                        {getSelectedEntriesForDisplay.length === 0 && (
                          <div className="text-center text-gray-500 py-4">
                            No entries selected
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
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
                        // console.log("Modal cancelled, closing modal")
                        setShowMatchModal(false)
                      }}
                      variant="outline"
                      disabled={isProcessing}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={() => {
                        // console.log(`Confirm button clicked, starting bulk ${areSelectedEntriesMatched ? 'unmatch' : 'match'} process`)
                        if (areSelectedEntriesMatched) {
                          handleBulkUnmatch()
                        } else {
                          handleBulkMatch()
                        }
                      }}
                      className={areSelectedEntriesMatched
                        ? "bg-red-600 hover:bg-red-700"
                        : "bg-green-600 hover:bg-green-700"
                      }
                      disabled={isProcessing}
                    >
                      {isProcessing ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        `Confirm ${areSelectedEntriesMatched ? 'Unmatch' : 'Match'} (${selectedEntries.size})`
                      )}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>


      {/* Validation Error Modal */}
      {showValidationError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <Card className="max-w-2xl mx-4 bg-white">
            <CardHeader className="bg-red-50 border-b border-red-200">
              <CardTitle className="text-red-600 flex items-center gap-2">
                <XCircle className="h-5 w-5" />
                Cannot Match Selected Entries
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="text-gray-700 whitespace-pre-line text-sm leading-relaxed">
                {validationErrorMessage}
              </div>
            </CardContent>
            <div className="flex justify-end p-6 pt-0">
              <Button
                onClick={() => setShowValidationError(false)}
                className="bg-red-600 hover:bg-red-700"
              >
                I Understand
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Individual Match Confirmation Modal */}
      {showIndividualMatchModal && selectedEntryForAction && selectedEntryForAction.matchedEntry && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4">
            <h3 className="text-lg font-semibold mb-4 text-green-700">
              Confirm Match
            </h3>
            <div className="mb-4">
              <p className="text-gray-700 mb-3">
                Are you sure you want to match these transactions?
              </p>
              <div className="bg-gray-50 p-4 rounded-lg space-y-2">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-medium text-blue-600">
                      {selectedEntryForAction.voucher_type} {selectedEntryForAction.voucher_no}
                    </div>
                    <div className="text-sm text-gray-600">
                      {companyA} - {selectedEntryForAction.posting_date}
                    </div>
                    <div className="text-sm font-medium">
                      {selectedEntryForAction.debit > 0 ?
                        `Debit: ${formatCurrency(selectedEntryForAction.debit, getPartyCurrency(partyA, 'Customer'), partyA, 'Customer')}` :
                        `Credit: ${formatCurrency(selectedEntryForAction.credit, getPartyCurrency(partyA, 'Customer'), partyA, 'Customer')}`
                      }
                    </div>
                  </div>
                  <div className="text-2xl text-gray-400">↔</div>
                  <div>
                    <div className="font-medium text-blue-600">
                      {selectedEntryForAction.matchedEntry.voucher_type} {selectedEntryForAction.matchedEntry.voucher_no}
                    </div>
                    <div className="text-sm text-gray-600">
                      {companyB} - {selectedEntryForAction.matchedEntry.posting_date}
                    </div>
                    <div className="text-sm font-medium">
                      {selectedEntryForAction.matchedEntry.debit > 0 ?
                        `Debit: ${formatCurrency(selectedEntryForAction.matchedEntry.debit, getPartyCurrency(partyB, partyTypeB), partyB, partyTypeB)}` :
                        `Credit: ${formatCurrency(selectedEntryForAction.matchedEntry.credit, getPartyCurrency(partyB, partyTypeB), partyB, partyTypeB)}`
                      }
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <Button
                onClick={() => {
                  setShowIndividualMatchModal(false)
                  setSelectedEntryForAction(null)
                }}
                variant="outline"
                disabled={isIndividualProcessing}
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmIndividualMatch}
                className="bg-green-600 hover:bg-green-700"
                disabled={isIndividualProcessing}
              >
                {isIndividualProcessing ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Matching...
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Confirm Match
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Individual Unmatch Confirmation Modal */}
      {showIndividualUnmatchModal && selectedEntryForAction && (selectedEntryForAction.matchedEntry || selectedEntryForAction.backendMatchData?.matched_with_parsed) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4">
            <h3 className="text-lg font-semibold mb-4 text-red-700">
              Confirm Unmatch
            </h3>
            <div className="mb-4">
              <p className="text-gray-700 mb-3">
                Are you sure you want to unmatch these transactions?
              </p>
              <div className="bg-gray-50 p-4 rounded-lg space-y-2">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-medium text-blue-600">
                      {selectedEntryForAction.voucher_type} {selectedEntryForAction.voucher_no}
                    </div>
                    <div className="text-sm text-gray-600">
                      {companyA} - {selectedEntryForAction.posting_date}
                    </div>
                    <div className="text-sm font-medium">
                      {selectedEntryForAction.debit > 0 ?
                        `Debit: ${formatCurrency(selectedEntryForAction.debit, getPartyCurrency(partyA, 'Customer'), partyA, 'Customer')}` :
                        `Credit: ${formatCurrency(selectedEntryForAction.credit, getPartyCurrency(partyA, 'Customer'), partyA, 'Customer')}`
                      }
                    </div>
                  </div>
                  <div className="text-2xl text-gray-400">↔</div>
                  <div>
                    {(() => {
                      // Get matched entry data - either from frontend or backend
                      let matchedData: any = null
                      if (selectedEntryForAction.matchedEntry) {
                        matchedData = selectedEntryForAction.matchedEntry
                      } else if (selectedEntryForAction.backendMatchData?.matched_with_parsed) {
                        matchedData = selectedEntryForAction.backendMatchData.matched_with_parsed
                        // Handle array case (take first match)
                        if (Array.isArray(matchedData)) {
                          matchedData = matchedData[0]
                        }
                      }
                      
                      if (!matchedData) return <div className="text-gray-500">Match data</div>
                      
                      const matchedEntry = findMatchingEntries.glDataAWithStatus.find(e =>
                        e.voucher_type === matchedData.voucher_type && e.voucher_no === matchedData.voucher_no
                      ) || findMatchingEntries.glDataBWithStatus.find(e =>
                        e.voucher_type === matchedData.voucher_type && e.voucher_no === matchedData.voucher_no
                      )
                      
                      const matchedCompany = findMatchingEntries.glDataAWithStatus.some(e => 
                        e.voucher_type === matchedData.voucher_type && e.voucher_no === matchedData.voucher_no
                      ) ? companyA : companyB
                      
                      return (
                        <>
                          <div className="font-medium text-blue-600">
                            {matchedData.voucher_type} {matchedData.voucher_no}
                          </div>
                          <div className="text-sm text-gray-600">
                            {matchedCompany} - {matchedEntry?.posting_date || 'N/A'}
                          </div>
                          <div className="text-sm font-medium">
                            {matchedEntry ? (
                              matchedEntry.debit > 0 ?
                                `Debit: ${formatCurrency(matchedEntry.debit, 
                                  matchedCompany === companyA ? getPartyCurrency(partyA, 'Customer') : getPartyCurrency(partyB, partyTypeB),
                                  matchedCompany === companyA ? partyA : partyB,
                                  matchedCompany === companyA ? 'Customer' : partyTypeB
                                )}` :
                                `Credit: ${formatCurrency(matchedEntry.credit,
                                  matchedCompany === companyA ? getPartyCurrency(partyA, 'Customer') : getPartyCurrency(partyB, partyTypeB),
                                  matchedCompany === companyA ? partyA : partyB,
                                  matchedCompany === companyA ? 'Customer' : partyTypeB
                                )}`
                            ) : 'N/A'}
                          </div>
                        </>
                      )
                    })()}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <Button
                onClick={() => {
                  setShowIndividualUnmatchModal(false)
                  setSelectedEntryForAction(null)
                }}
                variant="outline"
                disabled={isIndividualProcessing}
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmIndividualUnmatch}
                className="bg-red-600 hover:bg-red-700"
                disabled={isIndividualProcessing}
              >
                {isIndividualProcessing ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Unmatching...
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 mr-2" />
                    Confirm Unmatch
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Password Dialog */}
      <AdminPasswordDialog
        open={showAdminPasswordDialog}
        onOpenChange={setShowAdminPasswordDialog}
        onPasswordVerified={handlePasswordVerification}
        isLoading={isVerifyingPassword}
        error={passwordError}
      />

      {/* Hidden Transactions Modal */}
      <HiddenTransactionsModal
        open={showHiddenTransactionsModal}
        onOpenChange={setShowHiddenTransactionsModal}
        companyA={companyA}
        companyB={companyB}
        hiddenDataA={hiddenTransactionsData.companyA}
        hiddenDataB={hiddenTransactionsData.companyB}
        isLoading={isVerifyingPassword}
        error={passwordError}
        currency={currency}
        partyA={partyA}
        partyB={partyB}
        partyTypeB={partyTypeB}
      />
    </div>
  )
}


