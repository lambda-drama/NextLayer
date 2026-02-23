"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Combobox } from "./ui/combobox"
import { Alert, AlertDescription } from "../../components/ui/alert"
import {
  ArrowLeft,
  RefreshCw,
  Package,
  ChevronDown,
  ChevronRight,
  TrendingDown,
  TrendingUp,
  Receipt,
} from "lucide-react"
import { Link } from "react-router-dom"
import { usePermissionAwareCompanies } from "../hook/usePermissionAwareCompanies"
import { useAllCompaniesForUI } from "../hook/useAllCompaniesForUI"
import {
  useImportExportExpense,
  type ImportExportEntry,
  type ImportExportTotals,
} from "../hook/useImportExportExpense"

// ─── Constants ────────────────────────────────────────────────────────────────

const CURRENCY_OPTIONS = [
  { value: "all", label: "All Currencies" },
  { value: "AED", label: "AED — UAE Dirham" },
  { value: "CDF", label: "CDF — Congolese Franc" },
  { value: "CNY", label: "CNY — Chinese Yuan" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "GBP", label: "GBP — British Pound" },
  { value: "INR", label: "INR — Indian Rupee" },
  { value: "USD", label: "USD — US Dollar" },
  { value: "XAF", label: "XAF — Central African CFA" },
  { value: "XOF", label: "XOF — West African CFA" },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Format with currency symbol — returns "—" for null/0 */
function fmtC(amount: number | null | undefined, curr: string): string {
  if (amount == null || amount === 0) return "—"
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency", currency: curr || "USD",
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${curr} ${amount.toFixed(2)}`
  }
}

/** Format with currency symbol — returns "—" for null only (0 shown) */
function fmtAny(amount: number | null | undefined, curr: string): string {
  if (amount == null) return "—"
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency", currency: curr || "USD",
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${curr} ${(amount ?? 0).toFixed(2)}`
  }
}

// ─── Journey grouping ─────────────────────────────────────────────────────────

interface JourneyGroup {
  journeyId:           string
  transitNo:           string
  displayName:         string
  importContainer:     string
  exportContainer:     string
  importBl:            string
  exportBl:            string
  destination:         string
  items:               ImportExportEntry[]
  freightStorage:      number
  doonta:              number
  totalImport:         number
  totalExport:         number
  grandTotal:          number
  companyCurrency:     string
  transactionCurrency: string
}

function groupByJourney(entries: ImportExportEntry[]): JourneyGroup[] {
  const map = new Map<string, JourneyGroup>()
  for (const row of entries) {
    const jid = row.journey_id
    if (!map.has(jid)) {
      map.set(jid, {
        journeyId:           jid,
        transitNo:           row.transit_no        || "—",
        displayName:         row.transit_display   || jid,
        importContainer:     row.import_container  || "—",
        exportContainer:     row.export_container  || "—",
        importBl:            row.import_bl         || "—",
        exportBl:            row.export_bl         || "—",
        destination:         row.destination       || "—",
        items:               [],
        freightStorage:      0,
        doonta:              0,
        totalImport:         0,
        totalExport:         0,
        grandTotal:          0,
        companyCurrency:     row.company_currency,
        transactionCurrency: row.transaction_currency,
      })
    }
    const g = map.get(jid)!
    g.items.push(row)
    g.freightStorage += (row.freight ?? 0) + (row.storage ?? 0)
    g.doonta         += row.export_charges_doonta  ?? 0
    g.totalImport    += row.additional_costs       ?? 0
    g.totalExport    += row.export_charges         ?? 0
    g.grandTotal     += row.total                  ?? 0
  }
  return Array.from(map.values())
}

// ─── Style tokens ─────────────────────────────────────────────────────────────

const TH = [
  "border border-blue-300",
  "px-2 py-2",
  "text-[11px] font-semibold text-blue-900 bg-blue-50",
  "text-center whitespace-nowrap align-middle",
].join(" ")

const TD  = "border border-blue-100 px-2 py-2 text-[11px] text-gray-700 whitespace-nowrap"
const TDR = "border border-blue-100 px-2 py-2 text-[11px] text-right font-mono text-gray-800 whitespace-nowrap"

// Journey header palette
const PAL_OPEN = { bg: "#f0f6ff", text: "#1e3a8a", sub: "#64748b", border: "#bfdbfe" }
const PAL_EVEN = { bg: "#eef2ff", text: "#1e3a8a", sub: "#6b7280", border: "#c7d2fe" }
const PAL_ODD  = { bg: "#e0e7ff", text: "#1e3a8a", sub: "#6b7280", border: "#c7d2fe" }

// ─── JourneyRow ───────────────────────────────────────────────────────────────

interface JourneyRowProps {
  group:    JourneyGroup
  index:    number
  expanded: boolean
  onToggle: () => void
}

function JourneyRow({ group, index, expanded, onToggle }: JourneyRowProps) {
  const cc  = group.companyCurrency
  const pal = expanded ? PAL_OPEN : index % 2 === 0 ? PAL_EVEN : PAL_ODD

  const cell = (extra?: React.CSSProperties) => ({
    borderColor: pal.border,
    ...extra,
  })

  // ── Collapsed journey summary row ────────────────────────────────────────
  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer select-none transition-all duration-100 hover:brightness-95"
        style={{ background: pal.bg }}
      >
        {/* [A] toggle chevron */}
        <td className="border px-2 py-3 text-center w-8" style={cell()}>
          {expanded
            ? <ChevronDown  className="h-4 w-4 mx-auto" style={{ color: pal.text }} />
            : <ChevronRight className="h-4 w-4 mx-auto" style={{ color: pal.text }} />}
        </td>

        {/* [1] S No. */}
        <td className="border px-2 py-3 text-[11px] font-bold text-center"
            style={cell({ color: pal.sub })}>
          {index + 1}
        </td>

        {/* [2] Transit No. / Description — the primary journey label */}
        <td className="border px-3 py-3 text-[11px] font-bold"
            style={cell({ color: pal.text })}>
          <div className="flex items-center gap-1.5 flex-wrap">
            <Receipt className="h-3.5 w-3.5 shrink-0 opacity-60" />
            <span>{group.transitNo !== "—" ? group.transitNo : group.displayName}</span>
            {group.transitNo !== "—" && group.displayName !== group.transitNo && (
              <span className="text-[10px] font-normal opacity-60 truncate max-w-[140px]">
                {group.displayName}
              </span>
            )}
          </div>
        </td>

        {/* [3] Item — blank (journey level) */}
        <td className="border px-2 py-3" style={cell()} />

        {/* [4] Source — blank */}
        <td className="border px-2 py-3" style={cell()} />

        {/* [5] Units — blank */}
        <td className="border px-2 py-3" style={cell()} />

        {/* [6] Price — blank */}
        <td className="border px-2 py-3" style={cell()} />

        {/* [7] Total Value — blank (sum not meaningful across currencies) */}
        <td className="border px-2 py-3" style={cell()} />

        {/* [8] Import Container */}
        <td className="border px-2 py-3 text-[11px] text-center max-w-[120px] truncate"
            style={cell({ color: pal.sub })}
            title={group.importContainer}>
          {group.importContainer}
        </td>

        {/* [9] Export Container */}
        <td className="border px-2 py-3 text-[11px] text-center max-w-[120px] truncate"
            style={cell({ color: pal.sub })}
            title={group.exportContainer}>
          {group.exportContainer}
        </td>

        {/* [10] Import B/L */}
        <td className="border px-2 py-3 text-[11px] text-center"
            style={cell({ color: pal.sub })}>
          {group.importBl}
        </td>

        {/* [11] Export B/L */}
        <td className="border px-2 py-3 text-[11px] text-center"
            style={cell({ color: pal.sub })}>
          {group.exportBl}
        </td>

        {/* [12] Destination */}
        <td className="border px-2 py-3 text-[11px] text-center font-semibold"
            style={cell({ color: "#4338ca" })}>
          {group.destination}
        </td>

        {/* [13] Freight & Storage — aggregate */}
        <td className="border px-2 py-3 text-[11px] text-right font-mono font-semibold"
            style={cell({ color: "#1d4ed8" })}>
          {fmtC(group.freightStorage, cc)}
        </td>

        {/* [14] Doonta — aggregate */}
        <td className="border px-2 py-3 text-[11px] text-right font-mono font-semibold"
            style={cell({ color: "#4338ca" })}>
          {fmtC(group.doonta, cc)}
        </td>

        {/* [15] Import Charges — aggregate */}
        <td className="border px-2 py-3 text-[11px] text-right font-mono font-bold"
            style={cell({ color: "#15803d" })}>
          {fmtC(group.totalImport, cc)}
        </td>

        {/* [16] Export Charges — aggregate */}
        <td className="border px-2 py-3 text-[11px] text-right font-mono font-bold"
            style={cell({ color: "#b91c1c" })}>
          {fmtC(group.totalExport, cc)}
        </td>

        {/* [17] Grand Total */}
        <td className="border px-2 py-3 text-[11px] text-right font-mono font-bold"
            style={{
              borderColor: "#93c5fd",
              background:  expanded ? "#dbeafe" : "#c7d2fe",
              color:       "#1e1b4b",
            }}>
          {fmtC(group.grandTotal, cc)}
        </td>
      </tr>

      {/* ── Expanded section ─────────────────────────────────────────────── */}
      {expanded && (
        <>
          {group.items.map((row, iIdx) => {
            const isFirst        = iIdx === 0
            const freightStorage = isFirst ? (row.freight ?? 0) + (row.storage ?? 0) : 0
            const doontaAmt      = isFirst ? (row.export_charges_doonta ?? 0) : 0
            const isImport       = row.source === "import" || row.source === "both"
            const isExport       = row.source === "export" || row.source === "both"
            const rowBg          = iIdx % 2 === 0 ? "#f8faff" : "#f0f5ff"

            return (
              <tr
                key={`${row.journey_id}-${row.item_code || "x"}-${iIdx}`}
                style={{ background: rowBg }}
              >
                {/* indent — left-accent bar showing this row is a child */}
                <td className="border border-blue-100 w-8"
                    style={{ background: "rgba(30,58,138,0.08)", borderLeft: "3px solid #3b82f6" }} />

                {/* # */}
                <td className="border border-blue-100 px-2 py-2 text-[11px] text-center text-gray-400 font-mono">
                  {iIdx + 1}
                </td>

                {/* Description */}
                <td className="border border-blue-100 px-2 py-2 text-[11px] text-gray-700 max-w-[200px] truncate"
                    title={row.description}>
                  {row.description || "—"}
                </td>

                {/* Item */}
                <td className="border border-blue-100 px-2 py-2 text-[11px] font-semibold text-blue-800">
                  {row.item_code || "—"}
                </td>

                {/* Source badge */}
                <td className="border border-blue-100 px-2 py-2 text-center">
                  <div className="flex items-center justify-center gap-0.5">
                    {isImport && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">
                        <TrendingDown className="h-2.5 w-2.5" />IMP
                      </span>
                    )}
                    {isExport && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-100 text-red-700 border border-red-200">
                        <TrendingUp className="h-2.5 w-2.5" />EXP
                      </span>
                    )}
                  </div>
                </td>

                {/* Units */}
                <td className={TDR}>
                  {row.units != null ? row.units.toLocaleString("en-US") : "—"}
                </td>

                {/* Price (transaction currency) */}
                <td className={TDR}>
                  {row.price != null ? fmtAny(row.price, row.transaction_currency) : "—"}
                </td>

                {/* Total Value (transaction currency) */}
                <td className={`${TDR} font-semibold`}>
                  {row.total_value != null ? fmtAny(row.total_value, row.transaction_currency) : "—"}
                </td>

                {/* Import Container */}
                <td className={`${TD} text-center text-gray-500 max-w-[100px] truncate`}
                    title={row.import_container}>
                  {row.import_container || "—"}
                </td>

                {/* Export Container */}
                <td className={`${TD} text-center text-gray-500 max-w-[100px] truncate`}
                    title={row.export_container}>
                  {row.export_container || "—"}
                </td>

                {/* Import B/L */}
                <td className={`${TD} text-center text-gray-500`}>
                  {row.import_bl || "—"}
                </td>

                {/* Export B/L */}
                <td className={`${TD} text-center text-gray-500`}>
                  {row.export_bl || "—"}
                </td>

                {/* Destination */}
                <td className={`${TD} text-center font-medium text-indigo-700`}>
                  {row.destination || "—"}
                </td>

                {/* Freight & Storage — first item only */}
                <td className="border border-blue-100 px-2 py-2 text-[11px] text-right font-mono text-blue-700">
                  {freightStorage > 0 ? fmtC(freightStorage, row.company_currency) : "—"}
                </td>

                {/* Doonta — first item only */}
                <td className="border border-blue-100 px-2 py-2 text-[11px] text-right font-mono text-indigo-600">
                  {doontaAmt > 0 ? fmtC(doontaAmt, row.company_currency) : "—"}
                </td>

                {/* Import Charges — per item */}
                <td className="border border-blue-100 px-2 py-2 text-[11px] text-right font-mono font-semibold text-emerald-700">
                  {(row.additional_costs ?? 0) > 0
                    ? fmtC(row.additional_costs, row.company_currency)
                    : "—"}
                </td>

                {/* Export Charges — per item */}
                <td className="border border-blue-100 px-2 py-2 text-[11px] text-right font-mono font-semibold text-red-600">
                  {(row.export_charges ?? 0) > 0
                    ? fmtC(row.export_charges, row.company_currency)
                    : "—"}
                </td>

                {/* Item total */}
                <td className="border border-blue-200 px-2 py-2 text-[11px] text-right font-mono font-bold text-blue-900 bg-blue-50">
                  {fmtC(row.total, row.company_currency)}
                </td>
              </tr>
            )
          })}

          {/* ── Journey subtotal ─────────────────────────────────────── */}
          <tr style={{ background: "#dbeafe", borderTop: "2px solid #93c5fd" }}>
            <td className="border border-blue-200" style={{ background: "rgba(30,58,138,0.06)" }} />
            <td colSpan={12}
                className="border border-blue-200 px-4 py-1.5 text-[10px] font-bold text-blue-600 uppercase tracking-widest text-right">
              Journey Subtotal
            </td>
            <td className="border border-blue-200 px-2 py-1.5 text-[11px] text-right font-mono font-bold text-blue-800">
              {fmtC(group.freightStorage, cc)}
            </td>
            <td className="border border-blue-200 px-2 py-1.5 text-[11px] text-right font-mono font-bold text-indigo-700">
              {fmtC(group.doonta, cc)}
            </td>
            <td className="border border-blue-200 px-2 py-1.5 text-[11px] text-right font-mono font-bold text-emerald-700">
              {fmtC(group.totalImport, cc)}
            </td>
            <td className="border border-blue-200 px-2 py-1.5 text-[11px] text-right font-mono font-bold text-red-700">
              {fmtC(group.totalExport, cc)}
            </td>
            <td className="border border-blue-300 px-2 py-1.5 text-[11px] text-right font-mono font-bold text-blue-900 bg-blue-100">
              {fmtC(group.grandTotal, cc)}
            </td>
          </tr>
        </>
      )}
    </>
  )
}

// ─── Main page component ──────────────────────────────────────────────────────

export default function ImportExportExpense() {
  const [company,       setCompany]       = useState<string>("")
  const [fromDate,      setFromDate]      = useState<string>(`${new Date().getFullYear()}-01-01`)
  const [toDate,        setToDate]        = useState<string>(new Date().toISOString().split("T")[0])
  const [currency,      setCurrency]      = useState<string>("all")
  const [item,          setItem]          = useState<string>("")
  const [hasLoadedData, setHasLoadedData] = useState(false)
  const [error,         setError]         = useState<string>("")
  const [itemOptions,   setItemOptions]   = useState<{ name: string; value: string }[]>([])
  const [expandedIds,   setExpandedIds]   = useState<Set<string>>(new Set())

  const { companies: permissionAwareCompanies } = usePermissionAwareCompanies()
  const { companies: allCompanies }             = useAllCompaniesForUI()
  const displayCompanies =
    permissionAwareCompanies.length > 0 ? permissionAwareCompanies : allCompanies

  const { data, isLoading, error: fetchError } = useImportExportExpense({
    company, item, fromDate, toDate, currency, enabled: hasLoadedData,
  })

  const entries = data?.entries ?? []
  const totals  = data?.totals  ?? ({} as ImportExportTotals)
  const groups  = groupByJourney(entries)
  const displayCurrency = entries[0]?.company_currency ?? (currency !== "all" ? currency : "USD")

  // Auto-expand all journeys when data loads
  useEffect(() => {
    if (groups.length > 0 && expandedIds.size === 0) {
      setExpandedIds(new Set(groups.map((g) => g.journeyId)))
    }
  }, [groups.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load item options for the filter combobox
  useEffect(() => {
    const fetchItems = async () => {
      try {
        const csrf = (window as unknown as { csrf_token?: string }).csrf_token || ""
        const res  = await fetch(
          "/api/method/nextlayer.next_layer.api.import_export_expense.get_items_for_import_export_filter",
          { headers: { "X-Frappe-CSRF-Token": csrf }, credentials: "include" },
        )
        const result = await res.json()
        if (result?.message?.items) setItemOptions(result.message.items)
      } catch { setItemOptions([]) }
    }
    fetchItems()
  }, [])

  const handleLoadData = () => { setError(""); setHasLoadedData(true) }

  const toggleJourney = useCallback((jid: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      next.has(jid) ? next.delete(jid) : next.add(jid)
      return next
    })
  }, [])

  const expandAll   = useCallback(() => setExpandedIds(new Set(groups.map((g) => g.journeyId))), [groups])
  const collapseAll = useCallback(() => setExpandedIds(new Set()), [])

  // Footer cell style
  const TDF = "border border-blue-300 px-2 py-2.5 text-[11px] text-right font-mono font-bold whitespace-nowrap"

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20 p-4">
      <div className="max-w-[1900px] mx-auto space-y-5">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-4">
          <Link to="/reconciliation">
            <Button variant="outline" size="sm" className="flex items-center gap-1.5 shrink-0">
              <ArrowLeft className="h-4 w-4" />Back
            </Button>
          </Link>
          <div className="flex-1 text-center">
            <h1 className="text-3xl font-bold text-blue-900 tracking-tight">
              Import &amp; Export Expense Report
            </h1>
            <p className="text-gray-500 text-sm mt-0.5">
              Per-item cost breakdown by transit journey — Purchase Invoice (LCV) ↔ Sales Invoice (SSC)
            </p>
          </div>
        </div>

        {/* ── Filters ─────────────────────────────────────────────────────── */}
        <Card className="border-blue-200 shadow-md">
          <CardHeader className="bg-gradient-to-r from-blue-700 to-blue-800 text-white rounded-t-lg py-4 px-6">
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-5 w-5" />
              Report Filters
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Company</label>
                <Combobox
                  options={displayCompanies.map((c) => ({
                    name:  ("company_name" in c ? (c as { company_name?: string }).company_name : c.name) ?? c.name,
                    value: c.name,
                  }))}
                  value={company}
                  onValueChange={setCompany}
                  placeholder="All companies"
                  searchPlaceholder="Search companies..."
                  emptyMessage="No companies found."
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Item</label>
                <Combobox
                  options={itemOptions}
                  value={item}
                  onValueChange={setItem}
                  placeholder="All items"
                  searchPlaceholder="Search items..."
                  emptyMessage="No items found."
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">From Date</label>
                <input
                  type="date" value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full p-2 border border-blue-200 rounded-md focus:border-blue-400 focus:outline-none text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">To Date</label>
                <input
                  type="date" value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full p-2 border border-blue-200 rounded-md focus:border-blue-400 focus:outline-none text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Currency</label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger className="border-blue-200 focus:border-blue-400 text-sm">
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
                  className="bg-blue-700 hover:bg-blue-800 text-white px-6 w-full h-10"
                >
                  {isLoading
                    ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Loading…</>
                    : "Load Report"}
                </Button>
              </div>

            </div>
          </CardContent>
        </Card>

        {error      && <Alert className="border-red-200 bg-red-50"><AlertDescription className="text-red-800">{error}</AlertDescription></Alert>}
        {fetchError && <Alert className="border-red-200 bg-red-50"><AlertDescription className="text-red-800">{fetchError}</AlertDescription></Alert>}

        {/* ── Report table ─────────────────────────────────────────────────── */}
        {hasLoadedData && data && (
          <Card className="border-blue-200 shadow-md overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-blue-700 to-blue-800 text-white rounded-t-lg py-4 px-6">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  Expense Report
                  {groups.length > 0 && (
                    <span className="ml-2 text-blue-300 font-normal text-sm">
                      {groups.length} journey{groups.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </CardTitle>
                {groups.length > 0 && (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={expandAll}
                      className="bg-white/10 border-white/30 text-white hover:bg-white/20 text-xs h-7">
                      Expand All
                    </Button>
                    <Button variant="outline" size="sm" onClick={collapseAll}
                      className="bg-white/10 border-white/30 text-white hover:bg-white/20 text-xs h-7">
                      Collapse All
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>

            <CardContent className="p-0">
              <div className="overflow-x-auto">
                {/*
                ═══════════════════════════════════════════════════════
                  18 COLUMNS (A + 1–17):
                  [A]  ▶/▼ toggle
                  [1]  #
                  [2]  Transit No. / Description
                  [3]  Item
                  [4]  Source
                  [5]  Units
                  [6]  Price                 (transaction currency)
                  [7]  Total Value           (transaction currency)
                  [8]  Import Container
                  [9]  Export Container
                  [10] Import B/L
                  [11] Export B/L
                  [12] Destination
                  [13] Freight & Storage     (company currency, journey-level)
                  [14] Export Charges Doonta (company currency, journey-level)
                  [15] Import Charges        (company currency, per item)
                  [16] Export Charges        (company currency, per item)
                  [17] Total                 (company currency)
                ═══════════════════════════════════════════════════════
                */}
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      {/* [A] */}
                      <th className={TH} style={{ width: 32 }} />
                      {/* [1] # */}
                      <th className={TH} style={{ width: 36 }}>#</th>
                      {/* [2] Transit No. / Description */}
                      <th className={TH} style={{ minWidth: 170 }}>Transit No. / Description</th>
                      {/* [3] Item */}
                      <th className={TH} style={{ minWidth: 110 }}>Item</th>
                      {/* [4] Source */}
                      <th className={TH} style={{ width: 74 }}>Source</th>
                      {/* [5] Units */}
                      <th className={TH} style={{ minWidth: 68 }}>Units</th>
                      {/* [6] Price */}
                      <th className={TH} style={{ minWidth: 100 }}>Price</th>
                      {/* [7] Total Value */}
                      <th className={TH} style={{ minWidth: 110 }}>Total Value</th>
                      {/* [8–12] Meta */}
                      <th className={TH} style={{ minWidth: 110 }}>Import Cont.</th>
                      <th className={TH} style={{ minWidth: 110 }}>Export Cont.</th>
                      <th className={TH} style={{ minWidth: 88 }}>Import B/L</th>
                      <th className={TH} style={{ minWidth: 88 }}>Export B/L</th>
                      <th className={TH} style={{ minWidth: 88 }}>Destination</th>
                      {/* [13] Freight & Storage */}
                      <th
                        className={TH}
                        style={{ minWidth: 110, background: "#dbeafe", color: "#1e3a8a", fontWeight: 700 }}
                      >
                        Freight &amp; Storage
                      </th>
                      {/* [14] Doonta */}
                      <th
                        className={TH}
                        style={{ minWidth: 130, background: "#e0e7ff", color: "#3730a3", fontWeight: 700 }}
                      >
                        Export Charges Doonta
                      </th>
                      {/* [15] Import Charges */}
                      <th
                        className={TH}
                        style={{ minWidth: 110, background: "#d1fae5", color: "#065f46", fontWeight: 700 }}
                      >
                        Import Charges
                      </th>
                      {/* [16] Export Charges */}
                      <th
                        className={TH}
                        style={{ minWidth: 110, background: "#fee2e2", color: "#7f1d1d", fontWeight: 700 }}
                      >
                        Export Charges
                      </th>
                      {/* [17] Total */}
                      <th
                        className={TH}
                        style={{ minWidth: 110, background: "#c7d2fe", color: "#1e1b4b", fontWeight: 700 }}
                      >
                        Total
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {groups.length === 0 ? (
                      <tr>
                        <td colSpan={18}
                            className="text-center text-gray-500 py-14 border border-gray-200 text-sm">
                          No data found. Ensure Purchase Invoices and Sales Invoices
                          have <strong>Is Export Sale</strong> checked.
                        </td>
                      </tr>
                    ) : (
                      groups.map((group, idx) => (
                        <JourneyRow
                          key={group.journeyId}
                          group={group}
                          index={idx}
                          expanded={expandedIds.has(group.journeyId)}
                          onToggle={() => toggleJourney(group.journeyId)}
                        />
                      ))
                    )}
                  </tbody>

                  {/* ── Grand totals footer ──────────────────────────────── */}
                  {groups.length > 0 && (
                    <tfoot>
                      <tr style={{ background: "#1e3a8a" }}>
                        {/* Label spanning [A] through [12] = 13 cols */}
                        <td
                          colSpan={13}
                          className="border border-blue-700 px-4 py-2.5 text-xs font-bold text-white text-right uppercase tracking-widest"
                        >
                          Grand Totals
                        </td>
                        {/* [13] Freight & Storage */}
                        <td className={`${TDF} bg-blue-100 text-blue-900 border-blue-300`}>
                          {fmtC((totals.total_freight ?? 0) + (totals.total_storage ?? 0), displayCurrency)}
                        </td>
                        {/* [14] Doonta */}
                        <td className={`${TDF} bg-indigo-50 text-indigo-900 border-indigo-200`}>
                          {fmtC(totals.total_export_charges_doonta, displayCurrency)}
                        </td>
                        {/* [15] Import Charges */}
                        <td className={`${TDF} bg-emerald-50 text-emerald-900 border-emerald-200`}>
                          {fmtC(totals.total_additional_costs, displayCurrency)}
                        </td>
                        {/* [16] Export Charges */}
                        <td className={`${TDF} bg-red-50 text-red-900 border-red-200`}>
                          {fmtC(totals.total_export_charges, displayCurrency)}
                        </td>
                        {/* [17] Grand Total */}
                        <td className={`${TDF} bg-blue-200 text-blue-950 border-blue-400 text-sm`}>
                          {fmtC(totals.grand_total, displayCurrency)}
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