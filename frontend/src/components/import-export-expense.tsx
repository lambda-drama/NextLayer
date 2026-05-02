"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import type React from "react"
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
  ExternalLink,
} from "lucide-react"
import { Link } from "react-router-dom"
import { usePermissionAwareCompanies } from "../hook/usePermissionAwareCompanies"
import { useAllCompaniesForUI } from "../hook/useAllCompaniesForUI"
import {
  useImportExportExpense,
  type ImportExportEntry,
  type ImportExportTotals,
  type JourneyBreakdown,
  type DistributionLine,
  type TransitInvoiceRef,
} from "../hook/useImportExportExpense"

// ─── Constants ────────────────────────────────────────────────────────────────

const CURRENCY_OPTIONS = [
  { value: "all", label: "All Currencies (no conversion)" },
  { value: "AED", label: "AED — UAE Dirham" },
  { value: "CDF", label: "CDF — Congolese Franc" },
  { value: "CNY", label: "CNY — Chinese Yuan" },
  { value: "DJF", label: "DJF — Djiboutian Franc" },
  { value: "ETB", label: "ETB — Ethiopian Birr" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "GBP", label: "GBP — British Pound" },
  { value: "GNF", label: "GNF — Guinean Franc" },
  { value: "INR", label: "INR — Indian Rupee" },
  { value: "KES", label: "KES — Kenyan Shilling" },
  { value: "MZN", label: "MZN — Mozambican Metical" },
  { value: "NGN", label: "NGN — Nigerian Naira" },
  { value: "SAR", label: "SAR — Saudi Riyal" },
  { value: "TZS", label: "TZS — Tanzanian Shilling" },
  { value: "USD", label: "USD — US Dollar" },
  { value: "XAF", label: "XAF — Central African CFA" },
  { value: "XOF", label: "XOF — West African CFA" },
]

// ─── ERPNext desk URL ──────────────────────────────────────────────────────────

function deskDocUrl(doctype: string, name: string): string {
  const slug = doctype.trim().toLowerCase().replace(/\s+/g, "-")
  if (typeof window === "undefined") return `/app/${slug}/${encodeURIComponent(name)}`
  return `${window.location.origin}/app/${slug}/${encodeURIComponent(name)}`
}

// ─── Formatting (cached formatters — avoid new Intl.NumberFormat per cell) ────

const currencyFormatterCache = new Map<string, Intl.NumberFormat>()

function getCurrencyFormatter(curr: string): Intl.NumberFormat {
  const key = curr || "USD"
  let nf = currencyFormatterCache.get(key)
  if (!nf) {
    try {
      nf = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: key,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    } catch {
      nf = new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    }
    currencyFormatterCache.set(key, nf)
  }
  return nf
}

function fmt(amount: number | null | undefined, curr: string, skipZero = true): string {
  if (amount == null || isNaN(amount as number) || (skipZero && amount === 0)) return "—"
  try {
    return getCurrencyFormatter(curr).format(amount)
  } catch {
    return `${curr} ${(amount ?? 0).toFixed(2)}`
  }
}

/** Keeps expanded journey breakdowns from rendering thousands of DOM nodes */
const MAX_DISTRIBUTION_LINES = 48

type DetailVariant = "merged" | "sales" | "purchase"

function expandVariants(row: ImportExportEntry, invoiceLayout: string): DetailVariant[] {
  if (invoiceLayout === "separated" && row.source === "both") return ["sales", "purchase"]
  return ["merged"]
}

// ─── Transit invoice pills ────────────────────────────────────────────────────

function TransitInvoiceLinks({ refs }: { refs: TransitInvoiceRef[] }) {
  if (!refs?.length)
    return <span className="text-[10px] text-gray-400">—</span>
  return (
    <div className="flex flex-wrap gap-1 items-center justify-start">
      {refs.map((r) => {
        const isSi = r.doctype === "Sales Invoice"
        const href = deskDocUrl(r.doctype, r.name)
        return (
          <a
            key={`${r.doctype}-${r.name}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold border max-w-[150px] truncate transition-colors ${
              isSi
                ? "bg-blue-700 text-white border-blue-800 hover:bg-blue-800 shadow-sm"
                : "bg-sky-100 text-sky-900 border-sky-400/70 hover:bg-sky-200"
            }`}
            title={`Open ${r.doctype} ${r.name} in ERPNext`}
          >
            {isSi ? "SI" : "PI"}
            <span className="truncate font-mono font-semibold">{r.name}</span>
            <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-70" />
          </a>
        )
      })}
    </div>
  )
}

function ChargeStack({
  sectionTitle,
  itemChargesTotal,
  lines,
  currency,
  accent,
}: {
  sectionTitle: string
  itemChargesTotal: number
  lines: DistributionLine[]
  currency: string
  accent: "import" | "export"
}) {
  const border =
    accent === "import" ? "border-emerald-200 bg-emerald-50/40" : "border-red-200 bg-red-50/40"
  const titleCls =
    accent === "import" ? "text-emerald-900" : "text-red-900"

  return (
    <div className={`rounded-md border px-1.5 py-1 space-y-1 ${border}`}>
      <div className={`text-[9px] font-bold uppercase tracking-wide ${titleCls}`}>{sectionTitle}</div>
      <div className={`text-[11px] font-mono font-bold ${titleCls}`}>
        {fmt(itemChargesTotal, currency, false)}
      </div>
      <div className="text-[8px] font-semibold uppercase opacity-70 border-t border-black/10 pt-1">
        Accounts / distribution
      </div>
      <div className="max-h-36 overflow-y-auto space-y-0.5 pr-0.5">
        {lines?.length ? (
          <>
            {lines.slice(0, MAX_DISTRIBUTION_LINES).map((ln, i) => (
              <div key={i} className="flex justify-between gap-1 text-[9px] leading-tight">
                <span className="truncate text-left opacity-90 flex-1" title={ln.label}>
                  {ln.label}
                </span>
                <span className="font-mono shrink-0">{fmt(ln.amount, currency, false)}</span>
              </div>
            ))}
            {lines.length > MAX_DISTRIBUTION_LINES ? (
              <div className="text-[9px] italic opacity-70 pt-0.5">
                + {lines.length - MAX_DISTRIBUTION_LINES} more lines (scroll dataset or export from ERPNext)
              </div>
            ) : null}
          </>
        ) : (
          <span className="text-[9px] italic opacity-60">No lines</span>
        )}
      </div>
    </div>
  )
}

// ─── Journey grouping ──────────────────────────────────────────────────────────

interface JourneyGroup {
  journeyId: string
  transitNo: string
  displayName: string
  importContainer: string
  exportContainer: string
  importBl: string
  exportBl: string
  destination: string
  items: ImportExportEntry[]
  totalImport: number
  companyCurrency: string
  totalExport: number
  exportCurrency: string
  grandTotal: number
  transactionCurrency: string
}

function groupByJourney(entries: ImportExportEntry[]): JourneyGroup[] {
  const map = new Map<string, JourneyGroup>()
  for (const row of entries) {
    const jid = row.journey_id
    if (!map.has(jid)) {
      map.set(jid, {
        journeyId: jid,
        transitNo: row.transit_no || "—",
        displayName: row.transit_display || jid,
        importContainer: row.import_container || "—",
        exportContainer: row.export_container || "—",
        importBl: row.import_bl || "—",
        exportBl: row.export_bl || "—",
        destination: row.destination || "—",
        items: [],
        totalImport: 0,
        companyCurrency: row.company_currency,
        totalExport: 0,
        exportCurrency: row.export_currency || "USD",
        grandTotal: 0,
        transactionCurrency: row.transaction_currency,
      })
    }
    const g = map.get(jid)!
    g.items.push(row)
    g.totalImport += row.additional_costs ?? 0
    g.totalExport += row.export_expenses ?? 0
    g.grandTotal += row.total ?? 0
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

const TD = "border border-blue-100 px-2 py-2 text-[11px] text-gray-700 whitespace-nowrap"
const TDR =
  "border border-blue-100 px-2 py-2 text-[11px] text-right font-mono text-gray-800 whitespace-nowrap"

const PAL_OPEN = { bg: "#f0f6ff", text: "#1e3a8a", sub: "#64748b", border: "#bfdbfe" }
const PAL_EVEN = { bg: "#eef2ff", text: "#1e3a8a", sub: "#6b7280", border: "#c7d2fe" }
const PAL_ODD = { bg: "#e0e7ff", text: "#1e3a8a", sub: "#6b7280", border: "#c7d2fe" }

// ─── JourneyRow ───────────────────────────────────────────────────────────────

interface JourneyRowProps {
  group: JourneyGroup
  index: number
  expanded: boolean
  onToggle: () => void
  journeyBreakdown?: JourneyBreakdown
  invoiceLayout: string
}

function JourneyRow({
  group,
  index,
  expanded,
  onToggle,
  journeyBreakdown,
  invoiceLayout,
}: JourneyRowProps) {
  const cc = (v: number | null | undefined) => fmt(v, group.companyCurrency)

  const pal = expanded ? PAL_OPEN : index % 2 === 0 ? PAL_EVEN : PAL_ODD
  const cell = (extra?: React.CSSProperties) => ({ borderColor: pal.border, ...extra })

  const transitRefs = journeyBreakdown?.transit_invoices ?? []

  const impCc = group.companyCurrency

  const showChargeStacks = expanded && journeyBreakdown

  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer select-none transition-all duration-100 hover:brightness-95"
        style={{ background: pal.bg }}
      >
        <td className="border px-2 py-3 text-center w-8" style={cell()}>
          {expanded ? (
            <ChevronDown className="h-4 w-4 mx-auto" style={{ color: pal.text }} />
          ) : (
            <ChevronRight className="h-4 w-4 mx-auto" style={{ color: pal.text }} />
          )}
        </td>
        <td className="border px-2 py-3 text-[11px] font-bold text-center" style={cell({ color: pal.sub })}>
          {index + 1}
        </td>
        <td className="border px-3 py-3 text-[11px] font-bold align-top min-w-[200px]" style={cell({ color: pal.text })}>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Receipt className="h-3.5 w-3.5 shrink-0 opacity-60" />
              <span>{group.displayName}</span>
            </div>
            {transitRefs.length > 0 ? (
              <TransitInvoiceLinks refs={transitRefs} />
            ) : (
              <span className="text-[10px] font-normal opacity-70">{group.transitNo}</span>
            )}
          </div>
        </td>
        <td className="border px-2 py-3" style={cell()} />
        <td className="border px-2 py-3" style={cell()} />
        <td className="border px-2 py-3" style={cell()} />
        <td className="border px-2 py-3" style={cell()} />
        <td className="border px-2 py-3" style={cell()} />
        <td
          className="border px-2 py-3 text-[11px] text-center max-w-[120px] truncate"
          style={cell({ color: pal.sub })}
          title={group.importContainer}
        >
          {group.importContainer}
        </td>
        <td
          className="border px-2 py-3 text-[11px] text-center max-w-[120px] truncate"
          style={cell({ color: pal.sub })}
          title={group.exportContainer}
        >
          {group.exportContainer}
        </td>
        <td className="border px-2 py-3 text-[11px] text-center" style={cell({ color: pal.sub })}>
          {group.importBl}
        </td>
        <td className="border px-2 py-3 text-[11px] text-center" style={cell({ color: pal.sub })}>
          {group.exportBl}
        </td>
        <td className="border px-2 py-3 text-[11px] text-center font-semibold" style={cell({ color: "#4338ca" })}>
          {group.destination}
        </td>
        <td className="border px-2 py-3 align-top" style={cell()}>
          {showChargeStacks ? (
            <ChargeStack
              sectionTitle="Import charges"
              itemChargesTotal={journeyBreakdown.import_item_charges_total}
              lines={journeyBreakdown.import_distribution_lines}
              currency={impCc}
              accent="import"
            />
          ) : (
            <div className="text-[11px] text-right font-mono font-bold" style={{ color: "#15803d" }}>
              {cc(group.totalImport)}
            </div>
          )}
        </td>
        <td className="border px-2 py-3 align-top" style={cell()}>
          {showChargeStacks ? (
            <ChargeStack
              sectionTitle="Export charges"
              itemChargesTotal={journeyBreakdown.export_item_charges_total}
              lines={journeyBreakdown.export_distribution_lines}
              currency={impCc}
              accent="export"
            />
          ) : (
            <div className="text-[11px] text-right font-mono font-bold" style={{ color: "#b91c1c" }}>
              {cc(group.totalExport)}
            </div>
          )}
        </td>
        <td
          className="border px-2 py-3 text-[11px] text-right font-mono font-bold"
          style={{ borderColor: "#93c5fd", background: expanded ? "#dbeafe" : "#c7d2fe", color: "#1e1b4b" }}
        >
          {cc(group.grandTotal)}
        </td>
      </tr>

      {expanded && (
        <>
          {group.items.flatMap((row, iIdx) =>
            expandVariants(row, invoiceLayout).map((variant) => {
              const rk = row.entry_row_key || row.item_code || `row-${iIdx}`
              const rowBgKey = `${rk}-${variant}`

              const impShown =
                variant === "sales"
                  ? null
                  : row.additional_costs
              const expMerged =
                variant === "purchase"
                  ? null
                  : row.export_expenses

              const isImport = variant !== "sales" && (row.source === "import" || row.source === "both")
              const isExport = variant !== "purchase" && (row.source === "export" || row.source === "both")

              const hash = rowBgKey.split("").reduce((a, c) => a + c.charCodeAt(0), 0)
              const rowBg = hash % 2 === 0 ? "#f8faff" : "#f0f5ff"

              const cConv = (v: number | null | undefined) => fmt(v, row.company_currency)
              const uConv = (v: number | null | undefined) => fmt(v, row.export_currency || "USD")
              const tConv = (v: number | null | undefined) => fmt(v, row.transaction_currency, false)

              const unitsShown =
                variant === "purchase" && invoiceLayout === "separated" ? null : row.units
              const priceShown =
                variant === "purchase" && invoiceLayout === "separated" ? null : row.price
              const tvShown =
                variant === "purchase" && invoiceLayout === "separated" ? null : row.total_value

              const descSuffix =
                variant === "sales"
                  ? " · Sales Invoice side"
                  : variant === "purchase"
                    ? " · Purchase Invoice side"
                    : ""

              return (
                <tr key={`${row.journey_id}-${rowBgKey}`} style={{ background: rowBg }}>
                  <td
                    className="border border-blue-100 w-8"
                    style={{ background: "rgba(30,58,138,0.08)", borderLeft: "3px solid #3b82f6" }}
                  />
                  <td className="border border-blue-100 px-2 py-2 text-[11px] text-center text-gray-400 font-mono">
                    {iIdx + 1}
                  </td>
                  <td
                    className="border border-blue-100 px-2 py-2 text-[11px] text-gray-700 max-w-[200px] truncate"
                    title={row.description}
                  >
                    {(row.description || "—") + descSuffix}
                  </td>
                  <td className="border border-blue-100 px-2 py-2 text-[11px] font-semibold text-blue-800">
                    {row.item_code || "—"}
                    {row.stock_uom ? (
                      <span className="block text-[9px] font-normal text-slate-500">UOM: {row.stock_uom}</span>
                    ) : null}
                  </td>
                  <td className="border border-blue-100 px-2 py-2 text-center">
                    <div className="flex items-center justify-center gap-0.5">
                      {isImport && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">
                          <TrendingDown className="h-2.5 w-2.5" />
                          IMP
                        </span>
                      )}
                      {isExport && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-100 text-red-700 border border-red-200">
                          <TrendingUp className="h-2.5 w-2.5" />
                          EXP
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={TDR}>{unitsShown != null ? unitsShown.toLocaleString("en-US") : "—"}</td>
                  <td className={TDR}>{priceShown != null ? tConv(priceShown) : "—"}</td>
                  <td className={`${TDR} font-semibold`}>{tvShown != null ? tConv(tvShown) : "—"}</td>
                  <td className={`${TD} text-center text-gray-500 max-w-[100px] truncate`} title={row.import_container}>
                    {row.import_container || "—"}
                  </td>
                  <td className={`${TD} text-center text-gray-500 max-w-[100px] truncate`} title={row.export_container}>
                    {row.export_container || "—"}
                  </td>
                  <td className={`${TD} text-center text-gray-500`}>{row.import_bl || "—"}</td>
                  <td className={`${TD} text-center text-gray-500`}>{row.export_bl || "—"}</td>
                  <td className={`${TD} text-center font-medium text-indigo-700`}>{row.destination || "—"}</td>
                  <td className="border border-blue-100 px-2 py-2 text-[11px] text-right font-mono font-semibold text-emerald-700">
                    {impShown != null && impShown > 0 ? cConv(impShown) : "—"}
                  </td>
                  <td className="border border-blue-100 px-2 py-2 text-[11px] text-right font-mono font-semibold text-red-600">
                    {expMerged != null && expMerged > 0 ? cConv(expMerged) : "—"}
                  </td>
                  <td className="border border-blue-200 px-2 py-2 text-[11px] text-right font-mono font-bold text-blue-900 bg-blue-50 align-top">
                    {variant === "merged" ? (
                      cConv(row.total)
                    ) : variant === "sales" ? (
                      expMerged != null && expMerged > 0 ? (
                        cConv(expMerged)
                      ) : (
                        "—"
                      )
                    ) : impShown != null && impShown > 0 ? (
                      cConv(impShown)
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              )
            }),
          )}

          <tr style={{ background: "#dbeafe", borderTop: "2px solid #93c5fd" }}>
            <td className="border border-blue-200" style={{ background: "rgba(30,58,138,0.06)" }} />
            <td
              colSpan={12}
              className="border border-blue-200 px-4 py-1.5 text-[10px] font-bold text-blue-600 uppercase tracking-widest text-right"
            >
              Journey Subtotal
            </td>
            <td className="border border-blue-200 px-2 py-1.5 text-[11px] text-right font-mono font-bold text-emerald-700">
              {cc(group.totalImport)}
            </td>
            <td className="border border-blue-200 px-2 py-1.5 text-[11px] text-right font-mono font-bold text-red-700">
              {cc(group.totalExport)}
            </td>
            <td className="border border-blue-300 px-2 py-1.5 text-[11px] text-right font-mono font-bold text-blue-900 bg-blue-100">
              {cc(group.grandTotal)}
            </td>
          </tr>
        </>
      )}
    </>
  )
}

// ─── Main page component ──────────────────────────────────────────────────────

export default function ImportExportExpense() {
  const [company, setCompany] = useState<string>("")
  const [fromDate, setFromDate] = useState<string>(`${new Date().getFullYear()}-01-01`)
  const [toDate, setToDate] = useState<string>(new Date().toISOString().split("T")[0])
  const [currency, setCurrency] = useState<string>("USD")
  const [item, setItem] = useState<string>("")
  const [groupBy, setGroupBy] = useState<string>("default")
  const [invoiceLayout, setInvoiceLayout] = useState<string>("merged")
  const [hasLoadedData, setHasLoadedData] = useState(false)
  const [error, setError] = useState<string>("")
  const [itemOptions, setItemOptions] = useState<{ name: string; value: string }[]>([])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const { companies: permissionAwareCompanies } = usePermissionAwareCompanies()
  const { companies: allCompanies } = useAllCompaniesForUI()
  const displayCompanies = permissionAwareCompanies.length > 0 ? permissionAwareCompanies : allCompanies

  const { data, isLoading, error: fetchError } = useImportExportExpense({
    company,
    item,
    fromDate,
    toDate,
    currency,
    groupBy,
    enabled: hasLoadedData,
  })

  const entries = useMemo(() => data?.entries ?? [], [data])

  const totals = data?.totals ?? ({} as ImportExportTotals)
  const journeyBreakdowns = data?.journey_breakdowns ?? {}

  const isConverting = currency !== "all"
  const grandTotCc = entries[0]?.company_currency ?? "USD"
  const groups = useMemo(() => groupByJourney(entries), [entries])

  // Start collapsed: auto-expanding every journey paints a huge DOM (detail rows × breakdown lists)
  // and blocks the main thread; users can Expand All when needed.

  const expandAll = useCallback(() => {
    setExpandedIds(new Set(groups.map((g) => g.journeyId)))
  }, [groups])

  const collapseAll = useCallback(() => {
    setExpandedIds(new Set())
  }, [])

  useEffect(() => {
    const fetchItems = async () => {
      try {
        const csrf = (window as unknown as { csrf_token?: string }).csrf_token || ""
        const res = await fetch(
          "/api/method/nextlayer.next_layer.api.import_export_expense.get_items_for_import_export_filter",
          { headers: { "X-Frappe-CSRF-Token": csrf }, credentials: "include" },
        )
        const result = await res.json()
        if (result?.message?.items) setItemOptions(result.message.items)
      } catch {
        setItemOptions([])
      }
    }
    fetchItems()
  }, [])

  const handleLoadData = () => {
    setError("")
    setExpandedIds(new Set())
    setHasLoadedData(true)
  }

  const toggleJourney = useCallback((jid: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      next.has(jid) ? next.delete(jid) : next.add(jid)
      return next
    })
  }, [])

  const gcConv = (v: number | null | undefined) => fmt(v, grandTotCc)

  const TDF =
    "border border-blue-300 px-2 py-2.5 text-[11px] text-right font-mono font-bold whitespace-nowrap"

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20 p-4">
      <div className="max-w-[1900px] mx-auto space-y-5">
        <div className="flex items-center gap-4">
          <Link to="/reconciliation">
            <Button variant="outline" size="sm" className="flex items-center gap-1.5 shrink-0">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </Link>
          <div className="flex-1 text-center">
            <h1 className="text-3xl font-bold text-blue-900 tracking-tight">Import &amp; Export Expense Report</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              Per-item cost breakdown by transit journey — Purchase Invoice (LCV) ↔ Sales Invoice (SSC). Sales invoices
              are shown in deep blue, purchase invoices in light blue.
            </p>
          </div>
        </div>

        <Card className="border-blue-200 shadow-md">
          <CardHeader className="bg-gradient-to-r from-blue-700 to-blue-800 text-white rounded-t-lg py-4 px-6">
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-5 w-5" />
              Report Filters
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 lg:grid-cols-8 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Company</label>
                <Combobox
                  options={displayCompanies.map((c) => ({
                    name:
                      ("company_name" in c ? (c as { company_name?: string }).company_name : c.name) ?? c.name,
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
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full p-2 border border-blue-200 rounded-md focus:border-blue-400 focus:outline-none text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">To Date</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full p-2 border border-blue-200 rounded-md focus:border-blue-400 focus:outline-none text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Display Currency</label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger className="border-blue-200 focus:border-blue-400 text-sm">
                    <SelectValue placeholder="All Currencies" />
                  </SelectTrigger>
                  <SelectContent className="bg-blue-200">
                    {CURRENCY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Group by</label>
                <Select value={groupBy} onValueChange={setGroupBy}>
                  <SelectTrigger className="border-blue-200 focus:border-blue-400 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-blue-200">
                    <SelectItem value="default">Journey (merged containers)</SelectItem>
                    <SelectItem value="container">Container</SelectItem>
                    <SelectItem value="unit">Unit (stock UOM)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Invoice rows</label>
                <Select value={invoiceLayout} onValueChange={setInvoiceLayout}>
                  <SelectTrigger className="border-blue-200 focus:border-blue-400 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-blue-200">
                    <SelectItem value="merged">Merged (single line)</SelectItem>
                    <SelectItem value="separated">Separated (SI line / PI line)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-end">
                <Button
                  onClick={handleLoadData}
                  disabled={isLoading}
                  className="bg-blue-700 hover:bg-blue-800 text-white px-6 w-full h-10"
                >
                  {isLoading ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Loading…
                    </>
                  ) : (
                    "Load Report"
                  )}
                </Button>
              </div>
            </div>

            {isConverting && (
              <div className="mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-md text-[11px] text-amber-700">
                All amounts are converted to <strong>{currency}</strong> using your Currency Exchange records. Import
                charges and Export charges are each converted from their native currency.
              </div>
            )}
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

        {hasLoadedData && isLoading && !data && (
          <Card className="border-blue-200 shadow-md">
            <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-blue-900">
              <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
              <p className="text-sm font-medium">Loading report…</p>
              <p className="text-xs text-muted-foreground max-w-md text-center">
                Large date ranges can take a while. The page stays usable while data loads.
              </p>
            </CardContent>
          </Card>
        )}

        {hasLoadedData && data && (
          <Card className="border-blue-200 shadow-md overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-blue-700 to-blue-800 text-white rounded-t-lg py-4 px-6">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <CardTitle className="text-base flex flex-wrap items-center gap-2">
                  <span>
                    Expense Report
                    {groups.length > 0 && (
                      <span className="ml-2 text-blue-300 font-normal text-sm">
                        {groups.length} journey{groups.length !== 1 ? "s" : ""}
                        {groups.length > 25 ? " — rows start collapsed for performance" : ""}
                      </span>
                    )}
                  </span>
                  {isLoading ? (
                    <span className="inline-flex items-center gap-1 text-xs font-normal text-amber-200">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      Updating…
                    </span>
                  ) : null}
                </CardTitle>
                {groups.length > 0 && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={expandAll}
                      className="bg-white/10 border-white/30 text-white hover:bg-white/20 text-xs h-7"
                    >
                      Expand All
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={collapseAll}
                      className="bg-white/10 border-white/30 text-white hover:bg-white/20 text-xs h-7"
                    >
                      Collapse All
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>

            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className={TH} style={{ width: 32 }} />
                      <th className={TH} style={{ width: 36 }}>
                        #
                      </th>
                      <th className={TH} style={{ minWidth: 220 }}>
                        Journey / Transit invoices
                      </th>
                      <th className={TH} style={{ minWidth: 110 }}>
                        Item
                      </th>
                      <th className={TH} style={{ width: 74 }}>
                        Source
                      </th>
                      <th className={TH} style={{ minWidth: 68 }}>
                        Units
                      </th>
                      <th className={TH} style={{ minWidth: 100 }}>
                        Price
                      </th>
                      <th className={TH} style={{ minWidth: 110 }}>
                        Total Value
                      </th>
                      <th className={TH} style={{ minWidth: 110 }}>
                        Import Cont.
                      </th>
                      <th className={TH} style={{ minWidth: 110 }}>
                        Export Cont.
                      </th>
                      <th className={TH} style={{ minWidth: 88 }}>
                        Import B/L
                      </th>
                      <th className={TH} style={{ minWidth: 88 }}>
                        Export B/L
                      </th>
                      <th className={TH} style={{ minWidth: 88 }}>
                        Destination
                      </th>
                      <th
                        className={TH}
                        style={{ minWidth: 140, background: "#d1fae5", color: "#065f46", fontWeight: 700 }}
                      >
                        Import Charges
                        <div className="text-[9px] font-normal opacity-70 mt-0.5">
                          Expand journey for breakdown
                        </div>
                      </th>
                      <th
                        className={TH}
                        style={{ minWidth: 140, background: "#fee2e2", color: "#7f1d1d", fontWeight: 700 }}
                      >
                        Export Charges
                        <div className="text-[9px] font-normal opacity-70 mt-0.5">
                          SSC items + freight, storage &amp; Doonta
                        </div>
                      </th>
                      <th className={TH} style={{ minWidth: 110, background: "#c7d2fe", color: "#1e1b4b", fontWeight: 700 }}>
                        Total
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {groups.length === 0 ? (
                      <tr>
                        <td colSpan={16} className="text-center text-gray-500 py-14 border border-gray-200 text-sm">
                          No data found. Ensure Purchase Invoices and Sales Invoices have <strong>Is Export Sale</strong>{" "}
                          checked.
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
                          journeyBreakdown={journeyBreakdowns[group.journeyId]}
                          invoiceLayout={invoiceLayout}
                        />
                      ))
                    )}
                  </tbody>

                  {groups.length > 0 && (
                    <tfoot>
                      <tr style={{ background: "#1e3a8a" }}>
                        <td
                          colSpan={13}
                          className="border border-blue-700 px-4 py-2.5 text-xs font-bold text-white text-right uppercase tracking-widest"
                        >
                          Grand Totals
                        </td>
                        <td className={`${TDF} bg-emerald-50 text-emerald-900 border-emerald-200`}>
                          {gcConv(totals.total_additional_costs ?? 0)}
                        </td>
                        <td className={`${TDF} bg-red-50 text-red-900 border-red-200`}>
                          {gcConv(totals.total_export_expenses ?? 0)}
                        </td>
                        <td className={`${TDF} bg-blue-200 text-blue-950 border-blue-400 text-sm`}>
                          {gcConv(totals.grand_total ?? 0)}
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
