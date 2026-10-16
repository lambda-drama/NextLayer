"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog"
import { Button } from "../../components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table"
import { Badge } from "../../components/ui/badge"
import { Alert, AlertDescription } from "../../components/ui/alert"
import { Lock, X, RefreshCw } from "lucide-react"
import { GLEntry } from "../types/gl-entry"

interface HiddenTransactionsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyA: string
  companyB: string
  hiddenDataA: GLEntry[]
  hiddenDataB: GLEntry[]
  isLoading?: boolean
  error?: string
  // Add props for currency and party info
  currency?: string
  partyA?: string
  partyB?: string
  partyTypeB?: string
}

export default function HiddenTransactionsModal({
  open,
  onOpenChange,
  companyA,
  companyB,
  hiddenDataA,
  hiddenDataB,
  isLoading = false,
  error,
  currency = "all",
  partyA,
  partyB,
  partyTypeB = "Supplier"
}: HiddenTransactionsModalProps) {
  const [isLoadingData, setIsLoadingData] = useState(false)

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

  // Handle voucher click to preserve state
  const handleVoucherClick = (entry: GLEntry) => {
    // Save current state to localStorage before navigating
    const currentState = {
      companyA,
      companyB,
      partyA,
      partyB,
      partyTypeB,
      fromDate: new Date().toISOString().split('T')[0], // You might want to pass these as props
      toDate: new Date().toISOString().split('T')[0],
      currency,
      timestamp: Date.now()
    }

    localStorage.setItem('intercompanyReconciliationState', JSON.stringify(currentState))
  }

  // Format currency with proper locale
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

    // Default currencies based on party type
    if (partyType === 'Customer') {
      return 'USD' // Default for customers
    } else if (partyType === 'Supplier') {
      return 'USD' // Default for suppliers
    }

    return 'USD' // Fallback
  }

  // Get status badge component (simplified for hidden transactions)
  const getStatusBadge = (status?: string) => {
    if (!status) return null

    const statusConfig = {
      'matched': { variant: 'default' as const, className: 'bg-green-100 dark:bg-green-950/60 text-green-800 dark:text-green-300 border-green-200 dark:border-green-900' },
      'unmatched': { variant: 'outline' as const, className: 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-600' },
      'partial': { variant: 'secondary' as const, className: 'bg-yellow-100 dark:bg-yellow-950/60 text-yellow-800 dark:text-yellow-300 border-yellow-200 dark:border-yellow-900' }
    }

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.unmatched

    return (
      <Badge variant={config.variant} className={config.className}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    )
  }

  const handleClose = () => {
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-7xl h-[90vh] flex flex-col p-0 overflow-hidden">
        <div className="p-6 pb-0 flex-shrink-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-800 dark:text-orange-300">
              <Lock className="h-5 w-5" />
              Hidden Transactions - Admin View
            </DialogTitle>
            <DialogDescription className="text-slate-600 dark:text-slate-300">
              Viewing hidden transactions that require special permission. These transactions are normally not visible due to access restrictions.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <Alert className="border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 mt-4">
              <AlertDescription className="text-red-800 dark:text-red-300">
                {error}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <div className="flex-1 px-6 overflow-hidden min-h-0">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full">
            {/* Company A Table */}
            <div className="flex flex-col h-full min-h-0">
              <div className="flex items-center justify-between mb-4 flex-shrink-0">
                <h3 className="text-lg font-semibold text-blue-800 dark:text-blue-300">
                  {companyA} - Hidden Transactions
                </h3>
                <Badge variant="outline" className="bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-900">
                  {hiddenDataA.length} entries
                </Badge>
              </div>

              <div className="border rounded-lg flex-1 flex flex-col min-h-0 overflow-hidden">
                <div className="overflow-y-auto flex-1" style={{ maxHeight: 'calc(90vh - 200px)' }}>
                  <Table>
                    <TableHeader className="sticky top-0 bg-blue-50 dark:bg-blue-950/40 z-10">
                      <TableRow>
                        <TableHead className="text-blue-800 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40">Date</TableHead>
                        <TableHead className="text-blue-800 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40">Voucher</TableHead>
                        <TableHead className="text-blue-800 dark:text-blue-300 text-right bg-blue-50 dark:bg-blue-950/40">Debit ({getPartyCurrency(partyA || '', 'Customer')})</TableHead>
                        <TableHead className="text-blue-800 dark:text-blue-300 text-right bg-blue-50 dark:bg-blue-950/40">Credit ({getPartyCurrency(partyA || '', 'Customer')})</TableHead>
                        <TableHead className="text-blue-800 dark:text-blue-300 text-right bg-blue-50 dark:bg-blue-950/40">Balance ({getPartyCurrency(partyA || '', 'Customer')})</TableHead>
                        <TableHead className="text-blue-800 dark:text-blue-300 text-center bg-blue-50 dark:bg-blue-950/40">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {hiddenDataA.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-slate-500 dark:text-slate-400 py-8">
                            No hidden transactions found
                          </TableCell>
                        </TableRow>
                      ) : (
                        hiddenDataA.map((entry, index) => (
                          <TableRow key={entry.gl_entry || index} className="hover:bg-blue-50 dark:hover:bg-blue-950/40">
                            <TableCell className="font-medium">{entry.posting_date}</TableCell>
                            <TableCell>
                              <div>
                                <div className="font-medium">{entry.voucher_type}</div>
                                <div className="text-sm text-slate-600 dark:text-slate-300">
                                  <a
                                    href={getVoucherUrl(entry.voucher_type, entry.voucher_no)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline cursor-pointer"
                                    onClick={() => handleVoucherClick(entry)}
                                    title={`Click to view ${entry.voucher_type} ${entry.voucher_no} in ERPNext`}
                                  >
                                    {entry.voucher_no}
                                  </a>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-medium text-blue-600 dark:text-blue-400">
                              {entry.debit > 0 ? formatCurrency(entry.debit, getPartyCurrency(partyA || '', 'Customer'), partyA, 'Customer') : "-"}
                            </TableCell>
                            <TableCell className="text-right font-medium text-green-600 dark:text-green-400">
                              {entry.credit > 0 ? formatCurrency(entry.credit, getPartyCurrency(partyA || '', 'Customer'), partyA, 'Customer') : "-"}
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {formatCurrency(entry.balance, getPartyCurrency(partyA || '', 'Customer'), partyA, 'Customer')}
                            </TableCell>
                            <TableCell className="text-center">
                              {getStatusBadge(entry.match_status)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>

            {/* Company B Table */}
            <div className="flex flex-col h-full min-h-0">
              <div className="flex items-center justify-between mb-4 flex-shrink-0">
                <h3 className="text-lg font-semibold text-blue-800 dark:text-blue-300">
                  {companyB} - Hidden Transactions
                </h3>
                <Badge variant="outline" className="bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-900">
                  {hiddenDataB.length} entries
                </Badge>
              </div>

              <div className="border rounded-lg flex-1 flex flex-col min-h-0 overflow-hidden">
                <div className="overflow-y-auto flex-1" style={{ maxHeight: 'calc(90vh - 200px)' }}>
                  <Table>
                    <TableHeader className="sticky top-0 bg-blue-50 dark:bg-blue-950/40 z-10">
                      <TableRow>
                        <TableHead className="text-blue-800 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40">Date</TableHead>
                        <TableHead className="text-blue-800 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40">Voucher</TableHead>
                        <TableHead className="text-blue-800 dark:text-blue-300 text-right bg-blue-50 dark:bg-blue-950/40">Debit ({getPartyCurrency(partyB || '', partyTypeB)})</TableHead>
                        <TableHead className="text-blue-800 dark:text-blue-300 text-right bg-blue-50 dark:bg-blue-950/40">Credit ({getPartyCurrency(partyB || '', partyTypeB)})</TableHead>
                        <TableHead className="text-blue-800 dark:text-blue-300 text-right bg-blue-50 dark:bg-blue-950/40">Balance ({getPartyCurrency(partyB || '', partyTypeB)})</TableHead>
                        <TableHead className="text-blue-800 dark:text-blue-300 text-center bg-blue-50 dark:bg-blue-950/40">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {hiddenDataB.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-slate-500 dark:text-slate-400 py-8">
                            No hidden transactions found
                          </TableCell>
                        </TableRow>
                      ) : (
                        hiddenDataB.map((entry, index) => (
                          <TableRow key={entry.gl_entry || index} className="hover:bg-blue-50 dark:hover:bg-blue-950/40">
                            <TableCell className="font-medium">{entry.posting_date}</TableCell>
                            <TableCell>
                              <div>
                                <div className="font-medium">{entry.voucher_type}</div>
                                <div className="text-sm text-slate-600 dark:text-slate-300">
                                  <a
                                    href={getVoucherUrl(entry.voucher_type, entry.voucher_no)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline cursor-pointer"
                                    onClick={() => handleVoucherClick(entry)}
                                    title={`Click to view ${entry.voucher_type} ${entry.voucher_no} in ERPNext`}
                                  >
                                    {entry.voucher_no}
                                  </a>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-medium text-blue-600 dark:text-blue-400">
                              {entry.debit > 0 ? formatCurrency(entry.debit, getPartyCurrency(partyB || '', partyTypeB), partyB, partyTypeB) : "-"}
                            </TableCell>
                            <TableCell className="text-right font-medium text-green-600 dark:text-green-400">
                              {entry.credit > 0 ? formatCurrency(entry.credit, getPartyCurrency(partyB || '', partyTypeB), partyB, partyTypeB) : "-"}
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {formatCurrency(entry.balance, getPartyCurrency(partyB || '', partyTypeB), partyB, partyTypeB)}
                            </TableCell>
                            <TableCell className="text-center">
                              {getStatusBadge(entry.match_status)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 pt-4 border-t flex-shrink-0">
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={isLoading || isLoadingData}
            >
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
