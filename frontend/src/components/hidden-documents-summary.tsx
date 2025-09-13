"use client"

import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { Badge } from "./ui/badge"
import { AlertTriangle, Lock, Eye } from "lucide-react"

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
}

export default function HiddenDocumentsSummary({
  hiddenSummary,
  totalHiddenEntries,
  companyName
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
    <Card className="border-orange-200 bg-orange-50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-orange-800">
          <Lock className="h-5 w-5" />
          Documents Requiring Permission to View
          <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-300">
            {totalHiddenEntries} hidden
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-orange-700 mb-3">
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
                <div key={docType.key} className="bg-white rounded-lg p-3 border border-orange-200">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">{docType.icon}</span>
                    <span className="font-medium text-gray-800">{docType.label}</span>
                    <Badge variant="secondary" className="bg-gray-100 text-gray-700">
                      {summary.count}
                    </Badge>
                  </div>

                  <div className="text-sm text-gray-600 space-y-1">
                    <div className="flex justify-between">
                      <span>Total Debit:</span>
                      <span className="font-medium text-red-600">
                        {summary.total_debit.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Total Credit:</span>
                      <span className="font-medium text-green-600">
                        {summary.total_credit.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center gap-2 text-blue-800 text-sm">
              <Eye className="h-4 w-4" />
              <span className="font-medium">Need Access?</span>
            </div>
            <p className="text-blue-700 text-sm mt-1">
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
