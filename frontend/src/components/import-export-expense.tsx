"use client"

import { useState, useEffect } from "react"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Combobox } from "./ui/combobox"
import { Alert, AlertDescription } from "../../components/ui/alert"
import { ArrowLeft, RefreshCw, Package } from "lucide-react"
import { Link } from "react-router-dom"
import { usePermissionAwareCompanies } from "../hook/usePermissionAwareCompanies"
import { useAllCompaniesForUI } from "../hook/useAllCompaniesForUI"
import { useImportExportExpense, type ImportExportEntry, type ImportExportTotals } from "../hook/useImportExportExpense"

const CURRENCY_OPTIONS = [
  { value: "all", label: "All Currencies" },
  { value: "AED", label: "AED (UAE Dirham)" },
  { value: "CDF", label: "CDF (Congolese Franc)" },
  { value: "CNY", label: "CNY (Chinese Yuan)" },
  { value: "EUR", label: "EUR (Euro)" },
  { value: "GBP", label: "GBP (British Pound)" },
  { value: "INR", label: "INR (Indian Rupee)" },
  { value: "USD", label: "USD (US Dollar)" },
  { value: "XAF", label: "XAF (Central African CFA Franc)" },
  { value: "XOF", label: "XOF (West African CFA Franc)" },
]

export default function ImportExportExpense() {
  const [company, setCompany] = useState<string>("")
  const [fromDate, setFromDate] = useState<string>(`${new Date().getFullYear()}-01-01`)
  const [toDate, setToDate] = useState<string>(new Date().toISOString().split("T")[0])
  const [currency, setCurrency] = useState<string>("all")
  const [item, setItem] = useState<string>("")
  const [hasLoadedData, setHasLoadedData] = useState(false)
  const [error, setError] = useState<string>("")
  const [itemOptions, setItemOptions] = useState<{ name: string; value: string }[]>([])

  const { companies: permissionAwareCompanies } = usePermissionAwareCompanies()
  const { companies: allCompanies } = useAllCompaniesForUI()
  const displayCompanies = permissionAwareCompanies.length > 0 ? permissionAwareCompanies : allCompanies

  const { data, isLoading, error: fetchError } = useImportExportExpense({
    company,
    item,
    fromDate,
    toDate,
    currency,
    enabled: hasLoadedData,
  })

  useEffect(() => {
    const fetchItems = async () => {
      try {
        const csrfToken = (window as unknown as { csrf_token?: string }).csrf_token || ""
        const res = await fetch("/api/method/nextlayer.next_layer.api.import_export_expense.get_items_for_import_export_filter", {
          headers: { "X-Frappe-CSRF-Token": csrfToken },
          credentials: "include",
        })
        const result = await res.json()
        if (result?.message?.items) {
          setItemOptions(result.message.items)
        }
      } catch {
        setItemOptions([])
      }
    }
    fetchItems()
  }, [])

  const handleLoadData = () => {
    setError("")
    setHasLoadedData(true)
  }

  const formatCurrency = (amount: number | null | undefined, currencyCode: string) => {
    if (amount == null) return "—"
    const curr = currencyCode || "USD"
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: curr,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  }

  const displayCurrency = data?.entries?.[0]?.currency || (currency !== "all" ? currency : "USD")
  const entries = data?.entries ?? []
  const totals = data?.totals ?? ({} as ImportExportTotals)

  // ─── Shared header cell styles ────────────────────────────────────────────
  const thBase =
    "border border-blue-300 px-3 py-2 text-xs font-semibold text-blue-900 bg-blue-50 text-center whitespace-nowrap"
  const thGroup =
    "border border-blue-400 px-3 py-2 text-xs font-bold text-white bg-blue-600 text-center whitespace-nowrap tracking-wide uppercase"
  const thSub =
    "border border-blue-300 px-3 py-1.5 text-xs font-semibold text-blue-800 bg-blue-100 text-center whitespace-nowrap"
  const tdBase = "border border-gray-200 px-3 py-2 text-sm text-gray-700 whitespace-nowrap"
  const tdNum  = "border border-gray-200 px-3 py-2 text-sm text-right font-mono text-gray-800 whitespace-nowrap"
  const tdTot  = "border border-blue-300 px-3 py-2 text-sm text-right font-mono font-semibold text-blue-900 bg-blue-50 whitespace-nowrap"

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50 p-4">
      <div className="max-w-8xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="text-center space-y-2 flex-1">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-blue-800 bg-clip-text text-transparent">
              Import & Export Expense Report
            </h1>
            <p className="text-gray-600 text-lg">
              Item-based import and export costs by transit journey — one row per item with total import and export funds
            </p>
          </div>
          <div className="flex space-x-2">
            <Link to="/reconciliation">
              <Button variant="outline" className="flex items-center space-x-2">
                <ArrowLeft className="h-4 w-4" />
                <span>Back to Reconciliation</span>
              </Button>
            </Link>
          </div>
        </div>

        {/* Filters */}
        <Card className="border-blue-200 shadow-lg">
          <CardHeader className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg p-6">
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Report Selection
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 w-full">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 w-full">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Company (optional)</label>
                <Combobox
                  options={displayCompanies.map((c) => ({
                    name: ("company_name" in c ? (c as { company_name?: string }).company_name : c.name) ?? c.name,
                    value: c.name,
                  }))}
                  value={company}
                  onValueChange={setCompany}
                  placeholder="All companies"
                  searchPlaceholder="Search companies..."
                  emptyMessage="No companies found."
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Item (optional)</label>
                <Combobox
                  options={itemOptions}
                  value={item}
                  onValueChange={setItem}
                  placeholder="All items"
                  searchPlaceholder="Search items..."
                  emptyMessage="No items found."
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
                  <SelectTrigger className="border-blue-200 focus:border-blue-400">
                    <SelectValue placeholder="All Currencies" />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button
                  onClick={handleLoadData}
                  disabled={isLoading}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-6 w-full"
                >
                  {isLoading ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    "Load Report"
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {error && (
          <Alert className="border-red-200 bg-red-50">
            <AlertDescription className="text-red-800">{error}</AlertDescription>
          </Alert>
        )}
        {fetchError && (
          <Alert className="border-red-200 bg-red-50">
            <AlertDescription className="text-red-800">{fetchError}</AlertDescription>
          </Alert>
        )}

        {/* Data Table — Excel-style with two-row grouped headers */}
        {hasLoadedData && data && (
          <Card className="border-blue-200 shadow-lg overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg">
              <CardTitle>Import & Export Expense Report</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  {/* ═══════════════════════════════════════════════════════════
                      TWO-ROW HEADER
                      Row 1: standalone cells (rowSpan=2) + group title cells (colSpan)
                      Row 2: sub-header cells under each group
                  ═══════════════════════════════════════════════════════════ */}
                  <thead>
                    {/* ── Row 1 ── */}
                    <tr>
                      {/* Standalone columns — span both header rows */}
                      <th rowSpan={2} className={`${thBase} align-middle`}>Description</th>
                      <th rowSpan={2} className={`${thBase} align-middle`}>Item</th>
                      <th rowSpan={2} className={`${thBase} align-middle`}>Transit / Journey</th>
                      <th rowSpan={2} className={`${thBase} align-middle`}>Date</th>
                      <th rowSpan={2} className={`${thBase} align-middle`} style={{ width: "90px", maxWidth: "90px" }}>Import Cont.</th>
                      <th rowSpan={2} className={`${thBase} align-middle`} style={{ width: "90px", maxWidth: "90px" }}>Export Cont.</th>
                      <th rowSpan={2} className={`${thBase} align-middle`}>Export B/L</th>

                      {/* ── IMPORT CHARGES group ── */}
                      <th
                        colSpan={2}
                        className={thGroup}
                        style={{ borderBottom: "2px solid #1d4ed8" }}
                      >
                        Import Charges
                      </th>

                      {/* ── EXPORT CHARGES group ── */}
                      <th
                        colSpan={3}
                        className={thGroup}
                        style={{ borderBottom: "2px solid #1d4ed8", backgroundColor: "#1e40af" }}
                      >
                        Export Charges
                      </th>

                      {/* Total — spans both rows */}
                      <th rowSpan={2} className={`${thBase} align-middle font-bold`}>Total</th>
                    </tr>

                    {/* ── Row 2: sub-headers ── */}
                    <tr>
                      {/* IMPORT CHARGES sub-cols */}
                      <th className={thSub}>Joint Line</th>
                      <th className={thSub}>Harvinder</th>

                      {/* EXPORT CHARGES sub-cols */}
                      <th className={thSub}>Freight</th>
                      <th className={thSub}>Storage</th>
                      <th className={thSub}>Export Charges</th>
                    </tr>
                  </thead>

                  {/* ═══ BODY ═══════════════════════════════════════════════ */}
                  <tbody>
                    {entries.length === 0 ? (
                      <tr>
                        <td
                          colSpan={13}
                          className="text-center text-gray-500 py-10 border border-gray-200"
                        >
                          No data for the selected filters. Ensure Purchase Invoices (import) and Sales Invoices (export) have &quot;Is Export Sale&quot; ticked.
                        </td>
                      </tr>
                    ) : (
                      entries.map((row: ImportExportEntry, index: number) => {
                        const rowClass = index % 2 === 0 ? "bg-white" : "bg-gray-50"
                        return (
                          <tr
                            key={`${row.journey_id}-${row.item_code || "j"}-${index}`}
                            className={`${rowClass} hover:bg-blue-50/60 transition-colors`}
                          >
                            <td className={tdBase}>{row.description || "—"}</td>
                            <td className={`${tdBase} font-medium`}>{row.item_code || row.item_name || "—"}</td>
                            <td className={tdBase}>{row.transit_display || "—"}</td>
                            <td className={tdBase}>{row.posting_date || "—"}</td>
                            <td className={tdBase} style={{ width: "90px", maxWidth: "90px", overflow: "hidden", textOverflow: "ellipsis" }} title={row.import_container || ""}>{row.import_container || "—"}</td>
                            <td className={tdBase} style={{ width: "90px", maxWidth: "90px", overflow: "hidden", textOverflow: "ellipsis" }} title={row.export_container || ""}>{row.export_container || "—"}</td>
                            <td className={tdBase}>{row.export_bl || "—"}</td>

                            {/* IMPORT CHARGES: Joint Line = additional_costs, Harvinder = — */}
                            <td className={tdNum}>{formatCurrency(row.additional_costs, row.currency)}</td>
                            <td className={tdNum}>—</td>

                            {/* EXPORT CHARGES: Freight | Storage | Export Charges */}
                            <td className={tdNum}>{formatCurrency(row.freight, row.currency)}</td>
                            <td className={tdNum}>{formatCurrency(row.storage, row.currency)}</td>
                            <td className={tdNum}>{formatCurrency(row.export_charges, row.currency)}</td>

                            {/* Total */}
                            <td className={`${tdNum} font-semibold text-blue-900 bg-blue-50/50`}>
                              {formatCurrency(row.total, row.currency)}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>

                  {/* ═══ TOTALS FOOTER ══════════════════════════════════════ */}
                  {entries.length > 0 && (
                    <tfoot>
                      <tr className="bg-blue-700 text-white">
                        <td
                          colSpan={7}
                          className="border border-blue-500 px-3 py-2 text-sm font-bold text-right tracking-wide uppercase"
                        >
                          Totals
                        </td>

                        {/* IMPORT CHARGES totals */}
                        <td className={`${tdTot} bg-blue-100`}>
                          {formatCurrency(totals.total_additional_costs, displayCurrency)}
                        </td>
                        <td className={`${tdTot} bg-blue-100`}>—</td>

                        {/* EXPORT CHARGES totals */}
                        <td className={`${tdTot} bg-blue-100`}>
                          {formatCurrency(totals.total_freight, displayCurrency)}
                        </td>
                        <td className={`${tdTot} bg-blue-100`}>
                          {formatCurrency(totals.total_storage, displayCurrency)}
                        </td>
                        <td className={`${tdTot} bg-blue-100`}>
                          {formatCurrency(totals.total_export_charges, displayCurrency)}
                        </td>

                        {/* Grand total */}
                        <td className="border border-blue-400 px-3 py-2 text-sm text-right font-bold font-mono text-blue-900 bg-blue-200 whitespace-nowrap">
                          {formatCurrency(totals.grand_total, displayCurrency)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}