"use client"

import  { useState, useMemo, useEffect } from "react"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Combobox } from "./ui/combobox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table"
import { Alert, AlertDescription } from "../../components/ui/alert"
import { RefreshCw, BarChart3, Users, Building2 } from "lucide-react"
import IntercompanyTopNav, {
  PageHeader,
  FilterField,
  CheckOption,
  compactInputClass,
} from "./intercompany-top-nav"
import { useCompanies } from "../hook/useCompanies"
import { usePermissionAwareCompanies } from "../hook/usePermissionAwareCompanies"
import { useAllCompaniesForUI } from "../hook/useAllCompaniesForUI"

import { useLedgerSummary } from "../hook/useLedgerSummary"
import { useGLClosingAmounts } from "../hook/useGLClosingAmounts"
import { useIntransitInvoiceTotals } from "../hook/useIntransitInvoiceTotals"

// Types
interface LedgerSummaryEntry {
  party: string
  party_name: string
  company: string
  opening_balance: number
  invoiced_amount: number
  paid_amount: number
  debit: number
  credit: number
  closing_balance: number
  currency: string
}

interface LedgerSummaryData {
  entries: LedgerSummaryEntry[]
  totals: {
    totalOpeningBalance: number
    totalInvoicedAmount: number
    totalPaidAmount: number
    totalDebit: number
    totalCredit: number
    totalClosingBalance: number
  }
}

export default function InterCompanyLedgerSummary() {

  // State management
  const [company, setCompany] = useState<string>("")
  const [fromDate, setFromDate] = useState<string>(`${new Date().getFullYear()}-01-01`)
  const [toDate, setToDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [currency, setCurrency] = useState<string>("all")
  const [showIntercompanyOnly, setShowIntercompanyOnly] = useState<boolean>(true)
  const [hasLoadedData, setHasLoadedData] = useState<boolean>(false)
  const [inPartyCurrency, setInPartyCurrency] = useState<boolean>(true)
  const [ignoreSystemGeneratedNotes, setIgnoreSystemGeneratedNotes] = useState<boolean>(true)
  const [ignoreExchangeRateRevaluation, setIgnoreExchangeRateRevaluation] = useState<boolean>(true)
  const [statusFilter, setStatusFilter] = useState<string>("All")
  const [allowOffsetMatch, setAllowOffsetMatch] = useState<boolean>(false)
  const [showInTransitColumns, setShowInTransitColumns] = useState<boolean>(true)

  // Data state
  const [error, setError] = useState<string>("")

  // Fetch Inter Company Reconciliation Settings (allow_offset_match) on mount
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await fetch('/api/method/nextlayer.next_layer.api.ledger_summary.get_intercompany_reconciliation_settings')
        const result = await response.json()
        if (result?.message?.allow_offset_match !== undefined) {
          setAllowOffsetMatch(Boolean(result.message.allow_offset_match))
        }
      } catch {
        setAllowOffsetMatch(false)
      }
    }
    fetchSettings()
  }, [])

  // Use the custom hooks
  const { companies, isLoading: companiesLoading, error: companiesError } = useCompanies()
  const { companies: permissionAwareCompanies, isLoading: permissionCompaniesLoading } = usePermissionAwareCompanies()
  const { companies: allCompanies, isLoading: allCompaniesLoading, error: allCompaniesError } = useAllCompaniesForUI()

  // Company filter: same as Intercompany Ledger Reconciliation — only show companies the user has permission to
  const displayCompaniesForFilter = permissionAwareCompanies

  // Clear selected company if it is not in the permitted list (e.g. after permission change or restored state)
  useEffect(() => {
    if (company && displayCompaniesForFilter.length > 0 && !displayCompaniesForFilter.some((c) => c.name === company)) {
      setCompany("")
    }
  }, [company, displayCompaniesForFilter])

  // Use ledger summary hooks - only fetch when hasLoadedData is true
  const { data: customerLedgerData, isLoading: isLoadingCustomer, error: errorCustomer } = useLedgerSummary({
    company: company,
    partyType: "Customer",
    fromDate,
    toDate,
    currency,
    showIntercompanyOnly,
    inPartyCurrency,
    ignoreSystemGeneratedNotes,
    ignoreExchangeRateRevaluation,
    enabled: hasLoadedData
  })

  const { data: supplierLedgerData, isLoading: isLoadingSupplier, error: errorSupplier } = useLedgerSummary({
    company: company,
    partyType: "Supplier",
    fromDate,
    toDate,
    currency,
    showIntercompanyOnly,
    inPartyCurrency,
    ignoreSystemGeneratedNotes,
    ignoreExchangeRateRevaluation,
    enabled: hasLoadedData
  })

  // Extract party names for GL closing amounts
  const customerParties = customerLedgerData?.entries?.map(entry => entry.party) || []
  const supplierParties = supplierLedgerData?.entries?.map(entry => entry.party) || []

  // Get GL closing amounts for customers (use Supplier as party type)
  const { glClosingAmounts: customerGLClosing, isLoading: isLoadingCustomerGL } = useGLClosingAmounts({
    company: company,
    partyType: "Supplier",
    fromDate,
    toDate,
    currency: "all", // Always use company currency for GL closing
    parties: customerParties,
    enabled: hasLoadedData && customerParties.length > 0
  })

  // Get GL closing amounts for suppliers (use Customer as party type)
  const { glClosingAmounts: supplierGLClosing, isLoading: isLoadingSupplierGL } = useGLClosingAmounts({
    company: company,
    partyType: "Customer",
    fromDate,
    toDate,
    currency: "all", // Always use company currency for GL closing
    parties: supplierParties,
    enabled: hasLoadedData && supplierParties.length > 0
  })

  // Calculate difference between ledger closing and GL closing
  const calculateDifference = (ledgerClosing: number, glClosing: number) => {
    // Handle negative values by taking absolute values for comparison
    // This ensures we compare the magnitude, not the sign
    const absLedgerClosing = Math.abs(ledgerClosing)
    const absGlClosing = Math.abs(glClosing)

    // Return the difference in absolute terms
    return absLedgerClosing - absGlClosing
  }

  // Get unmatched parties for in-transit check (only for unmatched entries)
  const unmatchedCustomerParties = useMemo(() => {
    if (!customerLedgerData || !customerGLClosing) return []
    return customerLedgerData.entries
      .filter(entry => {
        const glClosing = customerGLClosing[entry.party] || 0
        const isPartyGLLoaded = customerGLClosing.hasOwnProperty(entry.party)
        if (!isPartyGLLoaded) return false
        const difference = calculateDifference(entry.closing_balance, glClosing)
        const tolerance = 0.01
        return Math.abs(difference) >= tolerance // Unmatched
      })
      .map(entry => entry.party)
  }, [customerLedgerData, customerGLClosing])

  const unmatchedSupplierParties = useMemo(() => {
    if (!supplierLedgerData || !supplierGLClosing) return []
    return supplierLedgerData.entries
      .filter(entry => {
        const glClosing = supplierGLClosing[entry.party] || 0
        const isPartyGLLoaded = supplierGLClosing.hasOwnProperty(entry.party)
        if (!isPartyGLLoaded) return false
        const difference = calculateDifference(entry.closing_balance, glClosing)
        const tolerance = 0.01
        return Math.abs(difference) >= tolerance // Unmatched
      })
      .map(entry => entry.party)
  }, [supplierLedgerData, supplierGLClosing])

  // Get in-transit invoice totals for unmatched customers (check Purchase Invoices)
  // The party (customer company) is the company on the invoice, the top company is the supplier
  const { intransitTotals: customerIntransitTotals, isLoading: isLoadingCustomerIntransit } = useIntransitInvoiceTotals({
    company: company,
    partyType: "Customer",
    fromDate,
    toDate,
    parties: unmatchedCustomerParties,
    enabled: hasLoadedData && unmatchedCustomerParties.length > 0
  })

  // Get in-transit invoice totals for unmatched suppliers (check Sales Invoices)
  // The party (supplier company) is the company on the invoice, the top company is the customer
  const { intransitTotals: supplierIntransitTotals, isLoading: isLoadingSupplierIntransit } = useIntransitInvoiceTotals({
    company: company,
    partyType: "Supplier",
    fromDate,
    toDate,
    parties: unmatchedSupplierParties,
    enabled: hasLoadedData && unmatchedSupplierParties.length > 0
  })

  // Additional in-transit columns for the row-level summary tables
  const { intransitTotals: customerIntransitSalesTotals } = useIntransitInvoiceTotals({
    company: company,
    partyType: "Customer",
    invoiceType: "Sales Invoice",
    fromDate,
    toDate,
    parties: customerParties,
    enabled: hasLoadedData && customerParties.length > 0
  })

  const { intransitTotals: supplierIntransitPurchaseTotals } = useIntransitInvoiceTotals({
    company: company,
    partyType: "Supplier",
    invoiceType: "Purchase Invoice",
    fromDate,
    toDate,
    parties: supplierParties,
    enabled: hasLoadedData && supplierParties.length > 0
  })

  const isLoading = isLoadingCustomer || isLoadingSupplier || isLoadingCustomerGL || isLoadingSupplierGL || isLoadingCustomerIntransit || isLoadingSupplierIntransit

  // Handle load data
  const handleLoadData = () => {
    console.log("handleLoadData called", { company })
    if (!company) {
      setError("Please select a company")
      return
    }
    setError("")
    setHasLoadedData(true)
    console.log("setHasLoadedData(true) called")
  }



  // Format currency
  const formatCurrency = (amount: number, currencyCode: string = 'USD', companyName?: string) => {
    // Use selected currency if it's not "all", otherwise use company currency or provided currencyCode
    let displayCurrency = currencyCode
    if (currency !== 'all') {
      displayCurrency = currency
    } else if (inPartyCurrency) {
      // When inPartyCurrency is enabled, use the currency from the data (party currency)
      displayCurrency = currencyCode
    } else if (companyName) {
      displayCurrency = getCompanyCurrency(companyName)
    }

    // Choose appropriate locale based on currency
    let locale = 'en-US' // Default to US formatting
    if (displayCurrency === 'INR') {
      locale = 'en-IN'
    } else if (displayCurrency === 'EUR') {
      locale = 'en-DE' // Use German locale for EUR
    } else if (displayCurrency === 'GBP') {
      locale = 'en-GB'
    } else if (displayCurrency === 'AED') {
      locale = 'en-AE'
    } else if (displayCurrency === 'CDF') {
      locale = 'en-CD'
    } else if (displayCurrency === 'CNY') {
      locale = 'zh-CN'
    }

    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: displayCurrency,
      minimumFractionDigits: 0
    }).format(amount)
  }

  // Get company currency for display
  const getCompanyCurrency = (companyName: string) => {
    if (currency !== 'all') {
      return currency
    }

    const company = (allCompanies.length > 0 ? allCompanies : companies).find(c => c.name === companyName)
    return company?.default_currency || 'USD'
  }

  // Get status based on difference, loading state, and in-transit totals
  const getStatus = (difference: number, glClosing: number, isLoading: boolean, party: string, intransitTotal?: number, showInTransitColumns?: boolean, specificIntransitTotal?: number, isCustomerTable?: boolean) => {
    // If GL data is still loading for this specific party, show pending
    if (isLoading) {
      return { text: "Pending", color: "text-yellow-600 dark:text-yellow-400", bgColor: "bg-yellow-50 dark:bg-yellow-950/40" }
    }

    const tolerance = 0.01 // Small tolerance for floating point comparison
    const absDifference = Math.abs(difference)


    if (intransitTotal !== undefined && intransitTotal !== null) {
      const absIntransitTotal = Math.abs(intransitTotal)

      if (Math.abs(absDifference - absIntransitTotal) < tolerance) {
        return { text: "Match with In-Transit", color: "text-blue-600 dark:text-blue-400", bgColor: "bg-blue-50 dark:bg-blue-950/40", isOffsetMatch: false }
      }
    }


    if (absDifference < tolerance) {
      return { text: "Match", color: "text-green-600 dark:text-green-400", bgColor: "bg-green-50 dark:bg-green-950/40" }
    }

    // Allow offset match (Inter Company Reconciliation Settings): when unmatched, check if
    // |party_balance| + |gl_closing| ≈ in_transit_total (e.g. Pacific case: opposite signs, in-transit explains the sum)
    if (allowOffsetMatch && intransitTotal !== undefined && intransitTotal !== null) {
      const absIntransitTotal = Math.abs(intransitTotal)
      // difference = |party_balance| - |gl_closing|, so |party_balance| + |gl_closing| = difference + 2*|gl_closing|
      const offsetSum = difference + 2 * Math.abs(glClosing)
      if (Math.abs(offsetSum - absIntransitTotal) <= tolerance) {
        return { text: "Match with In-Transit", color: "text-blue-600 dark:text-blue-400", bgColor: "bg-blue-50 dark:bg-blue-950/40", isOffsetMatch: true }
      }
    }

    // New logic: Check for specific in-transit matches when checkbox is enabled and row is unmatched
    if (showInTransitColumns && specificIntransitTotal !== undefined && specificIntransitTotal !== null) {
      const absSpecificIntransitTotal = Math.abs(specificIntransitTotal)
      if (Math.abs(absDifference - absSpecificIntransitTotal) <= tolerance) {
        const statusText = isCustomerTable ? "Match with In-Transit SI" : "Match with In-Transit PI"
        return { text: statusText, color: "text-blue-500", bgColor: "bg-orange-50 dark:bg-orange-950/40" }
      }
    }

    return { text: "Unmatched", color: "text-red-600 dark:text-red-400", bgColor: "bg-red-50 dark:bg-red-950/40" }
  }

  // Filter entries by status
  const filterEntriesByStatus = (entries: LedgerSummaryEntry[], glClosingAmounts: Record<string, number>, intransitTotals?: Record<string, number>) => {
    if (statusFilter === 'All') return entries
    return entries.filter(entry => {
      const glClosing = glClosingAmounts[entry.party] || 0
      const isPartyGLLoaded = glClosingAmounts.hasOwnProperty(entry.party)
      const difference = calculateDifference(entry.closing_balance, glClosing)
      const intransitTotal = intransitTotals?.[entry.party]
      const status = getStatus(difference, glClosing, !isPartyGLLoaded, entry.party, intransitTotal)
      // Handle "Match with In-Transit" status in filter
      if (statusFilter === 'Match') {
        return status.text === 'Match' || status.text === 'Match with In-Transit'
      }
      return status.text === statusFilter
    })
  }

  // Calculate reconciliation analysis
  const reconciliationAnalysis = useMemo(() => {
    if (!customerLedgerData || !supplierLedgerData) return null

    const customerTotals = customerLedgerData.totals
    const supplierTotals = supplierLedgerData.totals

    // Check if closing balances match (for intercompany reconciliation)
    const closingBalanceMatch = Math.abs(customerTotals.totalClosingBalance - supplierTotals.totalClosingBalance) < 0.01

    return {
      closingBalanceMatch,
      difference: Math.abs(customerTotals.totalClosingBalance - supplierTotals.totalClosingBalance),
      customerTotals,
      supplierTotals
    }
  }, [customerLedgerData, supplierLedgerData])

  // Calculate summary statistics
  const summaryStats = useMemo(() => {
    if (!customerLedgerData || !supplierLedgerData) return null

    // Customer statistics
    const totalCustomers = customerLedgerData.entries.length
    let matchedCustomers = 0
    let unmatchedCustomers = 0
    let matchWithIntransitCustomers = 0

    customerLedgerData.entries.forEach(entry => {
      const glClosing = customerGLClosing[entry.party] || 0
      const isPartyGLLoaded = customerGLClosing.hasOwnProperty(entry.party)

      if (isPartyGLLoaded) {
        const difference = calculateDifference(entry.closing_balance, glClosing)
        const intransitTotal = customerIntransitTotals[entry.party]
        const status = getStatus(difference, glClosing, !isPartyGLLoaded, entry.party, intransitTotal)

        if (status.text === 'Match') {
          matchedCustomers++
        } else if (status.text === 'Match with In-Transit') {
          matchWithIntransitCustomers++
        } else {
          unmatchedCustomers++
        }
      }
    })

    // Supplier statistics
    const totalSuppliers = supplierLedgerData.entries.length
    let matchedSuppliers = 0
    let unmatchedSuppliers = 0
    let matchWithIntransitSuppliers = 0

    supplierLedgerData.entries.forEach(entry => {
      const glClosing = supplierGLClosing[entry.party] || 0
      const isPartyGLLoaded = supplierGLClosing.hasOwnProperty(entry.party)

      if (isPartyGLLoaded) {
        const difference = calculateDifference(entry.closing_balance, glClosing)
        const intransitTotal = supplierIntransitTotals[entry.party]
        const status = getStatus(difference, glClosing, !isPartyGLLoaded, entry.party, intransitTotal)

        if (status.text === 'Match') {
          matchedSuppliers++
        } else if (status.text === 'Match with In-Transit') {
          matchWithIntransitSuppliers++
        } else {
          unmatchedSuppliers++
        }
      }
    })

    return {
      customers: {
        total: totalCustomers,
        matched: matchedCustomers,
        unmatched: unmatchedCustomers,
        matchWithIntransit: matchWithIntransitCustomers,
        pending: totalCustomers - matchedCustomers - unmatchedCustomers - matchWithIntransitCustomers
      },
      suppliers: {
        total: totalSuppliers,
        matched: matchedSuppliers,
        unmatched: unmatchedSuppliers,
        matchWithIntransit: matchWithIntransitSuppliers,
        pending: totalSuppliers - matchedSuppliers - unmatchedSuppliers - matchWithIntransitSuppliers
      },
      overall: {
        matched: matchedCustomers + matchedSuppliers,
        unmatched: unmatchedCustomers + unmatchedSuppliers,
        matchWithIntransit: matchWithIntransitCustomers + matchWithIntransitSuppliers
      }
    }
  }, [customerLedgerData, supplierLedgerData, customerGLClosing, supplierGLClosing, customerIntransitTotals, supplierIntransitTotals])

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <IntercompanyTopNav />
      <div className="mx-auto max-w-screen-2xl space-y-4 px-4 py-4">
        {/* Header */}
        <PageHeader
          title="Intercompany Ledger Summary"
          subtitle="View customer and supplier ledger summaries for intercompany transactions"
        />

        {/* Company Selection */}
        <Card className="rounded-xl border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <CardContent className="p-4">
            {/* All Filters in Single Row */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <FilterField label="Company">
                <Combobox
                  options={displayCompaniesForFilter.map((companyItem) => ({
                    name: ("company_name" in companyItem ? companyItem.company_name : companyItem.name) ?? companyItem.name,
                    value: companyItem.name,
                  }))}
                  value={company}
                  onValueChange={setCompany}
                  placeholder={
                    permissionCompaniesLoading ? "Loading..." :
                    displayCompaniesForFilter.length === 0 ? "No companies available" :
                    "Select Company"
                  }
                  disabled={permissionCompaniesLoading || displayCompaniesForFilter.length === 0}
                  searchPlaceholder="Search companies..."
                  emptyMessage="No companies found."
                  className="h-8 border-slate-200 bg-white px-2.5 text-[13px] font-normal text-slate-900 shadow-sm hover:bg-white dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                />
              </FilterField>
              <FilterField label="From Date">
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className={compactInputClass}
                />
              </FilterField>
              <FilterField label="To Date">
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className={compactInputClass}
                />
              </FilterField>
              <FilterField label="Currency">
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger className="h-8 border-slate-200 bg-white px-2.5 text-[13px] font-normal text-slate-900 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" disabled>
                    <SelectValue placeholder="All Currencies" />
                  </SelectTrigger>
                  <SelectContent className="dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
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
              </FilterField>
            </div>

            {/* Filter Options + Action */}
            <div className="mt-3 flex flex-col gap-3 border-t border-slate-100 pt-3 dark:border-slate-700 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <CheckOption
                  id="showIntercompanyOnly"
                  label="Show Intercompany Only"
                  checked={showIntercompanyOnly}
                  onChange={(e) => setShowIntercompanyOnly(e.target.checked)}
                />
                <CheckOption
                  id="inPartyCurrency"
                  label="In Party Currency"
                  checked={inPartyCurrency}
                  onChange={(e) => setInPartyCurrency(e.target.checked)}
                />
                <CheckOption
                  id="ignoreSystemGeneratedNotes"
                  label="Ignore System Generated Notes"
                  checked={ignoreSystemGeneratedNotes}
                  onChange={(e) => setIgnoreSystemGeneratedNotes(e.target.checked)}
                />
                <CheckOption
                  id="ignoreExchangeRateRevaluation"
                  label="Ignore Exchange Rate Revaluation"
                  checked={ignoreExchangeRateRevaluation}
                  onChange={(e) => setIgnoreExchangeRateRevaluation(e.target.checked)}
                />
              </div>
              <Button
                onClick={() => {
                  handleLoadData()
                }}
                disabled={!company || isLoading}
                size="sm"
                className="h-8 shrink-0 rounded-md bg-blue-600 px-3.5 text-[13px] font-medium text-white hover:bg-blue-700"
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Loading...
                  </>
                ) : (
                  "Load Summary Data"
                )}
              </Button>
            </div>

          </CardContent>
        </Card>

        {/* Error Display */}
        {error && (
          <Alert className="rounded-xl border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
            <AlertDescription className="text-red-800 dark:text-red-300">{error}</AlertDescription>
          </Alert>
        )}

        {/* Empty State */}
        {!hasLoadedData && !isLoading && !error && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center dark:border-slate-600 dark:bg-slate-800">
            <p className="text-[13px] font-medium text-slate-700 dark:text-slate-200">
              No ledger data loaded yet
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Select a company and date range above, then press Load Summary Data.
            </p>
          </div>
        )}

      

        {/* Totals Summary */}
        {hasLoadedData && customerLedgerData && supplierLedgerData && (
          <Card className="rounded-xl border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <CardHeader className="border-b border-slate-100 px-4 py-3 dark:border-slate-700">
              <CardTitle className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                <Building2 className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                Totals Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Customer Summary */}
                <div className="space-y-3">
                  <h3 className="text-[13px] font-semibold text-slate-800 border-b border-slate-200 pb-1.5 dark:border-slate-700 dark:text-slate-100">
                    Customer Summary
                  </h3>
                  <div className="grid grid-cols-1 gap-3">
                    <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg dark:bg-slate-700/60">
                      <span className="font-medium text-slate-600 dark:text-slate-300">Total Party Balance:</span>
                      <span className="font-bold text-slate-900 dark:text-slate-100">
                        {formatCurrency(customerLedgerData.totals.totalClosingBalance, customerLedgerData.entries[0]?.currency || 'USD', company)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg dark:bg-slate-700/60">
                      <span className="font-medium text-slate-600 dark:text-slate-300">GL Closing:</span>
                      <span className="font-bold text-slate-900 dark:text-slate-100">
                        {formatCurrency(Object.values(customerGLClosing).reduce((sum, amount) => sum + amount, 0), customerLedgerData.entries[0]?.currency || 'USD', company)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-orange-50 rounded-lg border border-orange-200 dark:border-orange-900 dark:bg-orange-950/40">
                      <span className="font-medium text-orange-700 dark:text-orange-300">Difference:</span>
                      <span className="font-bold text-orange-800 dark:text-orange-200">
                        {formatCurrency(Math.abs(customerLedgerData.totals.totalClosingBalance - Object.values(customerGLClosing).reduce((sum, amount) => sum + amount, 0)), customerLedgerData.entries[0]?.currency || 'USD', company)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Supplier Summary */}
                <div className="space-y-3">
                  <h3 className="text-[13px] font-semibold text-slate-800 border-b border-slate-200 pb-1.5 dark:border-slate-700 dark:text-slate-100">
                    Supplier Summary
                  </h3>
                  <div className="grid grid-cols-1 gap-3">
                    <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg dark:bg-slate-700/60">
                      <span className="font-medium text-slate-600 dark:text-slate-300">Total Party Balance:</span>
                      <span className="font-bold text-slate-900 dark:text-slate-100">
                        {formatCurrency(supplierLedgerData.totals.totalClosingBalance, supplierLedgerData.entries[0]?.currency || 'USD', company)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg dark:bg-slate-700/60">
                      <span className="font-medium text-slate-600 dark:text-slate-300">GL Closing:</span>
                      <span className="font-bold text-slate-900 dark:text-slate-100">
                        {formatCurrency(Object.values(supplierGLClosing).reduce((sum, amount) => sum + amount, 0), supplierLedgerData.entries[0]?.currency || 'USD', company)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-orange-50 rounded-lg border border-orange-200 dark:border-orange-900 dark:bg-orange-950/40">
                      <span className="font-medium text-orange-700 dark:text-orange-300">Difference:</span>
                      <span className="font-bold text-orange-800 dark:text-orange-200">
                        {formatCurrency(Math.abs(supplierLedgerData.totals.totalClosingBalance - Object.values(supplierGLClosing).reduce((sum, amount) => sum + amount, 0)), supplierLedgerData.entries[0]?.currency || 'USD', company)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Summary Statistics */}
        {hasLoadedData && summaryStats && (
          <Card className="rounded-xl border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <CardHeader className="border-b border-slate-100 px-4 py-3 dark:border-slate-700">
              <CardTitle className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                <BarChart3 className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                Reconciliation Summary Statistics
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Customer Statistics */}
                <div className="space-y-3">
                  <h3 className="text-[13px] font-semibold text-slate-800 flex items-center gap-2 dark:text-slate-100">
                    <Users className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                    Customer Statistics
                  </h3>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg dark:bg-blue-950/40">
                      <span className="font-medium text-blue-700 dark:text-blue-300">Total Customers:</span>
                      <span className="text-lg font-bold text-blue-900 dark:text-blue-100">{summaryStats.customers.total}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg dark:bg-green-950/40">
                      <span className="font-medium text-green-700 dark:text-green-300">Matched:</span>
                      <span className="text-lg font-bold text-green-900 dark:text-green-100">{summaryStats.customers.matched}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-red-50 rounded-lg dark:bg-red-950/40">
                      <span className="font-medium text-red-700 dark:text-red-300">Unmatched:</span>
                      <span className="text-lg font-bold text-red-900 dark:text-red-100">{summaryStats.customers.unmatched}</span>
                    </div>

                  </div>
                </div>

                {/* Supplier Statistics */}
                <div className="space-y-3">
                  <h3 className="text-[13px] font-semibold text-slate-800 flex items-center gap-2 dark:text-slate-100">
                    <Building2 className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                    Supplier Statistics
                  </h3>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg dark:bg-blue-950/40">
                      <span className="font-medium text-blue-700 dark:text-blue-300">Total Suppliers:</span>
                      <span className="text-lg font-bold text-blue-900 dark:text-blue-100">{summaryStats.suppliers.total}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg dark:bg-green-950/40">
                      <span className="font-medium text-green-700 dark:text-green-300">Matched:</span>
                      <span className="text-lg font-bold text-green-900 dark:text-green-100">{summaryStats.suppliers.matched}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-red-50 rounded-lg dark:bg-red-950/40">
                      <span className="font-medium text-red-700 dark:text-red-300">Unmatched:</span>
                      <span className="text-lg font-bold text-red-900 dark:text-red-100">{summaryStats.suppliers.unmatched}</span>
                    </div>

                  </div>
                </div>
              </div>

              {/* Overall Progress */}
              <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
                <h4 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">Overall Reconciliation Progress</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="rounded-lg bg-green-50 p-4 text-center dark:bg-green-950/40">
                    <div className="text-2xl font-bold text-green-700 dark:text-green-300">
                      {summaryStats.overall.matched}
                    </div>
                    <div className="text-[11px] font-medium uppercase tracking-wide text-green-600 dark:text-green-400">Total Matched</div>
                  </div>
                  <div className="rounded-lg bg-red-50 p-4 text-center dark:bg-red-950/40">
                    <div className="text-2xl font-bold text-red-700 dark:text-red-300">
                      {summaryStats.overall.unmatched}
                    </div>
                    <div className="text-[11px] font-medium uppercase tracking-wide text-red-600 dark:text-red-400">Total Unmatched</div>
                  </div>
                  <div className="rounded-lg bg-blue-50 p-4 text-center dark:bg-blue-950/40">
                    <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">
                      {summaryStats.overall.matchWithIntransit}
                    </div>
                    <div className="text-[11px] font-medium uppercase tracking-wide text-blue-600 dark:text-blue-400">Match with Intransit</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Status Filter */}
        {hasLoadedData && customerLedgerData && supplierLedgerData && (
          <Card className="rounded-xl border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
                  <FilterField label="Filter by Status" className="w-48">
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="h-8 border-slate-200 bg-white px-2.5 text-[13px] font-normal text-slate-900 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                        <SelectValue placeholder="Select Status" />
                      </SelectTrigger>
                      <SelectContent className="dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                        <SelectItem value="All">All Entries</SelectItem>
                        <SelectItem value="Match">✓ Matched</SelectItem>
                        <SelectItem value="Match with In-Transit">✓ Match with Intransit</SelectItem>
                        <SelectItem value="Match with In-Transit SI">✓ Match with In-Transit SI</SelectItem>
                        <SelectItem value="Match with In-Transit PI">✓ Match with In-Transit PI</SelectItem>
                        <SelectItem value="Unmatched">✗ Unmatched</SelectItem>
                      </SelectContent>
                    </Select>
                  </FilterField>
                  <div className="pb-1.5">
                    <CheckOption
                      id="showInTransitColumns"
                      label="Display In-Transit SI & PI"
                      checked={showInTransitColumns}
                      onChange={(e) => setShowInTransitColumns(e.target.checked)}
                    />
                  </div>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Showing {filterEntriesByStatus(customerLedgerData.entries, customerGLClosing, customerIntransitTotals).length} of {customerLedgerData.entries.length} customers, {filterEntriesByStatus(supplierLedgerData.entries, supplierGLClosing, supplierIntransitTotals).length} of {supplierLedgerData.entries.length} suppliers
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Data Display */}
        {hasLoadedData && customerLedgerData && supplierLedgerData && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Customer Ledger Summary */}
            <Card className="rounded-xl border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <CardHeader className="border-b border-slate-100 px-4 py-3 dark:border-slate-700">
                <CardTitle className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
                  {(allCompanies.length > 0 ? allCompanies : companies).find((c) => c.name === company)?.name || company} - Customer Ledger Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50 dark:bg-slate-700/60">
                        <TableHead className="text-slate-600 dark:text-slate-300">Party</TableHead>
                        <TableHead className="text-slate-600 text-right dark:text-slate-300">Party Balance</TableHead>
                        <TableHead className="text-slate-600 text-right dark:text-slate-300">GL Closing</TableHead>
                        <TableHead className="text-slate-600 text-right dark:text-slate-300">Difference</TableHead>
                        <TableHead className="text-slate-500 text-right dark:text-slate-400">In-Transit Total</TableHead>
                        <TableHead className="text-slate-600 text-right dark:text-slate-300">Status</TableHead>
                        {showInTransitColumns && (
                          <TableHead className="text-slate-600 text-right dark:text-slate-300">In-Transit SI</TableHead>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filterEntriesByStatus(customerLedgerData.entries, customerGLClosing, customerIntransitTotals).map((entry, index) => {
                        const glClosing = customerGLClosing[entry.party] || 0
                        const difference = calculateDifference(entry.closing_balance, glClosing)
                        const isPartyGLLoaded = customerGLClosing.hasOwnProperty(entry.party)
                        const intransitTotal = customerIntransitTotals[entry.party]
                        const intransitSalesTotal = customerIntransitSalesTotals[entry.party]
                        const status = getStatus(difference, glClosing, !isPartyGLLoaded, entry.party, intransitTotal, showInTransitColumns, intransitSalesTotal, true)

                        // Show "-" for matched entries, show value for unmatched
                        const showIntransitTotal = status.text === 'Match' ? '-' :
                          (intransitTotal !== undefined ? formatCurrency(intransitTotal, entry.currency, company) : '-')

                        // Only when allow offset is ticked AND this row matched via offset rule: show in-transit in Difference column
                        const showDifference = status.text === 'Match with In-Transit' && status.isOffsetMatch === true && intransitTotal != null
                          ? intransitTotal
                          : difference

                        return (
                          <TableRow key={index} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                            <TableCell className="font-medium">{entry.party_name}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(entry.closing_balance, entry.currency, company)}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(glClosing, entry.currency, company)}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(showDifference, entry.currency, company)}</TableCell>
                            <TableCell className="text-right font-normal text-slate-500 dark:text-slate-400">{showIntransitTotal}</TableCell>
                            <TableCell className="text-right">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${status.bgColor} ${status.color}`}>
                                {status.text}
                              </span>
                            </TableCell>
                            {showInTransitColumns && (
                              <TableCell className="text-right font-medium">
                                {intransitSalesTotal !== undefined ? formatCurrency(intransitSalesTotal, entry.currency, company) : '-'}
                              </TableCell>
                            )}
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>


              </CardContent>
            </Card>

            {/* Supplier Ledger Summary */}
            <Card className="rounded-xl border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <CardHeader className="border-b border-slate-100 px-4 py-3 dark:border-slate-700">
                <CardTitle className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
                  {(allCompanies.length > 0 ? allCompanies : companies).find((c) => c.name === company)?.name || company} - Supplier Ledger Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50 dark:bg-slate-700/60">
                        <TableHead className="text-slate-600 dark:text-slate-300">Party</TableHead>
                        <TableHead className="text-slate-600 text-right dark:text-slate-300">Party Balance</TableHead>
                        <TableHead className="text-slate-600 text-right dark:text-slate-300">GL Closing</TableHead>
                        <TableHead className="text-slate-600 text-right dark:text-slate-300">Difference</TableHead>
                        <TableHead className="text-slate-500 text-right dark:text-slate-400">In-Transit Total</TableHead>
                        <TableHead className="text-slate-600 text-right dark:text-slate-300">Status</TableHead>
                        {showInTransitColumns && (
                          <TableHead className="text-slate-600 text-right dark:text-slate-300">In-Transit PI</TableHead>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filterEntriesByStatus(supplierLedgerData.entries, supplierGLClosing, supplierIntransitTotals).map((entry, index) => {
                        const glClosing = supplierGLClosing[entry.party] || 0
                        const difference = calculateDifference(entry.closing_balance, glClosing)
                        const isPartyGLLoaded = supplierGLClosing.hasOwnProperty(entry.party)
                        const intransitTotal = supplierIntransitTotals[entry.party]
                        const intransitPurchaseTotal = supplierIntransitPurchaseTotals[entry.party]
                        const status = getStatus(difference, glClosing, !isPartyGLLoaded, entry.party, intransitTotal, showInTransitColumns, intransitPurchaseTotal, false)

                        // Show "-" for matched entries, show value for unmatched
                        const showIntransitTotal = status.text === 'Match' ? '-' :
                          (intransitTotal !== undefined ? formatCurrency(intransitTotal, entry.currency, company) : '-')

                        // Only when allow offset is ticked AND this row matched via offset rule: show in-transit in Difference column
                        const showDifference = status.text === 'Match with In-Transit' && status.isOffsetMatch === true && intransitTotal != null
                          ? intransitTotal
                          : difference

                        return (
                          <TableRow key={index} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                            <TableCell className="font-medium">{entry.party_name}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(entry.closing_balance, entry.currency, company)}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(glClosing, entry.currency, company)}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(showDifference, entry.currency, company)}</TableCell>
                            <TableCell className="text-right font-normal text-slate-500 dark:text-slate-400">{showIntransitTotal}</TableCell>
                            <TableCell className="text-right">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${status.bgColor} ${status.color}`}>
                                {status.text}
                              </span>
                            </TableCell>
                            {showInTransitColumns && (
                              <TableCell className="text-right font-medium">
                                {intransitPurchaseTotal !== undefined ? formatCurrency(intransitPurchaseTotal, entry.currency, company) : '-'}
                              </TableCell>
                            )}
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>


              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
