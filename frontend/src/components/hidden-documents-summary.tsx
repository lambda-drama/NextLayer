"use client"

import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { AlertTriangle, Lock, Eye, Unlock } from "lucide-react"

interface HiddenSummary {
  [key: string]: {
    count: number
    total_debit: number
    total_credit: number
  }
}

interface HiddenDocumentsSummaryProps {
  hiddenSummary: HiddenSummary
  totalHiddenEntries: number
  companyName: string
  onViewHiddenTransactions?: () => void
}

export default function HiddenDocumentsSummary({
  hiddenSummary,
  totalHiddenEntries,
  companyName,
  onViewHiddenTransactions
}: HiddenDocumentsSummaryProps) {
  if (totalHiddenEntries === 0) {
    return null
  }

  const documentTypes = [
    { key: "Sales Invoice", label: "Sales Invoices", icon: "📄" },
    { key: "Purchase Invoice", label: "Purchase Invoices", icon: "📋" },
    { key: "Journal Entry", label: "Journal Entries", icon: "📝" },
    { key: "Payment Entry", label: "Payment Entries", icon: "💰" }
  ]

  return (
    <Card className="border-orange-200 dark:border-orange-900 bg-orange-50 dark:bg-orange-950/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-orange-800 dark:text-orange-300">
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            <span>Documents Requiring Permission to View</span>
            <Badge variant="outline" className="bg-orange-100 dark:bg-orange-950/60 text-orange-800 dark:text-orange-300 border-orange-300 dark:border-orange-800">
              {totalHiddenEntries} hidden
            </Badge>
          </div>
          {onViewHiddenTransactions && (
            <Button
              onClick={onViewHiddenTransactions}
              size="sm"
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              <Unlock className="h-4 w-4 mr-2" />
              View Hidden Transactions
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-orange-700 dark:text-orange-300 mb-3">
            <AlertTriangle className="h-4 w-4" />
            <span>
              {totalHiddenEntries} documents from {companyName} require permission to view.
              These documents are hidden due to access restrictions.
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {documentTypes.map((docType) => {
              const summary = hiddenSummary[docType.key]
              if (!summary || summary.count === 0) return null

              return (
                <div key={docType.key} className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-orange-200 dark:border-orange-900">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">{docType.icon}</span>
                    <span className="font-medium text-slate-800 dark:text-slate-200">{docType.label}</span>
                    <Badge variant="secondary" className="bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
                      {summary.count}
                    </Badge>
                  </div>

                  <div className="text-sm text-slate-600 dark:text-slate-300 space-y-1">
                    <div className="flex justify-between">
                      <span>Total Debit:</span>
                      <span className="font-medium text-red-600 dark:text-red-400">
                        {summary.total_debit.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Total Credit:</span>
                      <span className="font-medium text-green-600 dark:text-green-400">
                        {summary.total_credit.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-lg">
            <div className="flex items-center gap-2 text-blue-800 dark:text-blue-300 text-sm">
              <Eye className="h-4 w-4" />
              <span className="font-medium">Need Access?</span>
            </div>
            <p className="text-blue-700 dark:text-blue-300 text-sm mt-1">
              To view these documents, ask the other company's administrator to share them with you using Frappe's
              document sharing feature. This will allow you to see the full transaction details
              and perform proper intercompany reconciliation.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
