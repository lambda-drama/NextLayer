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
import {
  useImportExportExpense,
  type ImportExportEntry,
  type ImportExportTotals,
} from "../hook/useImportExportExpense"

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
  const [company,       setCompany]       = useState<string>("")
  const [fromDate,      setFromDate]      = useState<string>(`${new Date().getFullYear()}-01-01`)
  const [toDate,        setToDate]        = useState<string>(new Date().toISOString().split("T")[0])
  const [currency,      setCurrency]      = useState<string>("all")
  const [item,          setItem]          = useState<string>("")
  const [hasLoadedData, setHasLoadedData] = useState(false)
  const [error,         setError]         = useState<string>("")
  const [itemOptions,   setItemOptions]   = useState<{ name: string; value: string }[]>([])

  const { companies: permissionAwareCompanies } = usePermissionAwareCompanies()
  const { companies: allCompanies }             = useAllCompaniesForUI()
  const displayCompanies =
    permissionAwareCompanies.length > 0 ? permissionAwareCompanies : allCompanies

  const { data, isLoading, error: fetchError } = useImportExportExpense({
    company, item, fromDate, toDate, currency, enabled: hasLoadedData,
  })

  useEffect(() => {
    const fetchItems = async () => {
      try {
        const csrfToken = (window as unknown as { csrf_token?: string }).csrf_token || ""
        const res = await fetch(
          "/api/method/nextlayer.next_layer.api.import_export_expense.get_items_for_import_export_filter",
          { headers: { "X-Frappe-CSRF-Token": csrfToken }, credentials: "include" },
        )
        const result = await res.json()
        if (result?.message?.items) setItemOptions(result.message.items)
      } catch {
        setItemOptions([])
      }
    }
    fetchItems()
  }, [])

  const handleLoadData = () => { setError(""); setHasLoadedData(true) }

  const fmt = (amount: number | null | undefined, curr: string) => {
    if (amount == null) return "—"
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: curr || "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  }

  const displayCurrency =
    data?.entries?.[0]?.company_currency || (currency !== "all" ? currency : "USD")
  const displayTransactionCurrency =
    data?.entries?.[0]?.transaction_currency || "USD"
  const entries = data?.entries ?? []
  const totals  = data?.totals  ?? ({} as ImportExportTotals)

  // ─── Cell style tokens ────────────────────────────────────────────────────
  // Standalone header spanning both header rows
  const thBase =
    "border border-blue-300 px-2 py-2 text-xs font-semibold text-blue-900 bg-blue-50 text-center whitespace-nowrap align-middle"
  // Coloured group header (row 1, colSpan)
  const thGroup =
    "border border-blue-400 px-2 py-2 text-xs font-bold text-white text-center whitespace-nowrap tracking-wide uppercase"
  // Sub-header (row 2, under a group)
  const thSub =
    "border border-blue-300 px-2 py-1.5 text-xs font-semibold text-blue-800 bg-blue-100 text-center whitespace-nowrap"
  const tdBase = "border border-gray-200 px-2 py-2 text-xs text-gray-700 whitespace-nowrap"
  const tdNum  = "border border-gray-200 px-2 py-2 text-xs text-right font-mono text-gray-800 whitespace-nowrap"
  const tdTot  = "border border-blue-300 px-2 py-2 text-xs text-right font-mono font-semibold text-blue-900 bg-blue-50 whitespace-nowrap"

  // Total visible columns: 22 (21 Excel + Transit No.)
  const TOTAL_COLS = 22

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50 p-4">
      <div className="max-w-[1800px] mx-auto space-y-6">

        {/* ── Page header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="text-center space-y-2 flex-1">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-blue-800 bg-clip-text text-transparent">
              Import &amp; Export Expense Report
            </h1>
            <p className="text-gray-600 text-lg">
              Item-based import and export costs by transit journey
            </p>
          </div>
          <Link to="/reconciliation">
            <Button variant="outline" className="flex items-center space-x-2">
              <ArrowLeft className="h-4 w-4" />
              <span>Back</span>
            </Button>
          </Link>
        </div>

        {/* ── Filters ─────────────────────────────────────────────────────── */}
        <Card className="border-blue-200 shadow-lg">
          <CardHeader className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg p-6">
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Report Selection
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Company</label>
                <Combobox
                  options={displayCompanies.map((c) => ({
                    name: ("company_name" in c
                      ? (c as { company_name?: string }).company_name
                      : c.name) ?? c.name,
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
                <label className="text-sm font-medium text-gray-700">Item</label>
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
                  className="w-full p-2 border border-blue-200 rounded-md focus:border-blue-400 focus:outline-none text-sm"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">To Date</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full p-2 border border-blue-200 rounded-md focus:border-blue-400 focus:outline-none text-sm"
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
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
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
                  {isLoading
                    ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Loading...</>
                    : "Load Report"}
                </Button>
              </div>

            </div>
          </CardContent>
        </Card>

        {error      && <Alert className="border-red-200 bg-red-50"><AlertDescription className="text-red-800">{error}</AlertDescription></Alert>}
        {fetchError && <Alert className="border-red-200 bg-red-50"><AlertDescription className="text-red-800">{fetchError}</AlertDescription></Alert>}

        {/* ── Report table ────────────────────────────────────────────────── */}
        {hasLoadedData && data && (
          <Card className="border-blue-200 shadow-lg overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg">
              <CardTitle>Import &amp; Export Expense Report</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">

                  {/* ══════════════════════════════════════════════════════
                      EXACT EXCEL COLUMN ORDER — 21 COLUMNS

                      Row 1 standalone (rowSpan=2):
                        [1]  S NO.
                        [2]  Description
                        [3]  Item
                        [4]  Units
                        [5]  Price
                        [6]  Total Value
                        [7]  Import Container
                        [8]  Export Container
                        [9]  Import B/L
                        [10] Export B/L
                        [11] Destination
                        [12] Freight & Storage
                        [13] Export Charges Doonta
                        [16] Jebel Ali Expenses
                        [19] Export Transportation
                        [20] ECTN
                        [21] Total

                      Row 1 groups (colSpan=2):
                        [14-15] Import Charges
                        [17-18] Export Charges

                      Row 2 sub-headers:
                        Joint Line | Harvinder  (×2)
                  ══════════════════════════════════════════════════════ */}
                  <thead>

                    {/* ── Row 1 ───────────────────────────────────────── */}
                    <tr>
                      {/* [1–3] Standalone */}
                      <th rowSpan={2} className={thBase}>#</th>
                      <th rowSpan={2} className={thBase}>Description</th>
                      <th rowSpan={2} className={thBase}>Item</th>

                      {/* [4–6] Standalone */}
                      <th rowSpan={2} className={thBase}>Units</th>
                      <th rowSpan={2} className={thBase}>Price</th>
                      <th rowSpan={2} className={thBase}>Total Value</th>

                      {/* [7–11] Standalone */}
                      <th rowSpan={2} className={thBase} style={{ maxWidth: 140 }}>Import Cont.</th>
                      <th rowSpan={2} className={thBase} style={{ maxWidth: 140 }}>Export Cont.</th>
                      <th rowSpan={2} className={thBase}>Import B/L</th>
                      <th rowSpan={2} className={thBase}>Export B/L</th>
                      <th rowSpan={2} className={thBase}>Destination</th>

                      {/* [12] Transit No — tracking reference */}
                      <th
                        rowSpan={2}
                        className={thBase}
                        style={{ backgroundColor: "#fef9c3", color: "#713f12", fontWeight: 700 }}
                      >
                        Transit No.
                      </th>

                      {/* [12] Freight & Storage — single col */}
                      <th
                        rowSpan={2}
                        className={thBase}
                        style={{ backgroundColor: "#bfdbfe", color: "#1e3a8a", fontWeight: 700 }}
                      >
                        Freight &amp; Storage
                      </th>

                      {/* [13] Export Charges Doonta — single col */}
                      <th
                        rowSpan={2}
                        className={thBase}
                        style={{ backgroundColor: "#dbeafe", color: "#1e3a8a", fontWeight: 700 }}
                      >
                        Export Charges Doonta
                      </th>

                      {/* [14–15] Import Charges group */}
                      <th
                        colSpan={2}
                        className={thGroup}
                        style={{ backgroundColor: "#2563eb", borderBottom: "2px solid #1d4ed8" }}
                      >
                        Import Charges
                      </th>

                      {/* [16] Jebel Ali Expenses — single col */}
                      <th
                        rowSpan={2}
                        className={thBase}
                        style={{ backgroundColor: "#eff6ff", color: "#1e3a8a", fontWeight: 700 }}
                      >
                        Jebel Ali Expenses
                      </th>

                      {/* [17–18] Export Charges group */}
                      <th
                        colSpan={2}
                        className={thGroup}
                        style={{ backgroundColor: "#1e40af", borderBottom: "2px solid #1e3a8a" }}
                      >
                        Export Charges
                      </th>

                      {/* [19–20] Standalone */}
                      <th
                        rowSpan={2}
                        className={thBase}
                        style={{ backgroundColor: "#eff6ff", color: "#1e3a8a", fontWeight: 700 }}
                      >
                        Export Transportation
                      </th>
                      <th
                        rowSpan={2}
                        className={thBase}
                        style={{ backgroundColor: "#eff6ff", color: "#1e3a8a", fontWeight: 700 }}
                      >
                        ECTN
                      </th>

                      {/* [21] Total */}
                      <th rowSpan={2} className={`${thBase} font-bold`}>Total</th>
                    </tr>

                    {/* ── Row 2: sub-headers ──────────────────────────── */}
                    <tr>
                      {/* Import Charges sub-cols [14–15] */}
                      <th className={thSub}>Joint Line</th>
                      <th className={thSub}>Harvinder</th>
                      {/* Export Charges sub-cols [17–18] */}
                      <th className={thSub}>Joint Line</th>
                      <th className={thSub}>Harvinder</th>
                    </tr>

                  </thead>

                  {/* ══════════ BODY ════════════════════════════════════ */}
                  <tbody>
                    {entries.length === 0 ? (
                      <tr>
                        <td
                          colSpan={TOTAL_COLS}
                          className="text-center text-gray-500 py-10 border border-gray-200 text-sm"
                        >
                          No data for the selected filters. Ensure Purchase Invoices (import) and
                          Sales Invoices (export) have &quot;Is Export Sale&quot; ticked.
                        </td>
                      </tr>
                    ) : (
                      entries.map((row: ImportExportEntry, index: number) => {
                        const rowClass       = index % 2 === 0 ? "bg-white" : "bg-gray-50"
                        const freightStorage = (row.freight ?? 0) + (row.storage ?? 0)

                        return (
                          <tr
                            key={`${row.journey_id}-${row.item_code || "j"}-${index}`}
                            className={`${rowClass} hover:bg-blue-50/60 transition-colors`}
                          >
                            {/* [1] S NO. */}
                            <td className={`${tdBase} text-center text-gray-400`}>{index + 1}</td>

                            {/* [2–3] Description / Item */}
                            <td className={tdBase}>{row.description || "—"}</td>
                            <td className={`${tdBase} font-medium`}>{row.item_code || "—"}</td>

                            {/* [4–6] Units / Price / Total Value — transaction currency */}
                            <td className={`${tdNum}`}>{row.units != null ? row.units : "—"}</td>
                            <td className={`${tdNum}`}>{row.price       != null ? fmt(row.price,       row.transaction_currency) : "—"}</td>
                            <td className={`${tdNum}`}>{row.total_value != null ? fmt(row.total_value, row.transaction_currency) : "—"}</td>

                            {/* [7–11] Containers / BLs / Destination */}
                            <td
                              className={tdBase}
                              style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }}
                              title={row.import_container || ""}
                            >
                              {row.import_container || "—"}
                            </td>
                            <td
                              className={tdBase}
                              style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }}
                              title={row.export_container || ""}
                            >
                              {row.export_container || "—"}
                            </td>
                            <td className={tdBase}>{row.import_bl   || "—"}</td>
                            <td className={tdBase}>{row.export_bl   || "—"}</td>
                            <td className={tdBase}>{row.destination || "—"}</td>

                            {/* Transit No. */}
                            <td
                              className={tdBase}
                              style={{ backgroundColor: "#fefce8", fontWeight: 500, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}
                              title={row.transit_no || ""}
                            >
                              {row.transit_no || "—"}
                            </td>

                            {/* [13] Freight & Storage combined — company currency */}
                            <td className={tdNum}>
                              {freightStorage > 0 ? fmt(freightStorage, row.company_currency) : "—"}
                            </td>

                            {/* [14] Export Charges Doonta — company currency */}
                            <td className={tdNum}>{fmt(row.export_charges_doonta, row.company_currency)}</td>

                            {/* [15–16] Import Charges — company currency */}
                            <td className={tdNum}>{fmt(row.additional_costs, row.company_currency)}</td>
                            <td className={tdNum}>{fmt(row.import_havinder,   row.company_currency)}</td>

                            {/* [17] Jebel Ali — company currency */}
                            <td className={tdNum}>{fmt(row.jebel_ali, row.company_currency)}</td>

                            {/* [18–19] Export Charges — company currency */}
                            <td className={tdNum}>{fmt(row.export_charges,  row.company_currency)}</td>
                            <td className={tdNum}>{fmt(row.export_havinder, row.company_currency)}</td>

                            {/* [20] Export Transportation — company currency */}
                            <td className={tdNum}>{fmt(row.export_transportation, row.company_currency)}</td>

                            {/* [21] ECTN — company currency */}
                            <td className={tdNum}>{fmt(row.ectn, row.company_currency)}</td>

                            {/* [22] Total — company currency */}
                            <td className={`${tdNum} font-semibold text-blue-900 bg-blue-50/50`}>
                              {fmt(row.total, row.company_currency)}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>

                  {/* ══════════ TOTALS FOOTER ═══════════════════════════ */}
                  {entries.length > 0 && (
                    <tfoot>
                      <tr>
                        {/* Label spanning S.No + Desc + Item + Units + Price + TotalVal + 5 meta + Transit No = 12 */}
                        <td
                          colSpan={12}
                          className="border border-blue-500 bg-blue-700 px-3 py-2 text-xs font-bold text-white text-right tracking-wide uppercase"
                        >
                          Totals
                        </td>

                        {/* [12] Freight & Storage */}
                        <td className={`${tdTot} bg-blue-100`}>
                          {fmt(
                            (totals.total_freight ?? 0) + (totals.total_storage ?? 0),
                            displayCurrency,
                          )}
                        </td>

                        {/* [13] Export Charges Doonta */}
                        <td className={`${tdTot} bg-blue-100`}>
                          {fmt(totals.total_export_charges_doonta, displayCurrency)}
                        </td>

                        {/* [14–15] Import Charges */}
                        <td className={`${tdTot} bg-blue-100`}>
                          {fmt(totals.total_additional_costs, displayCurrency)}
                        </td>
                        <td className={`${tdTot} bg-blue-100`}>
                          {fmt(totals.total_import_havinder, displayCurrency)}
                        </td>

                        {/* [16] Jebel Ali */}
                        <td className={`${tdTot} bg-blue-100`}>
                          {fmt(totals.total_jebel_ali, displayCurrency)}
                        </td>

                        {/* [17–18] Export Charges */}
                        <td className={`${tdTot} bg-blue-100`}>
                          {fmt(totals.total_export_charges, displayCurrency)}
                        </td>
                        <td className={`${tdTot} bg-blue-100`}>
                          {fmt(totals.total_export_havinder, displayCurrency)}
                        </td>

                        {/* [19] Export Transportation */}
                        <td className={`${tdTot} bg-blue-100`}>
                          {fmt(totals.total_export_transportation, displayCurrency)}
                        </td>

                        {/* [20] ECTN */}
                        <td className={`${tdTot} bg-blue-100`}>
                          {fmt(totals.total_ectn, displayCurrency)}
                        </td>

                        {/* [21] Grand Total */}
                        <td className="border border-blue-400 px-2 py-2 text-xs text-right font-bold font-mono text-blue-900 bg-blue-200 whitespace-nowrap">
                          {fmt(totals.grand_total, displayCurrency)}
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