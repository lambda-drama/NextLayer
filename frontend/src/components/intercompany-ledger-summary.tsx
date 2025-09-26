"use client"

import  { useState, useMemo } from "react"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table"
import { Alert, AlertDescription } from "../../components/ui/alert"
import { ArrowLeftRight, RefreshCw, ArrowLeft, CheckCircle, XCircle } from "lucide-react"
import { Link } from "react-router-dom"
import { useCompanies } from "../hook/useCompanies"
import { usePermissionAwareCompanies } from "../hook/usePermissionAwareCompanies"
import { useAllCompaniesForUI } from "../hook/useAllCompaniesForUI"

import { useLedgerSummary } from "../hook/useLedgerSummary"

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
  const [companyA, setCompanyA] = useState<string>("")
  const [companyB, setCompanyB] = useState<string>("")
  const [fromDate, setFromDate] = useState<string>(`${new Date().getFullYear()}-01-01`)
  const [toDate, setToDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [currency, setCurrency] = useState<string>("all")
  const [showIntercompanyOnly, setShowIntercompanyOnly] = useState<boolean>(true)
  const [hasLoadedData, setHasLoadedData] = useState<boolean>(false)
  const [inPartyCurrency, setInPartyCurrency] = useState<boolean>(true)
  const [ignoreSystemGeneratedNotes, setIgnoreSystemGeneratedNotes] = useState<boolean>(true)
  const [ignoreExchangeRateRevaluation, setIgnoreExchangeRateRevaluation] = useState<boolean>(true)

  // Data state
  const [error, setError] = useState<string>("")

  // Use the custom hooks
  const { companies, isLoading: companiesLoading, error: companiesError } = useCompanies()
  const { companies: permissionAwareCompanies } = usePermissionAwareCompanies()
  const { companies: allCompanies, isLoading: allCompaniesLoading, error: allCompaniesError } = useAllCompaniesForUI()
  // Use ledger summary hooks - only fetch when hasLoadedData is true
  const { data: ledgerDataA, isLoading: isLoadingA, error: errorA } = useLedgerSummary({
    company: companyA,
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

  const { data: ledgerDataB, isLoading: isLoadingB, error: errorB } = useLedgerSummary({
    company: companyB,
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

  console.log("Ledger Data A:", ledgerDataA)
  console.log("Ledger Data B:", ledgerDataB)
  console.log("hasLoadedData:", hasLoadedData)
  console.log("Should render tables:", hasLoadedData && ledgerDataA && ledgerDataB)
  const isLoading = isLoadingA || isLoadingB

  // Handle load data
  const handleLoadData = () => {
    console.log("handleLoadData called", { companyA, companyB })
    if (!companyA || !companyB) {
      setError("Please select both companies")
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
      locale = 'en-CN'
    } else if (displayCurrency === 'DJF') {
      locale = 'en-DJ'
    } else if (displayCurrency === 'XAF') {
      locale = 'en-CM'
    } else if (displayCurrency === 'XOF') {
      locale = 'en-SN'
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

  // Calculate reconciliation analysis
  const reconciliationAnalysis = useMemo(() => {
    if (!ledgerDataA || !ledgerDataB) return null

    const totalsA = ledgerDataA.totals
    const totalsB = ledgerDataB.totals

    // Check if closing balances match (for intercompany reconciliation)
    const closingBalanceMatch = Math.abs(totalsA.totalClosingBalance - totalsB.totalClosingBalance) < 0.01

    return {
      closingBalanceMatch,
      difference: Math.abs(totalsA.totalClosingBalance - totalsB.totalClosingBalance),
      totalsA,
      totalsB
    }
  }, [ledgerDataA, ledgerDataB])

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
              Compare customer and supplier ledger summaries between intercompany transactions
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
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Company A Selection */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-blue-800 border-b border-blue-200 pb-2">
                    Company A (Customer Ledger)
                  </h3>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">Company</label>
                    <Select value={companyA} onValueChange={setCompanyA}>
                      <SelectTrigger className="border-blue-200 focus:border-blue-400">
                        <SelectValue placeholder="Select Company A" />
                      </SelectTrigger>
                      <SelectContent className="bg-blue-200">
                        {permissionAwareCompanies.map((company) => (
                          <SelectItem key={company.name} value={company.name}>
                            {company.company_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Company B Selection */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-blue-800 border-b border-blue-200 pb-2">
                    Company B (Supplier Ledger)
                  </h3>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">Company</label>
                    <Select value={companyB} onValueChange={setCompanyB}>
                      <SelectTrigger className="border-blue-200 focus:border-blue-400">
                        <SelectValue placeholder="Select Company B" />
                      </SelectTrigger>
                      <SelectContent className="bg-blue-200">
                        {permissionAwareCompanies.map((company) => (
                          <SelectItem key={company.name} value={company.name}>
                            {company.company_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>

            {/* All Filters in Single Row */}
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 w-full">
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
                disabled={!companyA || !companyB || isLoading}
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
        {hasLoadedData && reconciliationAnalysis && (
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
            {/* Company A Summary */}
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
                      {formatCurrency(ledgerDataA.totals.totalOpeningBalance, 'USD', companyA)}
                    </div>
                    <div className="text-sm text-gray-600">Opening Balance ({getCompanyCurrency(companyA)})</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {formatCurrency(ledgerDataA.totals.totalInvoicedAmount, 'USD', companyA)}
                    </div>
                    <div className="text-sm text-gray-600">Invoiced Amount ({getCompanyCurrency(companyA)})</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-purple-600">
                      {formatCurrency(ledgerDataA.totals.totalPaidAmount, 'USD', companyA)}
                    </div>
                    <div className="text-sm text-gray-600">Paid Amount ({getCompanyCurrency(companyA)})</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-orange-600">
                      {formatCurrency(ledgerDataA.totals.totalClosingBalance, 'USD', companyA)}
                    </div>
                    <div className="text-sm text-gray-600">Closing Balance ({getCompanyCurrency(companyA)})</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Company B Summary */}
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
                      {formatCurrency(ledgerDataB.totals.totalOpeningBalance, 'USD', companyB)}
                    </div>
                    <div className="text-sm text-gray-600">Opening Balance ({getCompanyCurrency(companyB)})</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {formatCurrency(ledgerDataB.totals.totalInvoicedAmount, 'USD', companyB)}
                    </div>
                    <div className="text-sm text-gray-600">Invoiced Amount ({getCompanyCurrency(companyB)})</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-purple-600">
                      {formatCurrency(ledgerDataB.totals.totalPaidAmount, 'USD', companyB)}
                    </div>
                    <div className="text-sm text-gray-600">Paid Amount ({getCompanyCurrency(companyB)})</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-orange-600">
                      {formatCurrency(ledgerDataB.totals.totalClosingBalance, 'USD', companyB)}
                    </div>
                    <div className="text-sm text-gray-600">Closing Balance ({getCompanyCurrency(companyB)})</div>
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
                        <strong>Balances Match:</strong> The closing balances between {companyA} and {companyB} are equal.
                      </>
                    ) : (
                      <>
                        <XCircle className="h-4 w-4 inline mr-2" />
                        <strong>Balances Don't Match:</strong> There's a difference of {formatCurrency(Math.abs(reconciliationAnalysis.totalsA.totalClosingBalance - reconciliationAnalysis.totalsB.totalClosingBalance), 'USD', companyA)} between the closing balances.
                      </>
                    )}
                  </AlertDescription>
                </Alert>
              </div>
            </CardContent>
          </Card>
        )}


        {/* Data Display */}
        {hasLoadedData && ledgerDataA && ledgerDataB && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Company A Ledger Summary */}
            <Card className="border-blue-200 shadow-lg">
              <CardHeader className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg">
                <CardTitle>
                  {(allCompanies.length > 0 ? allCompanies : companies).find((c) => c.name === companyA)?.name || companyA} - Customer Ledger Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-blue-50">
                        <TableHead className="text-blue-800">Party</TableHead>
                        <TableHead className="text-blue-800 text-right">Opening</TableHead>
                        <TableHead className="text-blue-800 text-right">Invoiced</TableHead>
                        <TableHead className="text-blue-800 text-right">Paid</TableHead>
                        <TableHead className="text-blue-800 text-right">Debit</TableHead>
                        <TableHead className="text-blue-800 text-right">Credit</TableHead>
                        <TableHead className="text-blue-800 text-right">Closing</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ledgerDataA.entries.map((entry, index) => (
                        <TableRow key={index} className="hover:bg-blue-50">
                          <TableCell className="font-medium">{entry.party_name}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(entry.opening_balance, entry.currency, companyA)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(entry.invoiced_amount, entry.currency, companyA)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(entry.paid_amount, entry.currency, companyA)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(entry.debit, entry.currency, companyA)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(entry.credit, entry.currency, companyA)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(entry.closing_balance, entry.currency, companyA)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>


              </CardContent>
            </Card>

            {/* Company B Ledger Summary */}
            <Card className="border-blue-200 shadow-lg">
              <CardHeader className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg">
                <CardTitle>
                  {(allCompanies.length > 0 ? allCompanies : companies).find((c) => c.name === companyB)?.name || companyB} - Supplier Ledger Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-blue-50">
                        <TableHead className="text-blue-800">Party</TableHead>
                        <TableHead className="text-blue-800 text-right">Opening</TableHead>
                        <TableHead className="text-blue-800 text-right">Invoiced</TableHead>
                        <TableHead className="text-blue-800 text-right">Paid</TableHead>
                        <TableHead className="text-blue-800 text-right">Debit</TableHead>
                        <TableHead className="text-blue-800 text-right">Credit</TableHead>
                        <TableHead className="text-blue-800 text-right">Closing</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ledgerDataB.entries.map((entry, index) => (
                        <TableRow key={index} className="hover:bg-blue-50">
                          <TableCell className="font-medium">{entry.party_name}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(entry.opening_balance, entry.currency, companyB)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(entry.invoiced_amount, entry.currency, companyB)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(entry.paid_amount, entry.currency, companyB)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(entry.debit, entry.currency, companyB)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(entry.credit, entry.currency, companyB)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(entry.closing_balance, entry.currency, companyB)}</TableCell>
                        </TableRow>
                      ))}
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
