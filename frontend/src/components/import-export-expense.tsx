"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
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
  Download,
  Printer,
  FileText,
  X,
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
  type ExpenseSideFilter,
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

// ─── Printable columns ────────────────────────────────────────────────────────

const PRINTABLE_COLUMNS = [
  { key: "col-num",             label: "#",                        defaultOn: true  },
  { key: "col-journey",         label: "Journey / Transit invoices", defaultOn: true  },
  { key: "col-item",            label: "Item",                     defaultOn: true  },
  { key: "col-source",          label: "Source",                   defaultOn: true  },
  { key: "col-units",           label: "Units",                    defaultOn: true  },
  { key: "col-price",           label: "Price",                    defaultOn: false },
  { key: "col-total-value",     label: "Total Value",              defaultOn: false },
  { key: "col-import-cont",     label: "Import Cont.",             defaultOn: true  },
  { key: "col-export-cont",     label: "Export Cont.",             defaultOn: true  },
  { key: "col-import-bl",       label: "Import B/L",              defaultOn: false },
  { key: "col-export-bl",       label: "Export B/L",              defaultOn: false },
  { key: "col-destination",     label: "Destination",              defaultOn: true  },
  { key: "col-import-charges",  label: "Import Charges",           defaultOn: true  },
  { key: "col-export-charges",  label: "Export Charges",           defaultOn: true  },
  { key: "col-total",           label: "Total",                    defaultOn: true  },
] as const

type ColumnKey = (typeof PRINTABLE_COLUMNS)[number]["key"]

// ─── ERPNext desk URL ──────────────────────────────────────────────────────────

function deskDocUrl(doctype: string, name: string): string {
  const slug = doctype.trim().toLowerCase().replace(/\s+/g, "-")
  if (typeof window === "undefined") return `/app/${slug}/${encodeURIComponent(name)}`
  return `${window.location.origin}/app/${slug}/${encodeURIComponent(name)}`
}

// ─── Formatting ───────────────────────────────────────────────────────────────

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
      nf = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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

const MAX_DISTRIBUTION_LINES = 48

function csvEscapeCell(v: string | number | null | undefined): string {
  if (v == null || v === "") return ""
  const s = String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function buildImportExportCsv(rows: ImportExportEntry[]): string {
  const headers = [
    "Journey ID", "Transit display", "Transit no", "Item code", "Description",
    "Source", "Units", "Import container", "Export container", "Destination",
    "Import charges", "Export charges", "Total", "Company currency",
  ]
  const lines = [headers.join(",")]
  for (const row of rows) {
    lines.push([
      csvEscapeCell(row.journey_id), csvEscapeCell(row.transit_display),
      csvEscapeCell(row.transit_no), csvEscapeCell(row.item_code),
      csvEscapeCell(row.description), csvEscapeCell(row.source),
      csvEscapeCell(row.units), csvEscapeCell(row.import_container),
      csvEscapeCell(row.export_container), csvEscapeCell(row.destination),
      csvEscapeCell(row.additional_costs ?? ""), csvEscapeCell(row.export_expenses ?? ""),
      csvEscapeCell(row.total), csvEscapeCell(row.company_currency),
    ].join(","))
  }
  return lines.join("\n")
}

type DetailVariant = "merged" | "sales" | "purchase"

function expandVariants(row: ImportExportEntry, invoiceLayout: string): DetailVariant[] {
  if (invoiceLayout === "separated" && row.source === "both") return ["sales", "purchase"]
  return ["merged"]
}

// ─── Column Picker Modal ──────────────────────────────────────────────────────

interface ColumnPickerModalProps {
  open: boolean
  mode: "print" | "pdf"
  enabledCols: Set<string>
  orientation: "landscape" | "portrait"
  onOrientationChange: (o: "landscape" | "portrait") => void
  onToggleCol: (key: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onConfirm: () => void
  onCancel: () => void
}

function ColumnPickerModal({
  open, mode, enabledCols, orientation, onOrientationChange,
  onToggleCol, onSelectAll, onDeselectAll, onConfirm, onCancel,
}: ColumnPickerModalProps) {
  if (!open) return null

  const allSelected  = PRINTABLE_COLUMNS.every((c) => enabledCols.has(c.key))
  const noneSelected = PRINTABLE_COLUMNS.every((c) => !enabledCols.has(c.key))

  return (
    <div
      className="ie-report-no-print fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label="Column picker"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="bg-white rounded-xl shadow-2xl border border-blue-200 w-[460px] max-h-[88vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-700 to-blue-800 text-white px-5 py-4 flex items-center justify-between shrink-0">
          <div>
            <p className="text-base font-bold">
              {mode === "pdf" ? "Save as PDF" : "Print"} — choose columns
            </p>
            <p className="text-[11px] text-blue-200 mt-0.5">
              Only ticked columns will appear on the {mode === "pdf" ? "PDF" : "printed page"}.
            </p>
          </div>
          <button
            onClick={onCancel}
            className="text-white/70 hover:text-white transition-colors p-1 rounded"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Quick-select bar */}
        <div className="flex gap-2 px-5 py-3 border-b border-blue-100 bg-blue-50/60 shrink-0 items-center">
          <button
            onClick={onSelectAll}
            disabled={allSelected}
            className="text-[11px] px-3 py-1.5 rounded border border-blue-300 text-blue-800 bg-white hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Select all
          </button>
          <button
            onClick={onDeselectAll}
            disabled={noneSelected}
            className="text-[11px] px-3 py-1.5 rounded border border-blue-300 text-blue-800 bg-white hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Deselect all
          </button>
          <span className="ml-auto text-[11px] text-blue-600">
            {enabledCols.size} / {PRINTABLE_COLUMNS.length} columns
          </span>
        </div>

        {/* Page orientation */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-blue-100 bg-white shrink-0">
          <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide shrink-0">Orientation</span>
          <div className="flex gap-2">
            {(["landscape", "portrait"] as const).map((o) => {
              const active = orientation === o
              return (
                <button
                  key={o}
                  onClick={() => onOrientationChange(o)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-colors ${
                    active
                      ? "bg-blue-700 border-blue-700 text-white"
                      : "bg-white border-blue-200 text-blue-800 hover:bg-blue-50"
                  }`}
                >
                  <span
                    className={`inline-block border-2 rounded-sm shrink-0 ${active ? "border-white" : "border-blue-400"}`}
                    style={o === "landscape" ? { width: 18, height: 13 } : { width: 13, height: 18 }}
                  />
                  {o.charAt(0).toUpperCase() + o.slice(1)}
                </button>
              )
            })}
          </div>
          <span className="ml-auto text-[10px] text-gray-400">
            {orientation === "landscape" ? "Wide — fits more columns" : "Tall — fewer columns recommended"}
          </span>
        </div>

        {/* Column list */}
        <div className="overflow-y-auto flex-1 px-5 py-3 space-y-0.5">
          {PRINTABLE_COLUMNS.map((col) => (
            <label
              key={col.key}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-blue-50 cursor-pointer transition-colors"
            >
              <input
                type="checkbox"
                checked={enabledCols.has(col.key)}
                onChange={() => onToggleCol(col.key)}
                className="rounded border-blue-400 text-blue-700 cursor-pointer"
              />
              <span className="text-[13px] text-gray-800 select-none flex-1">{col.label}</span>
              {!col.defaultOn && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 border border-gray-200">
                  optional
                </span>
              )}
            </label>
          ))}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 py-4 border-t border-blue-100 bg-blue-50/40 shrink-0 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-[13px] rounded-lg border border-blue-200 text-blue-800 bg-white hover:bg-blue-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={noneSelected}
            className="px-5 py-2 text-[13px] rounded-lg bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-semibold"
          >
            {mode === "pdf" ? "Save as PDF →" : "Print →"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Transit invoice pills ────────────────────────────────────────────────────

function TransitInvoiceLinks({ refs }: { refs: TransitInvoiceRef[] }) {
  if (!refs?.length) return <span className="text-[10px] text-gray-400">—</span>
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
  sectionTitle, itemChargesTotal, lines, currency, accent,
}: {
  sectionTitle: string
  itemChargesTotal: number
  lines: DistributionLine[]
  currency: string
  accent: "import" | "export"
}) {
  const border = accent === "import" ? "border-emerald-200 bg-emerald-50/40" : "border-red-200 bg-red-50/40"
  const titleCls = accent === "import" ? "text-emerald-900" : "text-red-900"

  return (
    <div className={`rounded-md border px-1.5 py-1 space-y-1 ${border}`}>
      <div className={`text-[9px] font-bold uppercase tracking-wide ${titleCls}`}>{sectionTitle}</div>
      <div className={`text-[11px] font-mono font-bold ${titleCls}`}>{fmt(itemChargesTotal, currency, false)}</div>
      <div className="text-[8px] font-semibold uppercase opacity-70 border-t border-black/10 pt-1">
        Accounts / distribution
      </div>
      <div className="max-h-36 overflow-y-auto space-y-0.5 pr-0.5">
        {lines?.length ? (
          <>
            {lines.slice(0, MAX_DISTRIBUTION_LINES).map((ln, i) => (
              <div key={i} className="flex justify-between gap-1 text-[9px] leading-tight">
                <span className="truncate text-left opacity-90 flex-1" title={ln.label}>{ln.label}</span>
                <span className="font-mono shrink-0">{fmt(ln.amount, currency, false)}</span>
              </div>
            ))}
            {lines.length > MAX_DISTRIBUTION_LINES && (
              <div className="text-[9px] italic opacity-70 pt-0.5">
                + {lines.length - MAX_DISTRIBUTION_LINES} more lines
              </div>
            )}
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
const TDR = "border border-blue-100 px-2 py-2 text-[11px] text-right font-mono text-gray-800 whitespace-nowrap"

const PAL_OPEN = { bg: "#f0f6ff", text: "#1e3a8a", sub: "#64748b", border: "#bfdbfe" }
const PAL_EVEN = { bg: "#eef2ff", text: "#1e3a8a", sub: "#6b7280", border: "#c7d2fe" }
const PAL_ODD  = { bg: "#e0e7ff", text: "#1e3a8a", sub: "#6b7280", border: "#c7d2fe" }

// ─── JourneyRow ───────────────────────────────────────────────────────────────

interface JourneyRowProps {
  group: JourneyGroup
  index: number
  expanded: boolean
  onToggle: () => void
  journeyBreakdown?: JourneyBreakdown
  invoiceLayout: string
  printRowInclude: "0" | "1"
  printSelected: boolean
  onTogglePrintSelect: () => void
}

function JourneyRow({
  group, index, expanded, onToggle, journeyBreakdown, invoiceLayout,
  printRowInclude, printSelected, onTogglePrintSelect,
}: JourneyRowProps) {
  const cc = (v: number | null | undefined) => fmt(v, group.companyCurrency)

  const pal = expanded ? PAL_OPEN : index % 2 === 0 ? PAL_EVEN : PAL_ODD
  const cell = (extra?: React.CSSProperties) => ({ borderColor: pal.border, ...extra })

  const transitRefs = journeyBreakdown?.transit_invoices ?? []
  const impCc = group.companyCurrency
  const showChargeStacks = expanded && journeyBreakdown

  const rowPrintAttrs = {
    "data-ie-print-jid": group.journeyId,
    "data-ie-print-include": printRowInclude,
  } as const

  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer select-none transition-all duration-100 hover:brightness-95"
        style={{ background: pal.bg }}
        {...rowPrintAttrs}
      >
        {/* print-select checkbox — no data-col, always hidden on print */}
        <td
          className="border px-1 py-3 text-center w-8 ie-report-no-print"
          style={cell()}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={printSelected}
            onChange={(ev) => { ev.stopPropagation(); onTogglePrintSelect() }}
            className="rounded border-blue-400 cursor-pointer"
            title="Include this journey in print / PDF / CSV"
            aria-label={`Include journey ${group.displayName} in print`}
          />
        </td>

        {/* expand chevron — no data-col, always shown */}
        <td className="border px-2 py-3 text-center w-8" style={cell()}>
          {expanded
            ? <ChevronDown className="h-4 w-4 mx-auto" style={{ color: pal.text }} />
            : <ChevronRight className="h-4 w-4 mx-auto" style={{ color: pal.text }} />}
        </td>

        <td data-col="col-num" className="border px-2 py-3 text-[11px] font-bold text-center" style={cell({ color: pal.sub })}>
          {index + 1}
        </td>

        <td data-col="col-journey" className="border px-3 py-3 text-[11px] font-bold align-top min-w-[200px]" style={cell({ color: pal.text })}>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Receipt className="h-3.5 w-3.5 shrink-0 opacity-60" />
              <span>{group.displayName}</span>
            </div>
            {transitRefs.length > 0
              ? <TransitInvoiceLinks refs={transitRefs} />
              : <span className="text-[10px] font-normal opacity-70">{group.transitNo}</span>}
          </div>
        </td>

        {/* item / source / units / price / total-value — empty on group row */}
        <td data-col="col-item"        className="border px-2 py-3" style={cell()} />
        <td data-col="col-source"      className="border px-2 py-3" style={cell()} />
        <td data-col="col-units"       className="border px-2 py-3" style={cell()} />
        <td data-col="col-price"       className="border px-2 py-3" style={cell()} />
        <td data-col="col-total-value" className="border px-2 py-3" style={cell()} />

        <td data-col="col-import-cont" className="border px-2 py-3 text-[11px] text-center max-w-[120px] truncate" style={cell({ color: pal.sub })} title={group.importContainer}>
          {group.importContainer}
        </td>
        <td data-col="col-export-cont" className="border px-2 py-3 text-[11px] text-center max-w-[120px] truncate" style={cell({ color: pal.sub })} title={group.exportContainer}>
          {group.exportContainer}
        </td>
        <td data-col="col-import-bl" className="border px-2 py-3 text-[11px] text-center" style={cell({ color: pal.sub })}>
          {group.importBl}
        </td>
        <td data-col="col-export-bl" className="border px-2 py-3 text-[11px] text-center" style={cell({ color: pal.sub })}>
          {group.exportBl}
        </td>
        <td data-col="col-destination" className="border px-2 py-3 text-[11px] text-center font-semibold" style={cell({ color: "#4338ca" })}>
          {group.destination}
        </td>

        <td data-col="col-import-charges" className="border px-2 py-3 align-top" style={cell()}>
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

        <td data-col="col-export-charges" className="border px-2 py-3 align-top" style={cell()}>
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

        <td data-col="col-total"
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

              const impShown  = variant === "sales"    ? null : row.additional_costs
              const expMerged = variant === "purchase"  ? null : row.export_expenses

              const isImport = variant !== "sales"    && (row.source === "import" || row.source === "both")
              const isExport = variant !== "purchase"  && (row.source === "export" || row.source === "both")

              const hash = rowBgKey.split("").reduce((a, c) => a + c.charCodeAt(0), 0)
              const rowBg = hash % 2 === 0 ? "#f8faff" : "#f0f5ff"

              const cConv = (v: number | null | undefined) => fmt(v, row.company_currency)
              const tConv = (v: number | null | undefined) => fmt(v, row.transaction_currency, false)

              const unitsShown = variant === "purchase" && invoiceLayout === "separated" ? null : row.units
              const priceShown = variant === "purchase" && invoiceLayout === "separated" ? null : row.price
              const tvShown    = variant === "purchase" && invoiceLayout === "separated" ? null : row.total_value

              const descSuffix =
                variant === "sales"    ? " · Sales Invoice side"
                : variant === "purchase" ? " · Purchase Invoice side"
                : ""

              return (
                <tr
                  key={`${row.journey_id}-${rowBgKey}`}
                  style={{ background: rowBg }}
                  data-ie-print-jid={group.journeyId}
                  data-ie-print-include={printRowInclude}
                >
                  {/* indent stripe — no data-col */}
                  <td
                    className="border border-blue-100 w-8 ie-report-no-print"
                    style={{ background: "rgba(30,58,138,0.08)", borderLeft: "3px solid #3b82f6" }}
                  />

                  <td data-col="col-num" className="border border-blue-100 px-2 py-2 text-[11px] text-center text-gray-400 font-mono">
                    {iIdx + 1}
                  </td>

                  <td data-col="col-journey"
                    className="border border-blue-100 px-2 py-2 text-[11px] text-gray-700 max-w-[200px] truncate"
                    title={row.description}
                  >
                    {(row.description || "—") + descSuffix}
                  </td>

                  <td data-col="col-item" className="border border-blue-100 px-2 py-2 text-[11px] font-semibold text-blue-800">
                    {row.item_code || "—"}
                    {row.stock_uom && (
                      <span className="block text-[9px] font-normal text-slate-500">UOM: {row.stock_uom}</span>
                    )}
                  </td>

                  <td data-col="col-source" className="border border-blue-100 px-2 py-2 text-center">
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

                  <td data-col="col-units"       className={TDR}>{unitsShown != null ? unitsShown.toLocaleString("en-US") : "—"}</td>
                  <td data-col="col-price"       className={TDR}>{priceShown != null ? tConv(priceShown) : "—"}</td>
                  <td data-col="col-total-value" className={`${TDR} font-semibold`}>{tvShown != null ? tConv(tvShown) : "—"}</td>

                  <td data-col="col-import-cont" className={`${TD} text-center text-gray-500 max-w-[100px] truncate`} title={row.import_container}>{row.import_container || "—"}</td>
                  <td data-col="col-export-cont" className={`${TD} text-center text-gray-500 max-w-[100px] truncate`} title={row.export_container}>{row.export_container || "—"}</td>
                  <td data-col="col-import-bl"   className={`${TD} text-center text-gray-500`}>{row.import_bl || "—"}</td>
                  <td data-col="col-export-bl"   className={`${TD} text-center text-gray-500`}>{row.export_bl || "—"}</td>
                  <td data-col="col-destination" className={`${TD} text-center font-medium text-indigo-700`}>{row.destination || "—"}</td>

                  <td data-col="col-import-charges" className="border border-blue-100 px-2 py-2 text-[11px] text-right font-mono font-semibold text-emerald-700">
                    {impShown != null && impShown > 0 ? cConv(impShown) : "—"}
                  </td>
                  <td data-col="col-export-charges" className="border border-blue-100 px-2 py-2 text-[11px] text-right font-mono font-semibold text-red-600">
                    {expMerged != null && expMerged > 0 ? cConv(expMerged) : "—"}
                  </td>
                  <td data-col="col-total" className="border border-blue-200 px-2 py-2 text-[11px] text-right font-mono font-bold text-blue-900 bg-blue-50 align-top">
                    {variant === "merged"
                      ? cConv(row.total)
                      : variant === "sales"
                        ? (expMerged != null && expMerged > 0 ? cConv(expMerged) : "—")
                        : (impShown != null && impShown > 0 ? cConv(impShown) : "—")}
                  </td>
                </tr>
              )
            }),
          )}

          {/* Journey subtotal row */}
          <tr
            style={{ background: "#dbeafe", borderTop: "2px solid #93c5fd" }}
            data-ie-print-jid={group.journeyId}
            data-ie-print-include={printRowInclude}
          >
            <td className="border border-blue-200 ie-report-no-print" style={{ background: "rgba(30,58,138,0.06)" }} />
            <td className="border border-blue-200" style={{ background: "rgba(30,58,138,0.06)" }} />
            <td
              colSpan={12}
              className="border border-blue-200 px-4 py-1.5 text-[10px] font-bold text-blue-600 uppercase tracking-widest text-right"
            >
              Journey Subtotal
            </td>
            <td data-col="col-import-charges" className="border border-blue-200 px-2 py-1.5 text-[11px] text-right font-mono font-bold text-emerald-700">
              {cc(group.totalImport)}
            </td>
            <td data-col="col-export-charges" className="border border-blue-200 px-2 py-1.5 text-[11px] text-right font-mono font-bold text-red-700">
              {cc(group.totalExport)}
            </td>
            <td data-col="col-total" className="border border-blue-300 px-2 py-1.5 text-[11px] text-right font-mono font-bold text-blue-900 bg-blue-100">
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
  const printRef = useRef<HTMLDivElement>(null)
  const [company, setCompany] = useState<string>("")
  const [fromDate, setFromDate] = useState<string>(`${new Date().getFullYear()}-01-01`)
  const [toDate, setToDate] = useState<string>(new Date().toISOString().split("T")[0])
  const [currency, setCurrency] = useState<string>("USD")
  const [selectedItems, setSelectedItems] = useState<string[]>([])
  const [itemPickerKey, setItemPickerKey] = useState(0)
  const [companyGroup, setCompanyGroup] = useState<string>("")
  const [companyGroupOptions, setCompanyGroupOptions] = useState<{ name: string; value: string }[]>([])
  const [expenseSide, setExpenseSide] = useState<ExpenseSideFilter>("all")
  const [includeDrafts, setIncludeDrafts] = useState(false)
  const [groupBy, setGroupBy] = useState<string>("default")
  const [invoiceLayout, setInvoiceLayout] = useState<string>("merged")
  const [hasLoadedData, setHasLoadedData] = useState(false)
  const [error, setError] = useState<string>("")
  const [itemOptions, setItemOptions] = useState<{ name: string; value: string }[]>([])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [selectedJourneyIdsForPrint, setSelectedJourneyIdsForPrint] = useState<Set<string>>(new Set())
  const printSelectAllRef = useRef<HTMLInputElement>(null)

  // ── Column picker state ──
  const defaultEnabledCols = useMemo(
    () => new Set<string>(PRINTABLE_COLUMNS.filter((c) => c.defaultOn).map((c) => c.key)),
    [],
  )
  const [enabledCols, setEnabledCols] = useState<Set<string>>(defaultEnabledCols)
  const [colPickerOpen, setColPickerOpen] = useState(false)
  const [colPickerMode, setColPickerMode] = useState<"print" | "pdf">("print")
  const [printOrientation, setPrintOrientation] = useState<"landscape" | "portrait">("landscape")

  const { companies: permissionAwareCompanies } = usePermissionAwareCompanies()
  const { companies: allCompanies } = useAllCompaniesForUI()
  const displayCompanies = permissionAwareCompanies.length > 0 ? permissionAwareCompanies : allCompanies

  const { data, isLoading, error: fetchError } = useImportExportExpense({
    company, items: selectedItems, fromDate, toDate, currency,
    groupBy, companyGroup, expenseSide, includeDrafts, enabled: hasLoadedData,
  })

  const entries = useMemo(() => data?.entries ?? [], [data])
  const totals = data?.totals ?? ({} as ImportExportTotals)
  const journeyBreakdowns = data?.journey_breakdowns ?? {}

  const isConverting = currency !== "all"
  const grandTotCc = entries[0]?.company_currency ?? "USD"
  const groups = useMemo(() => groupByJourney(entries), [entries])

  const journeyIdsForPrint = useMemo(() => groups.map((g) => g.journeyId), [groups])
  const printSelectionCount = selectedJourneyIdsForPrint.size
  const printFilterActive = printSelectionCount > 0
  const printSubsetActive =
    journeyIdsForPrint.length > 0 &&
    printSelectionCount > 0 &&
    printSelectionCount < journeyIdsForPrint.length
  const allJourneysSelectedForPrint =
    journeyIdsForPrint.length > 0 && journeyIdsForPrint.every((id) => selectedJourneyIdsForPrint.has(id))
  const someJourneysSelectedForPrint = journeyIdsForPrint.some((id) => selectedJourneyIdsForPrint.has(id))

  useEffect(() => {
    const el = printSelectAllRef.current
    if (el) el.indeterminate = someJourneysSelectedForPrint && !allJourneysSelectedForPrint
  }, [someJourneysSelectedForPrint, allJourneysSelectedForPrint])

  useEffect(() => { setSelectedJourneyIdsForPrint(new Set()) }, [data])

  const expandAll   = useCallback(() => { setExpandedIds(new Set(groups.map((g) => g.journeyId))) }, [groups])
  const collapseAll = useCallback(() => { setExpandedIds(new Set()) }, [])

  // ── Column picker handlers ──

  const fireColumnAwarePrint = useCallback(() => {
    const hiddenKeys = PRINTABLE_COLUMNS.filter((c) => !enabledCols.has(c.key)).map((c) => c.key)
    const colRules = hiddenKeys.map((k) => `[data-col="${k}"] { display: none !important; }`).join("\n")
    const pageRule = `@page { size: ${printOrientation}; margin: 10mm; }`

    const style = document.createElement("style")
    style.id = "__ie-col-print__"
    style.textContent = `${pageRule}\n@media print { ${colRules} }`
    document.head.appendChild(style)

    const cleanup = () => {
      if (document.getElementById("__ie-col-print__")) document.head.removeChild(style)
      window.removeEventListener("afterprint", cleanup)
    }
    window.addEventListener("afterprint", cleanup)
    window.print()
  }, [enabledCols, printOrientation])

  const openColPicker = useCallback((mode: "print" | "pdf") => {
    setColPickerMode(mode)
    setColPickerOpen(true)
  }, [])

  const handleColPickerConfirm = useCallback(() => {
    setColPickerOpen(false)
    // Give React one paint cycle to unmount the modal before opening the print dialog
    setTimeout(() => {
      fireColumnAwarePrint()
    }, 120)
  }, [fireColumnAwarePrint])

  const toggleCol = useCallback((key: string) => {
    setEnabledCols((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }, [])

  const selectAllCols   = useCallback(() => { setEnabledCols(new Set(PRINTABLE_COLUMNS.map((c) => c.key))) }, [])
  const deselectAllCols = useCallback(() => { setEnabledCols(new Set()) }, [])

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
      } catch { setItemOptions([]) }
    }
    fetchItems()
  }, [])

  useEffect(() => {
    const loadGroups = async () => {
      try {
        const csrf = (window as unknown as { csrf_token?: string }).csrf_token || ""
        const res = await fetch(
          "/api/method/nextlayer.next_layer.api.import_export_expense.get_company_groups_for_import_export_filter",
          { headers: { "X-Frappe-CSRF-Token": csrf }, credentials: "include" },
        )
        const result = await res.json()
        if (result?.message?.company_groups) setCompanyGroupOptions(result.message.company_groups)
        else setCompanyGroupOptions([])
      } catch { setCompanyGroupOptions([]) }
    }
    loadGroups()
  }, [])

  const handleLoadData = () => {
    setError("")
    setExpandedIds(new Set())
    setHasLoadedData(true)
  }

  const handleExportCsv = useCallback(() => {
    if (!data?.entries?.length) return
    const rowsForCsv =
      selectedJourneyIdsForPrint.size > 0
        ? data.entries.filter((e) => selectedJourneyIdsForPrint.has(e.journey_id))
        : data.entries
    const csv = buildImportExportCsv(rowsForCsv)
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `import-export-expense-${fromDate}_to_${toDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [data, fromDate, toDate, selectedJourneyIdsForPrint])

  const togglePrintSelectAll = useCallback(() => {
    if (allJourneysSelectedForPrint) setSelectedJourneyIdsForPrint(new Set())
    else setSelectedJourneyIdsForPrint(new Set(journeyIdsForPrint))
  }, [allJourneysSelectedForPrint, journeyIdsForPrint])

  const clearPrintSelection = useCallback(() => { setSelectedJourneyIdsForPrint(new Set()) }, [])
  const removeSelectedItem  = useCallback((code: string) => { setSelectedItems((prev) => prev.filter((c) => c !== code)) }, [])
  const clearSelectedItems  = useCallback(() => { setSelectedItems([]) }, [])
  const toggleJourney       = useCallback((jid: string) => {
    setExpandedIds((prev) => { const next = new Set(prev); next.has(jid) ? next.delete(jid) : next.add(jid); return next })
  }, [])

  const gcConv = (v: number | null | undefined) => fmt(v, grandTotCc)

  const TDF = "border border-blue-300 px-2 py-2.5 text-[11px] text-right font-mono font-bold whitespace-nowrap"

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20 p-4">
      <style>{`
        @page { margin: 10mm; }
        @media print {
          .ie-report-no-print { display: none !important; }
          .ie-report-print-root { background: white !important; }
          .ie-report-print-root table { font-size: 9px !important; }
          .ie-print-rows-filtered tr[data-ie-print-include="0"] { display: none !important; }
          .ie-print-rows-filtered .ie-print-footer-grand-total { display: none !important; }
        }
      `}</style>

      {/* Column picker modal */}
      <ColumnPickerModal
        open={colPickerOpen}
        mode={colPickerMode}
        enabledCols={enabledCols}
        orientation={printOrientation}
        onOrientationChange={setPrintOrientation}
        onToggleCol={toggleCol}
        onSelectAll={selectAllCols}
        onDeselectAll={deselectAllCols}
        onConfirm={handleColPickerConfirm}
        onCancel={() => setColPickerOpen(false)}
      />

      <div className="max-w-[1900px] mx-auto space-y-5">
        <div className="flex items-center gap-4 ie-report-no-print">
          <Link to="/reconciliation">
            <Button variant="outline" size="sm" className="flex items-center gap-1.5 shrink-0">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </Link>
          <div className="flex-1 text-center">
            <h1 className="text-3xl font-bold text-blue-900 tracking-tight">Import &amp; Export Expense Report</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              Per-item cost breakdown by transit journey — Purchase Invoice (LCV) ↔ Sales Invoice (SSC).
            </p>
          </div>
        </div>

        {/* Filters card */}
        <Card className="border-blue-200 shadow-md ie-report-no-print">
          <CardHeader className="bg-gradient-to-r from-blue-700 to-blue-800 text-white rounded-t-lg py-4 px-6">
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-5 w-5" />
              Report Filters
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Company</label>
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

              <div className="space-y-1.5 xl:col-span-2">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Items (multi-select)</label>
                <Combobox
                  key={itemPickerKey}
                  options={itemOptions.filter((o) => !selectedItems.includes(o.value))}
                  value=""
                  onValueChange={(v) => {
                    if (!v || selectedItems.includes(v)) return
                    setSelectedItems((prev) => [...prev, v])
                    setItemPickerKey((k) => k + 1)
                  }}
                  placeholder={selectedItems.length ? "Add another item…" : "All items — pick to narrow"}
                  searchPlaceholder="Search items..."
                  emptyMessage="No items found."
                />
                {selectedItems.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2 items-center">
                    {selectedItems.map((code) => (
                      <span key={code} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-blue-100 text-blue-900 text-[11px] font-mono border border-blue-200">
                        {code}
                        <button type="button" className="p-0.5 rounded hover:bg-blue-200" onClick={() => removeSelectedItem(code)} aria-label={`Remove ${code}`}>
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                    <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={clearSelectedItems}>
                      Clear items
                    </Button>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">From Date</label>
                <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
                  className="w-full p-2 border border-blue-200 rounded-md focus:border-blue-400 focus:outline-none text-sm" />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">To Date</label>
                <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
                  className="w-full p-2 border border-blue-200 rounded-md focus:border-blue-400 focus:outline-none text-sm" />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Display Currency</label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger className="border-blue-200 focus:border-blue-400 text-sm"><SelectValue placeholder="All Currencies" /></SelectTrigger>
                  <SelectContent className="bg-blue-200">
                    {CURRENCY_OPTIONS.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Group by</label>
                <Select value={groupBy} onValueChange={setGroupBy}>
                  <SelectTrigger className="border-blue-200 focus:border-blue-400 text-sm"><SelectValue /></SelectTrigger>
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
                  <SelectTrigger className="border-blue-200 focus:border-blue-400 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-blue-200">
                    <SelectItem value="merged">Merged (single line)</SelectItem>
                    <SelectItem value="separated">Separated (SI line / PI line)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Company group</label>
                <Combobox
                  options={companyGroupOptions}
                  value={companyGroup}
                  onValueChange={setCompanyGroup}
                  placeholder="All groups"
                  searchPlaceholder="Search company group…"
                  emptyMessage="No company groups on file."
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Expense side</label>
                <Select value={expenseSide} onValueChange={(v) => setExpenseSide(v as ExpenseSideFilter)}>
                  <SelectTrigger className="border-blue-200 focus:border-blue-400 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-blue-200">
                    <SelectItem value="all">Import + export (default)</SelectItem>
                    <SelectItem value="purchase">Purchase / import charges only</SelectItem>
                    <SelectItem value="sales">Sales / export charges only</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col justify-end gap-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={includeDrafts} onChange={(e) => setIncludeDrafts(e.target.checked)} className="rounded border-blue-300" />
                  Include draft PI / SI / LCV / SSC
                </label>
              </div>

              <div className="flex flex-col justify-end gap-2">
                <Button onClick={handleLoadData} disabled={isLoading} className="bg-blue-700 hover:bg-blue-800 text-white px-6 w-full h-10">
                  {isLoading ? (<><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Loading…</>) : "Load Report"}
                </Button>
              </div>
            </div>

            {isConverting && (
              <div className="mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-md text-[11px] text-amber-700">
                All amounts are converted to <strong>{currency}</strong> using your Currency Exchange records.
              </div>
            )}
          </CardContent>
        </Card>

        <div ref={printRef} className="ie-report-print-root space-y-5">
          {error && (
            <Alert className="border-red-200 bg-red-50 ie-report-no-print">
              <AlertDescription className="text-red-800">{error}</AlertDescription>
            </Alert>
          )}
          {fetchError && (
            <Alert className="border-red-200 bg-red-50 ie-report-no-print">
              <AlertDescription className="text-red-800">{fetchError}</AlertDescription>
            </Alert>
          )}

          {hasLoadedData && isLoading && !data && (
            <Card className="border-blue-200 shadow-md ie-report-no-print">
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
                    {isLoading && (
                      <span className="inline-flex items-center gap-1 text-xs font-normal text-amber-200">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />Updating…
                      </span>
                    )}
                  </CardTitle>

                  {groups.length > 0 && (
                    <div className="flex gap-2 flex-wrap justify-end ie-report-no-print">
                      {printFilterActive && (
                        <Button variant="outline" size="sm" onClick={clearPrintSelection}
                          className="bg-amber-500/20 border-amber-200 text-amber-100 hover:bg-amber-500/30 text-xs h-7">
                          Clear print selection ({selectedJourneyIdsForPrint.size})
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={handleExportCsv}
                        className="bg-white/10 border-white/30 text-white hover:bg-white/20 text-xs h-7 gap-1">
                        <Download className="h-3.5 w-3.5" />Export CSV
                      </Button>

                      {/* Print — opens column picker first */}
                      <Button variant="outline" size="sm" onClick={() => openColPicker("print")}
                        className="bg-white/10 border-white/30 text-white hover:bg-white/20 text-xs h-7 gap-1"
                        title="Choose columns, then print">
                        <Printer className="h-3.5 w-3.5" />Print
                      </Button>

                      {/* PDF — opens column picker first */}
                      <Button variant="outline" size="sm" onClick={() => openColPicker("pdf")}
                        className="bg-white/10 border-white/30 text-white hover:bg-white/20 text-xs h-7 gap-1"
                        title="Choose columns, then save as PDF">
                        <FileText className="h-3.5 w-3.5" />PDF
                      </Button>

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
                <p className="ie-report-no-print px-4 py-2 text-[11px] text-slate-600 border-b border-blue-100 bg-slate-50/80">
                  <strong>Print / PDF:</strong> click the button to choose which columns to include before printing.
                  Tick journeys (first column or header checkbox) to print only those journeys.
                  Leave all unchecked for the full report.
                </p>
                <div className="overflow-x-auto">
                  <table className={`w-full border-collapse ${printSubsetActive ? "ie-print-rows-filtered" : ""}`}>
                    <thead className="sticky top-0 z-10">
                      <tr>
                        {/* print-select all — no data-col */}
                        <th className={`${TH} w-9 ie-report-no-print`} title="Select journeys for print / PDF / CSV">
                          <input
                            ref={printSelectAllRef}
                            type="checkbox"
                            checked={allJourneysSelectedForPrint && journeyIdsForPrint.length > 0}
                            onChange={togglePrintSelectAll}
                            disabled={journeyIdsForPrint.length === 0}
                            className="rounded border-blue-400 cursor-pointer"
                            aria-label="Select all journeys for print"
                          />
                        </th>
                        {/* expand chevron — no data-col */}
                        <th className={TH} style={{ width: 32 }} />

                        <th data-col="col-num"             className={TH} style={{ width: 36 }}>#</th>
                        <th data-col="col-journey"         className={TH} style={{ minWidth: 220 }}>Journey / Transit invoices</th>
                        <th data-col="col-item"            className={TH} style={{ minWidth: 110 }}>Item</th>
                        <th data-col="col-source"          className={TH} style={{ width: 74 }}>Source</th>
                        <th data-col="col-units"           className={TH} style={{ minWidth: 68 }}>Units</th>
                        <th data-col="col-price"           className={TH} style={{ minWidth: 100 }}>Price</th>
                        <th data-col="col-total-value"     className={TH} style={{ minWidth: 110 }}>Total Value</th>
                        <th data-col="col-import-cont"     className={TH} style={{ minWidth: 110 }}>Import Cont.</th>
                        <th data-col="col-export-cont"     className={TH} style={{ minWidth: 110 }}>Export Cont.</th>
                        <th data-col="col-import-bl"       className={TH} style={{ minWidth: 88 }}>Import B/L</th>
                        <th data-col="col-export-bl"       className={TH} style={{ minWidth: 88 }}>Export B/L</th>
                        <th data-col="col-destination"     className={TH} style={{ minWidth: 88 }}>Destination</th>
                        <th data-col="col-import-charges"  className={TH} style={{ minWidth: 140, background: "#d1fae5", color: "#065f46", fontWeight: 700 }}>
                          Import Charges
                          <div className="text-[9px] font-normal opacity-70 mt-0.5">Expand journey for breakdown</div>
                        </th>
                        <th data-col="col-export-charges"  className={TH} style={{ minWidth: 140, background: "#fee2e2", color: "#7f1d1d", fontWeight: 700 }}>
                          Export Charges
                          <div className="text-[9px] font-normal opacity-70 mt-0.5">SSC items + freight, storage &amp; Doonta</div>
                        </th>
                        <th data-col="col-total"           className={TH} style={{ minWidth: 110, background: "#c7d2fe", color: "#1e1b4b", fontWeight: 700 }}>Total</th>
                      </tr>
                    </thead>

                    <tbody>
                      {groups.length === 0 ? (
                        <tr>
                          <td colSpan={17} className="text-center text-gray-500 py-14 border border-gray-200 text-sm">
                            No data found. Ensure Purchase Invoices and Sales Invoices have <strong>Is Export Sale</strong> checked.
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
                            printRowInclude={
                              !printSubsetActive || selectedJourneyIdsForPrint.has(group.journeyId) ? "1" : "0"
                            }
                            printSelected={
                              printSelectionCount === 0
                                ? false
                                : allJourneysSelectedForPrint || selectedJourneyIdsForPrint.has(group.journeyId)
                            }
                            onTogglePrintSelect={() => {
                              setSelectedJourneyIdsForPrint((prev) => {
                                const n = new Set(prev)
                                if (n.has(group.journeyId)) n.delete(group.journeyId)
                                else n.add(group.journeyId)
                                return n
                              })
                            }}
                          />
                        ))
                      )}
                    </tbody>

                    {groups.length > 0 && (
                      <tfoot>
                        <tr
                          className={printSubsetActive ? "ie-print-footer-grand-total" : undefined}
                          style={{ background: "#1e3a8a" }}
                        >
                          <td
                            colSpan={14}
                            className="border border-blue-700 px-4 py-2.5 text-xs font-bold text-white text-right uppercase tracking-widest"
                          >
                            Grand Totals
                          </td>
                          <td data-col="col-import-charges" className={`${TDF} bg-emerald-50 text-emerald-900 border-emerald-200`}>
                            {gcConv(totals.total_additional_costs ?? 0)}
                          </td>
                          <td data-col="col-export-charges" className={`${TDF} bg-red-50 text-red-900 border-red-200`}>
                            {gcConv(totals.total_export_expenses ?? 0)}
                          </td>
                          <td data-col="col-total" className={`${TDF} bg-blue-200 text-blue-950 border-blue-400 text-sm`}>
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
    </div>
  )
}