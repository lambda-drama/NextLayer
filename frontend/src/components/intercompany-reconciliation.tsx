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

  // Use the custom hooks
  const { companies, isLoading: companiesLoading, error: companiesError, testEndpoint, refreshCSRFToken } = useCompanies()

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

  // Determine loading and error states
  const isLoading = glLoadingA || glLoadingB
  const error = companiesError || partiesAError || partiesBError || glErrorA || glErrorB

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
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <Card className="border-blue-200">
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl font-bold text-blue-600">
                      {formatCurrency(reconciliationAnalysis.totalDebitA)}
                    </div>
                    <div className="text-sm text-gray-600">{companyA} Debit</div>
                  </CardContent>
                </Card>
                <Card className="border-blue-200">
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {formatCurrency(reconciliationAnalysis.totalCreditA)}
                    </div>
                    <div className="text-sm text-gray-600">{companyA} Credit</div>
                  </CardContent>
                </Card>
                <Card className="border-blue-200">
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl font-bold text-blue-600">
                      {formatCurrency(reconciliationAnalysis.totalDebitB)}
                    </div>
                    <div className="text-sm text-gray-600">{companyB} Debit</div>
                  </CardContent>
                </Card>
                <Card className="border-blue-200">
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {formatCurrency(reconciliationAnalysis.totalCreditB)}
                    </div>
                    <div className="text-sm text-gray-600">{companyB} Credit</div>
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

        {/* General Ledger Data */}
        {(glDataA.length > 0 || glDataB.length > 0) && (
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
                        <TableHead className="text-blue-800">Date</TableHead>
                        <TableHead className="text-blue-800">Voucher</TableHead>
                        <TableHead className="text-blue-800 text-right">Debit</TableHead>
                        <TableHead className="text-blue-800 text-right">Credit</TableHead>
                        <TableHead className="text-blue-800 text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {glDataA.map((entry, index) => (
                        <TableRow key={entry.gl_entry || index} className="hover:bg-blue-50">
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
                        </TableRow>
                      ))}
                      {glDataA.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-gray-500 py-8">
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
                        <TableHead className="text-blue-800">Date</TableHead>
                        <TableHead className="text-blue-800">Voucher</TableHead>
                        <TableHead className="text-blue-800 text-right">Debit</TableHead>
                        <TableHead className="text-blue-800 text-right">Credit</TableHead>
                        <TableHead className="text-blue-800 text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {glDataB.map((entry, index) => (
                        <TableRow key={entry.gl_entry || index} className="hover:bg-blue-50">
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
                        </TableRow>
                      ))}
                      {glDataB.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-gray-500 py-8">
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
      </div>
    </div>
  )
}
