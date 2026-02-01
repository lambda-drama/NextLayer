"use client"

import  { useState, useMemo, useEffect } from "react"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Combobox } from "./ui/combobox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table"
import { Alert, AlertDescription } from "../../components/ui/alert"
import { ArrowLeftRight, RefreshCw, ArrowLeft, CheckCircle, XCircle, BarChart3, Users, Building2 } from "lucide-react"
import { Link } from "react-router-dom"
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
  const { companies: permissionAwareCompanies } = usePermissionAwareCompanies()
  const { companies: allCompanies, isLoading: allCompaniesLoading, error: allCompaniesError } = useAllCompaniesForUI()
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
  const getStatus = (difference: number, glClosing: number, isLoading: boolean, party: string, intransitTotal?: number) => {
    // If GL data is still loading for this specific party, show pending
    if (isLoading) {
      return { text: "Pending", color: "text-yellow-600", bgColor: "bg-yellow-50" }
    }

    // If GL data is loaded for this party, check for match/unmatched
    // Note: glClosing can be 0 legitimately, so we don't check for zero here
    const tolerance = 0.01 // Small tolerance for floating point comparison
    const absDifference = Math.abs(difference)

    // First check if difference matches in-transit total (this takes priority over exact match)
    // This ensures that when intransit explains the difference, it's "Match with Intransit" not "Match"
    // Even if difference is zero, if intransit total exists and matches, it should be "Match with Intransit"
    if (intransitTotal !== undefined && intransitTotal !== null) {
      const absIntransitTotal = Math.abs(intransitTotal)
      // Check if the difference equals the intransit total (within tolerance)
      // This takes priority so entries with intransit match are not counted as regular "Match"
      if (Math.abs(absDifference - absIntransitTotal) < tolerance) {
        return { text: "Match with In-Transit", color: "text-blue-600", bgColor: "bg-blue-50", isOffsetMatch: false }
      }
    }

    // Then check for exact match (difference is zero or very close to zero)
    // This only applies when there's no intransit match
    if (absDifference < tolerance) {
      return { text: "Match", color: "text-green-600", bgColor: "bg-green-50" }
    }

    // Allow offset match (Inter Company Reconciliation Settings): when unmatched, check if
    // |party_balance| + |gl_closing| ≈ in_transit_total (e.g. Pacific case: opposite signs, in-transit explains the sum)
    if (allowOffsetMatch && intransitTotal !== undefined && intransitTotal !== null) {
      const absIntransitTotal = Math.abs(intransitTotal)
      // difference = |party_balance| - |gl_closing|, so |party_balance| + |gl_closing| = difference + 2*|gl_closing|
      const offsetSum = difference + 2 * Math.abs(glClosing)
      if (Math.abs(offsetSum - absIntransitTotal) <= tolerance) {
        return { text: "Match with In-Transit", color: "text-blue-600", bgColor: "bg-blue-50", isOffsetMatch: true }
      }
    }

    // Otherwise it's unmatched
    return { text: "Unmatched", color: "text-red-600", bgColor: "bg-red-50" }
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50 p-4">
      <div className="max-w-8xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="text-center space-y-2 flex-1">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-blue-800 bg-clip-text text-transparent">
              InterCompany Ledger Summary
            </h1>
            <p className="text-gray-600 text-lg">
              View customer and supplier ledger summaries for intercompany transactions
            </p>
          </div>
          <div className="flex space-x-2">
            <Link to="/reconciliation">
              <Button
                variant="outline"
                className="flex items-center space-x-2"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Back to Reconciliation</span>
              </Button>
            </Link>
          </div>
        </div>

        {/* Company Selection */}
        <Card className="border-blue-200 shadow-lg">
          <CardHeader className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg p-6">
            <CardTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5" />
              Ledger Summary Selection
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 w-full">
            {/* All Filters in Single Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4 w-full">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Company</label>
                <Combobox
                  options={[
                    ...(allCompanies?.length ? allCompanies : companies).map((companyItem) => ({
                      name: ("company_name" in companyItem ? companyItem.company_name : companyItem.name) ?? companyItem.name,
                      value: companyItem.name,
                    })),
                    ...(company && !(allCompanies?.length ? allCompanies : companies).some((c) => c.name === company)
                      ? [{ name: company, value: company }]
                      : []),
                  ]}
                  value={company}
                  onValueChange={setCompany}
                  placeholder={
                    allCompaniesLoading ? "Loading..." :
                    (allCompanies.length === 0 && companies.length === 0) ? "No companies available" :
                    "Select Company"
                  }
                  disabled={allCompaniesLoading || (allCompanies.length === 0 && companies.length === 0)}
                  searchPlaceholder="Search companies..."
                  emptyMessage="No companies found."
                />
              </div>
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
                  <SelectTrigger className="border-blue-200 focus:border-blue-400" disabled>
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
                <label className="text-sm font-medium text-gray-700">Show Intercompany Only</label>
                <div className="flex items-center space-x-2 p-2 border border-blue-200 rounded-md bg-blue-50">
                  <input
                    type="checkbox"
                    id="showIntercompanyOnly"
                    checked={showIntercompanyOnly}
                    onChange={(e) => setShowIntercompanyOnly(e.target.checked)}
                    className="rounded border-blue-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label htmlFor="showIntercompanyOnly" className="text-sm text-gray-700">
                    Enable
                  </label>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">In Party Currency</label>
                <div className="flex items-center space-x-2 p-2 border border-blue-200 rounded-md bg-blue-50">
                  <input
                    type="checkbox"
                    id="inPartyCurrency"
                    checked={inPartyCurrency}
                    onChange={(e) => setInPartyCurrency(e.target.checked)}
                    className="rounded border-blue-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label htmlFor="inPartyCurrency" className="text-sm text-gray-700">
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
            </div>

            {/* Exchange Rate Filter - Second Row */}
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 w-full">
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
            </div>

            <div className="flex justify-center mt-6">
              <Button
                onClick={() => {
                  handleLoadData()
                }}
                disabled={!company || isLoading}
                className="bg-blue-600 hover:bg-blue-700 text-white px-8"
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
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
          <Alert className="border-red-200 bg-red-50">
            <AlertDescription className="text-red-800">{error}</AlertDescription>
          </Alert>
        )}

        {/* Reconciliation Analysis */}
        {/* {hasLoadedData && reconciliationAnalysis && (
          <Card className="border-blue-200 shadow-lg">
            <CardHeader className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg">
              <CardTitle className="flex items-center gap-2">
                {reconciliationAnalysis.closingBalanceMatch ? (
                  <CheckCircle className="h-5 w-5 text-green-300" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-300" />
                )}
                Ledger Summary Analysis
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
               <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <Card className="border-blue-200">
              <CardHeader className="bg-gray-50 border-b border-gray-200">
                <CardTitle className="text-lg text-gray-800">
                  {company} - Customer Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">
                      {formatCurrency(customerLedgerData.totals.totalOpeningBalance, 'USD', company)}
                    </div>
                    <div className="text-sm text-gray-600">Opening Balance ({getCompanyCurrency(company)})</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {formatCurrency(customerLedgerData.totals.totalInvoicedAmount, 'USD', company)}
                    </div>
                    <div className="text-sm text-gray-600">Invoiced Amount ({getCompanyCurrency(company)})</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-purple-600">
                      {formatCurrency(customerLedgerData.totals.totalPaidAmount, 'USD', company)}
                    </div>
                    <div className="text-sm text-gray-600">Paid Amount ({getCompanyCurrency(company)})</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-orange-600">
                      {formatCurrency(customerLedgerData.totals.totalClosingBalance, 'USD', company)}
                    </div>
                    <div className="text-sm text-gray-600">Closing Balance ({getCompanyCurrency(company)})</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-blue-200">
              <CardHeader className="bg-gray-50 border-b border-gray-200">
                <CardTitle className="text-lg text-gray-800">
                  {company} - Supplier Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">
                      {formatCurrency(supplierLedgerData.totals.totalOpeningBalance, 'USD', company)}
                    </div>
                    <div className="text-sm text-gray-600">Opening Balance ({getCompanyCurrency(company)})</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {formatCurrency(supplierLedgerData.totals.totalInvoicedAmount, 'USD', company)}
                    </div>
                    <div className="text-sm text-gray-600">Invoiced Amount ({getCompanyCurrency(company)})</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-purple-600">
                      {formatCurrency(supplierLedgerData.totals.totalPaidAmount, 'USD', company)}
                    </div>
                    <div className="text-sm text-gray-600">Paid Amount ({getCompanyCurrency(company)})</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-orange-600">
                      {formatCurrency(supplierLedgerData.totals.totalClosingBalance, 'USD', company)}
                    </div>
                    <div className="text-sm text-gray-600">Closing Balance ({getCompanyCurrency(company)})</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

              <div className="space-y-3">
                <Alert
                  className={`border-2 ${reconciliationAnalysis.closingBalanceMatch ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}
                >
                  <AlertDescription className={reconciliationAnalysis.closingBalanceMatch ? "text-green-800" : "text-red-800"}>
                    {reconciliationAnalysis.closingBalanceMatch ? (
                      <>
                        <CheckCircle className="h-4 w-4 inline mr-2" />
                        <strong>Balances Match:</strong> The customer and supplier closing balances for {company} are equal.
                      </>
                    ) : (
                      <>
                        <XCircle className="h-4 w-4 inline mr-2" />
                        <strong>Balances Don't Match:</strong> There's a difference of {formatCurrency(Math.abs(reconciliationAnalysis.customerTotals.totalClosingBalance - reconciliationAnalysis.supplierTotals.totalClosingBalance), 'USD', company)} between the customer and supplier closing balances.
                      </>
                    )}
                  </AlertDescription>
                </Alert>
              </div>
            </CardContent>
          </Card>
        )} */}

        {/* Totals Summary */}
        {hasLoadedData && customerLedgerData && supplierLedgerData && (
          <Card className="border-beveren-200 shadow-lg mb-6">
            <CardHeader className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg">
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Totals Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Customer Summary */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-beveren-800 border-b border-beveren-200 pb-2">
                    Customer Summary
                  </h3>
                  <div className="grid grid-cols-1 gap-3">
                    <div className="flex justify-between items-center p-3 bg-beveren-50 rounded-lg">
                      <span className="font-medium text-beveren-700">Total Party Balance:</span>
                      <span className="font-bold text-beveren-800">
                        {formatCurrency(customerLedgerData.totals.totalClosingBalance, customerLedgerData.entries[0]?.currency || 'USD', company)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-beveren-50 rounded-lg">
                      <span className="font-medium text-beveren-700">GL Closing:</span>
                      <span className="font-bold text-beveren-800">
                        {formatCurrency(Object.values(customerGLClosing).reduce((sum, amount) => sum + amount, 0), customerLedgerData.entries[0]?.currency || 'USD', company)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-orange-50 rounded-lg border border-orange-200">
                      <span className="font-medium text-orange-700">Difference:</span>
                      <span className="font-bold text-orange-800">
                        {formatCurrency(Math.abs(customerLedgerData.totals.totalClosingBalance - Object.values(customerGLClosing).reduce((sum, amount) => sum + amount, 0)), customerLedgerData.entries[0]?.currency || 'USD', company)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Supplier Summary */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-beveren-800 border-b border-beveren-200 pb-2">
                    Supplier Summary
                  </h3>
                  <div className="grid grid-cols-1 gap-3">
                    <div className="flex justify-between items-center p-3 bg-beveren-50 rounded-lg">
                      <span className="font-medium text-beveren-700">Total Party Balance:</span>
                      <span className="font-bold text-beveren-800">
                        {formatCurrency(supplierLedgerData.totals.totalClosingBalance, supplierLedgerData.entries[0]?.currency || 'USD', company)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-beveren-50 rounded-lg">
                      <span className="font-medium text-beveren-700">GL Closing:</span>
                      <span className="font-bold text-beveren-800">
                        {formatCurrency(Object.values(supplierGLClosing).reduce((sum, amount) => sum + amount, 0), supplierLedgerData.entries[0]?.currency || 'USD', company)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-orange-50 rounded-lg border border-orange-200">
                      <span className="font-medium text-orange-700">Difference:</span>
                      <span className="font-bold text-orange-800">
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
          <Card className="border-blue-200 shadow-lg">
            <CardHeader className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg">
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Reconciliation Summary Statistics
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Customer Statistics */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-blue-800 flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Customer Statistics
                  </h3>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
                      <span className="text-blue-700 font-medium">Total Customers:</span>
                      <span className="text-blue-900 font-bold text-lg">{summaryStats.customers.total}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                      <span className="text-green-700 font-medium">Matched:</span>
                      <span className="text-green-900 font-bold text-lg">{summaryStats.customers.matched}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-red-50 rounded-lg">
                      <span className="text-red-700 font-medium">Unmatched:</span>
                      <span className="text-red-900 font-bold text-lg">{summaryStats.customers.unmatched}</span>
                    </div>

                  </div>
                </div>

                {/* Supplier Statistics */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-blue-800 flex items-center gap-2">
                    <Building2 className="h-5 w-5" />
                    Supplier Statistics
                  </h3>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
                      <span className="text-blue-700 font-medium">Total Suppliers:</span>
                      <span className="text-blue-900 font-bold text-lg">{summaryStats.suppliers.total}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                      <span className="text-green-700 font-medium">Matched:</span>
                      <span className="text-green-900 font-bold text-lg">{summaryStats.suppliers.matched}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-red-50 rounded-lg">
                      <span className="text-red-700 font-medium">Unmatched:</span>
                      <span className="text-red-900 font-bold text-lg">{summaryStats.suppliers.unmatched}</span>
                    </div>

                  </div>
                </div>
              </div>

              {/* Overall Progress */}
              <div className="mt-6 pt-6 border-t border-blue-200">
                <h4 className="text-lg font-semibold text-blue-800 mb-4">Overall Reconciliation Progress</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="text-center p-6 bg-gradient-to-r from-green-50 to-green-100 rounded-lg">
                    <div className="text-3xl font-bold text-green-700">
                      {summaryStats.overall.matched}
                    </div>
                    <div className="text-lg text-green-600 font-medium">Total Matched</div>
                  </div>
                  <div className="text-center p-6 bg-gradient-to-r from-red-50 to-red-100 rounded-lg">
                    <div className="text-3xl font-bold text-red-700">
                      {summaryStats.overall.unmatched}
                    </div>
                    <div className="text-lg text-red-600 font-medium">Total Unmatched</div>
                  </div>
                  <div className="text-center p-6 bg-gradient-to-r from-blue-50 to-blue-100 rounded-lg">
                    <div className="text-3xl font-bold text-blue-700">
                      {summaryStats.overall.matchWithIntransit}
                    </div>
                    <div className="text-lg text-blue-600 font-medium">Match with Intransit</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Status Filter */}
        {hasLoadedData && customerLedgerData && supplierLedgerData && (
          <Card className="border-blue-200 shadow-lg">
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
                        <SelectItem value="Match with In-Transit">✓ Match with Intransit</SelectItem>
                        <SelectItem value="Unmatched">✗ Unmatched</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="text-sm text-gray-600">
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
            <Card className="border-blue-200 shadow-lg">
              <CardHeader className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg">
                <CardTitle>
                  {(allCompanies.length > 0 ? allCompanies : companies).find((c) => c.name === company)?.name || company} - Customer Ledger Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-blue-50">
                        <TableHead className="text-blue-800">Party</TableHead>
                        <TableHead className="text-blue-800 text-right">Party Balance</TableHead>
                        <TableHead className="text-blue-800 text-right">GL Closing</TableHead>
                        <TableHead className="text-blue-800 text-right">Difference</TableHead>
                        <TableHead className="text-gray-500 text-right">In-Transit Total</TableHead>
                        <TableHead className="text-blue-800 text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filterEntriesByStatus(customerLedgerData.entries, customerGLClosing, customerIntransitTotals).map((entry, index) => {
                        const glClosing = customerGLClosing[entry.party] || 0
                        const difference = calculateDifference(entry.closing_balance, glClosing)
                        const isPartyGLLoaded = customerGLClosing.hasOwnProperty(entry.party)
                        const intransitTotal = customerIntransitTotals[entry.party]
                        const status = getStatus(difference, glClosing, !isPartyGLLoaded, entry.party, intransitTotal)

                        // Show "-" for matched entries, show value for unmatched
                        const showIntransitTotal = status.text === 'Match' ? '-' :
                          (intransitTotal !== undefined ? formatCurrency(intransitTotal, entry.currency, company) : '-')

                        // Only when allow offset is ticked AND this row matched via offset rule: show in-transit in Difference column
                        const showDifference = status.text === 'Match with In-Transit' && status.isOffsetMatch === true && intransitTotal != null
                          ? intransitTotal
                          : difference

                        return (
                          <TableRow key={index} className="hover:bg-blue-50">
                            <TableCell className="font-medium">{entry.party_name}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(entry.closing_balance, entry.currency, company)}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(glClosing, entry.currency, company)}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(showDifference, entry.currency, company)}</TableCell>
                            <TableCell className="text-right text-gray-500 font-normal">{showIntransitTotal}</TableCell>
                            <TableCell className="text-right">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${status.bgColor} ${status.color}`}>
                                {status.text}
                              </span>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>


              </CardContent>
            </Card>

            {/* Supplier Ledger Summary */}
            <Card className="border-blue-200 shadow-lg">
              <CardHeader className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg">
                <CardTitle>
                  {(allCompanies.length > 0 ? allCompanies : companies).find((c) => c.name === company)?.name || company} - Supplier Ledger Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-blue-50">
                        <TableHead className="text-blue-800">Party</TableHead>
                        <TableHead className="text-blue-800 text-right">Party Balance</TableHead>
                        <TableHead className="text-blue-800 text-right">GL Closing</TableHead>
                        <TableHead className="text-blue-800 text-right">Difference</TableHead>
                        <TableHead className="text-gray-500 text-right">In-Transit Total</TableHead>
                        <TableHead className="text-blue-800 text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filterEntriesByStatus(supplierLedgerData.entries, supplierGLClosing, supplierIntransitTotals).map((entry, index) => {
                        const glClosing = supplierGLClosing[entry.party] || 0
                        const difference = calculateDifference(entry.closing_balance, glClosing)
                        const isPartyGLLoaded = supplierGLClosing.hasOwnProperty(entry.party)
                        const intransitTotal = supplierIntransitTotals[entry.party]
                        const status = getStatus(difference, glClosing, !isPartyGLLoaded, entry.party, intransitTotal)

                        // Show "-" for matched entries, show value for unmatched
                        const showIntransitTotal = status.text === 'Match' ? '-' :
                          (intransitTotal !== undefined ? formatCurrency(intransitTotal, entry.currency, company) : '-')

                        // Only when allow offset is ticked AND this row matched via offset rule: show in-transit in Difference column
                        const showDifference = status.text === 'Match with In-Transit' && status.isOffsetMatch === true && intransitTotal != null
                          ? intransitTotal
                          : difference

                        return (
                          <TableRow key={index} className="hover:bg-blue-50">
                            <TableCell className="font-medium">{entry.party_name}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(entry.closing_balance, entry.currency, company)}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(glClosing, entry.currency, company)}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(showDifference, entry.currency, company)}</TableCell>
                            <TableCell className="text-right text-gray-500 font-normal">{showIntransitTotal}</TableCell>
                            <TableCell className="text-right">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${status.bgColor} ${status.color}`}>
                                {status.text}
                              </span>
                            </TableCell>
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
