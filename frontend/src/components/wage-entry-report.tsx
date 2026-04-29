"use client"

import { useState, useMemo, useRef, useEffect } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts"
import {
  RefreshCw, X, ChevronRight, Users, DollarSign, Briefcase, ArrowLeft,
  CalendarDays, Clock, Phone, Search, Filter, FileText,
  TrendingUp, CheckCircle2, AlertCircle, Building2, Layers,
  ChevronDown, Leaf, TreePine, Minus,
} from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { Button } from "./ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table"
import { Alert, AlertDescription } from "./ui/alert"

import {
  useWageSummary, useWageEntries, useWageEntryDetail,
  useWageFilterOptions, useWageProjectsForCompany, useWageTrend,
  type WageEntry, type WageFilters,
} from "../hook/useWageReport"

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, curr = ""): string {
  if (n == null || isNaN(n)) return "—"
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n)
  return curr ? `${curr} ${formatted}` : formatted
}
function fmtInt(n: number | null | undefined): string {
  return n == null ? "—" : String(Math.round(n))
}
function fmtDate(d: string | null | undefined): string {
  if (!d) return "—"
  try { return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) }
  catch { return d }
}
function toIso(t: string): string {
  if (!t) return ""
  const normalised = t.replace(" ", "T")
  if (/^\d{2}:\d{2}/.test(normalised)) return `1970-01-01T${normalised}`
  return normalised
}
function fmtTime(t: string | null | undefined): string {
  if (!t) return "—"
  try {
    const iso = toIso(t)
    const d = new Date(iso)
    if (isNaN(d.getTime())) return "—"
    return d.toTimeString().slice(0, 5)
  } catch { return "—" }
}
function duration(checkin: string, checkout: string): string {
  if (!checkin || !checkout) return "—"
  try {
    const ci = new Date(toIso(checkin))
    const co = new Date(toIso(checkout))
    if (isNaN(ci.getTime()) || isNaN(co.getTime())) return "—"
    const diff = (co.getTime() - ci.getTime()) / 60000
    if (diff <= 0) return "—"
    const h = Math.floor(diff / 60), m = Math.round(diff % 60)
    return `${h}h ${m > 0 ? ` ${m}m` : ""}`
  } catch { return "—" }
}
function stripHtml(html: string | null | undefined): string {
  if (!html) return ""
  try {
    const div = document.createElement("div")
    div.innerHTML = html
    return div.textContent?.trim() ?? ""
  } catch {
    return html.replace(/<[^>]*>/g, "").trim()
  }
}

const STATUS_CFG: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  Draft:     { bg: "bg-amber-50",   text: "text-amber-700",   border: "border-amber-300",   dot: "bg-amber-400" },
  Submitted: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-300", dot: "bg-emerald-500" },
  Paid:      { bg: "bg-blue-50",    text: "text-blue-700",    border: "border-blue-300",    dot: "bg-blue-500" },
  Unpaid:    { bg: "bg-amber-50",   text: "text-amber-700",   border: "border-amber-300",   dot: "bg-amber-400" },
  Cancelled: { bg: "bg-red-50",     text: "text-red-700",     border: "border-red-300",     dot: "bg-red-500" },
}

const ALL_VAL = "__all__"

// ── Searchable Combobox ───────────────────────────────────────────────────────

interface ComboboxOption {
  value: string
  label: string
}

interface SearchableComboboxProps {
  value: string
  onChange: (val: string) => void
  options: ComboboxOption[]
  placeholder?: string
  allLabel?: string
  className?: string
  disabled?: boolean
}

function SearchableCombobox({
  value,
  onChange,
  options,
  placeholder = "Select…",
  allLabel = "All",
  className = "",
  disabled = false,
}: SearchableComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const allOption: ComboboxOption = { value: ALL_VAL, label: allLabel }
  const allOptions = [allOption, ...options]

  const filtered = useMemo(() => {
    if (!query.trim()) return allOptions
    const q = query.toLowerCase()
    return allOptions.filter(o => o.label.toLowerCase().includes(q))
  }, [query, options])

  const selectedLabel = allOptions.find(o => o.value === value)?.label ?? placeholder

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery("")
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  function handleOpen() {
    setOpen(o => !o)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  function handleSelect(val: string) {
    onChange(val)
    setOpen(false)
    setQuery("")
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Trigger button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => { if (!disabled) handleOpen() }}
        className={`
          w-full h-9 px-3 pr-8 text-sm text-left rounded-md border
          flex items-center justify-between gap-2
          transition-all duration-150
          ${disabled ? "opacity-60 cursor-not-allowed border-green-100 bg-slate-50" : ""}
          ${!disabled && open
            ? "border-green-500 ring-2 ring-green-200 bg-green-50"
            : !disabled ? "border-green-200 bg-white hover:border-green-400 hover:bg-green-50/40" : ""
          }
          text-slate-700 font-medium
        `}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown className={`h-3.5 w-3.5 text-green-600 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="
          absolute left-0 top-full mt-1 z-50 min-w-full w-max max-w-xs
          rounded-xl border border-green-200 shadow-xl
          bg-green-50/95 backdrop-blur-sm
          overflow-hidden
        ">
          {/* Search input */}
          <div className="p-2 border-b border-green-200 bg-green-100/70">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-green-600" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search…"
                className="
                  w-full pl-8 pr-3 py-1.5 text-sm rounded-lg
                  border border-green-300 bg-white/80
                  focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-green-400
                  placeholder:text-green-400 text-slate-700
                "
              />
            </div>
          </div>

          {/* Options list */}
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-sm text-green-600 text-center">No results</div>
            ) : (
              filtered.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleSelect(opt.value)}
                  className={`
                    w-full text-left px-3 py-2 text-sm transition-colors
                    ${opt.value === value
                      ? "bg-green-600 text-white font-semibold"
                      : "text-slate-700 hover:bg-green-200/60 hover:text-green-900"
                    }
                  `}
                >
                  {opt.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({ icon, label, value, sub, gradient }: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string; gradient: string
}) {
  return (
    <Card className="border-green-100 shadow-sm hover:shadow-md transition-shadow">
      <CardContent className="p-5">
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} text-white flex items-center justify-center shadow-sm`}>
          {icon}
        </div>
        <p className="text-2xl font-bold text-slate-800 mt-3">{value}</p>
        <p className="text-sm font-medium text-slate-500 mt-0.5">{label}</p>
        {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
      </CardContent>
    </Card>
  )
}

// ── Detail Panel ─────────────────────────────────────────────────────────────

function DetailPanel({ entryName, onClose }: { entryName: string | null; onClose: () => void }) {
  const { data, loading, error } = useWageEntryDetail(entryName)
  const [view, setView] = useState<"workers" | "worktype">("workers")
  const [search, setSearch] = useState("")

  const filteredWorkers = useMemo(() => {
    if (!data?.wages) return []
    if (!search) return data.wages
    const q = search.toLowerCase()
    return data.wages.filter(w =>
      w.name1.toLowerCase().includes(q) ||
      w.type_of_work.toLowerCase().includes(q) ||
      w.phone_no.toLowerCase().includes(q)
    )
  }, [data?.wages, search])

  const cfg = data ? (STATUS_CFG[data.docstatus === 1 ? "Submitted" : "Draft"] ?? STATUS_CFG.Draft) : STATUS_CFG.Draft

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-white shadow-2xl flex flex-col border-l border-green-100">
      {/* Header */}
      <div className="bg-gradient-to-r from-green-700 to-emerald-800 text-white p-5 flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <FileText className="h-4 w-4 opacity-75" />{entryName}
          </h2>
          {data && (
            <p className="text-green-200 text-sm mt-0.5">
              {fmtDate(data.date)} · {data.project || "No Project"} {data.stage ? `· ${data.stage}` : ""}
            </p>
          )}
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-green-600 transition-colors">
          <X className="h-5 w-5" />
        </button>
      </div>

      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <RefreshCw className="h-6 w-6 text-green-500 animate-spin" />
        </div>
      )}
      {error && <div className="p-4"><Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert></div>}

      {data && !loading && (
        <div className="flex-1 overflow-y-auto">
          <div className="p-4 grid grid-cols-3 gap-3">
            <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
              <p className="text-xs text-green-600 font-medium">Workers</p>
              <p className="text-2xl font-bold text-green-800">{data.total_qty}</p>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
              <p className="text-xs text-emerald-600 font-medium">Total Amount</p>
              <p className="text-xl font-bold text-emerald-800">{fmt(data.total_amount)}</p>
            </div>
            <div className={`${cfg.bg} border ${cfg.border} rounded-xl p-3 text-center`}>
              <p className={`text-xs font-medium ${cfg.text}`}>Status</p>
              <p className={`text-lg font-bold ${cfg.text}`}>{data.docstatus === 1 ? "Submitted" : "Draft"}</p>
            </div>
          </div>

          <div className="px-4 pb-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              {data.company && <div className="bg-slate-50 rounded-lg px-3 py-2"><p className="text-xs text-slate-400">Company</p><p className="font-medium">{data.company}</p></div>}
              {data.wage_type && <div className="bg-slate-50 rounded-lg px-3 py-2"><p className="text-xs text-slate-400">Wage Type</p><p className="font-medium">{data.wage_type}</p></div>}
              {data.start_date && <div className="bg-slate-50 rounded-lg px-3 py-2"><p className="text-xs text-slate-400">Period Start</p><p className="font-medium">{fmtDate(data.start_date)}</p></div>}
              {data.end_date && <div className="bg-slate-50 rounded-lg px-3 py-2"><p className="text-xs text-slate-400">Period End</p><p className="font-medium">{fmtDate(data.end_date)}</p></div>}
              {data.average_working_hours > 0 && <div className="bg-slate-50 rounded-lg px-3 py-2"><p className="text-xs text-slate-400">Avg Working Hrs</p><p className="font-medium">{data.average_working_hours}h</p></div>}
              {data.wage_category && <div className="bg-slate-50 rounded-lg px-3 py-2"><p className="text-xs text-slate-400">Category</p><p className="font-medium">{data.wage_category}</p></div>}
            </div>
            {data.description && (
              <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm text-amber-800">{stripHtml(data.description)}</div>
            )}
          </div>

          <div className="px-4 pb-2 flex gap-2 border-b border-green-100">
            <button onClick={() => setView("workers")}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${view === "workers" ? "bg-green-700 text-white shadow-sm" : "text-green-700 hover:bg-green-50"}`}>
              <Users className="h-3.5 w-3.5 inline mr-1.5" />Workers ({data.wages.length})
            </button>
            <button onClick={() => setView("worktype")}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${view === "worktype" ? "bg-green-700 text-white shadow-sm" : "text-green-700 hover:bg-green-50"}`}>
              <Layers className="h-3.5 w-3.5 inline mr-1.5" />By Work Type ({data.work_breakdown.length})
            </button>
          </div>

          {view === "workers" && (
            <div className="p-4 space-y-3">
              {data.wages.length > 5 && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    className="w-full pl-9 pr-3 py-2 text-sm border border-green-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300"
                    placeholder="Search worker / type of work…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
              )}
              {filteredWorkers.length === 0 ? (
                <div className="text-center py-10 text-slate-400"><Users className="h-8 w-8 mx-auto mb-2 opacity-40" /><p>No workers</p></div>
              ) : (
                filteredWorkers.map(w => (
                  <div key={w.idx} className="rounded-xl border border-green-100 bg-white shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 bg-green-50">
                      <div>
                        <p className="font-semibold text-slate-800">{w.name1 || `Worker #${w.idx}`}</p>
                        <p className="text-xs text-green-700 mt-0.5">{w.type_of_work || "—"}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-green-800">{fmt(w.amount)}</p>
                        <p className="text-xs text-slate-400">{fmtInt(w.qty)} × {fmt(w.rate)}</p>
                      </div>
                    </div>
                    <div className="px-4 py-3 grid grid-cols-2 gap-2 text-sm">
                      <div className="flex items-center gap-1.5 text-slate-600">
                        <Clock className="h-3.5 w-3.5 text-green-500 shrink-0" />
                        <span className="text-xs">In: <b>{fmtTime(w.checkin)}</b></span>
                      </div>
                      <div className="flex items-center gap-1.5 text-slate-600">
                        <Clock className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                        <span className="text-xs">Out: <b>{fmtTime(w.checkout)}</b></span>
                      </div>
                      {(w.checkin && w.checkout) && (
                        <div className="flex items-center gap-1.5 text-slate-500 col-span-2">
                          <CalendarDays className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          <span className="text-xs">Duration: <b>{duration(w.checkin, w.checkout)}</b></span>
                        </div>
                      )}
                      {w.phone_no && (
                        <div className="flex items-center gap-1.5 col-span-2">
                          <Phone className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          <a href={`tel:${w.phone_no}`} className="text-xs text-green-700 hover:underline">{w.phone_no}</a>
                        </div>
                      )}
                      {w.description && (
                        <div className="col-span-2 text-xs text-slate-500 bg-amber-50 rounded px-2 py-1">{stripHtml(w.description)}</div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {view === "worktype" && (
            <div className="p-4">
              {data.work_breakdown.length === 0 ? (
                <div className="text-center py-10 text-slate-400"><Layers className="h-8 w-8 mx-auto mb-2 opacity-40" /><p>No work type breakdown</p></div>
              ) : (
                <div className="space-y-2">
                  {data.work_breakdown.map((wt, i) => (
                    <div key={i} className="rounded-xl border border-green-100 bg-white shadow-sm p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-slate-800">{wt.type_of_work || "—"}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{wt.no_of_workers} workers · {fmt(wt.total_qty)} qty · {fmt(wt.daily_wage)}/day</p>
                        </div>
                        <p className="font-bold text-green-800 text-lg">{fmt(wt.total_amount)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Wage Entry row ────────────────────────────────────────────────────────────

function WageEntryRow({ entry, onOpen }: { entry: WageEntry; onOpen: () => void }) {
  const cfg = STATUS_CFG[entry.status_label] ?? STATUS_CFG.Draft
  const checkoutUi = entry.checkout_state === "checked_out"
    ? {
      label: "Checked out",
      title: "All check-ins have check-outs",
      icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />,
      cls: "bg-emerald-50 text-emerald-700 border-emerald-300",
    }
    : entry.checkout_state === "not_checked_out"
      ? {
        label: "Not checked out",
        title: "Has check-in rows pending check-out",
        icon: <AlertCircle className="h-3.5 w-3.5 text-amber-600" />,
        cls: "bg-amber-50 text-amber-700 border-amber-300",
      }
      : {
        label: "—",
        title: "Legacy entry (before check-in/out tracking)",
        icon: <Minus className="h-3.5 w-3.5 text-slate-500" />,
        cls: "bg-slate-50 text-slate-600 border-slate-300",
      }
  return (
    <TableRow
      className="hover:bg-green-50/60 cursor-pointer transition-colors group"
      onClick={onOpen}
    >
      <TableCell className="pl-4">
        <p className="font-semibold text-slate-800 text-sm group-hover:text-green-700 transition-colors">{entry.name}</p>
        {entry.wage_type && <p className="text-xs text-slate-400">{entry.wage_type}</p>}
      </TableCell>
      <TableCell className="text-sm text-slate-700">{fmtDate(entry.date)}</TableCell>
      <TableCell>
        <p className="text-sm text-slate-700 font-medium">{entry.project || "—"}</p>
        {entry.stage && <p className="text-xs text-slate-400">{entry.stage}</p>}
      </TableCell>
      <TableCell className="text-sm text-slate-500">{entry.company || "—"}</TableCell>
      <TableCell className="text-center">
        <div className="flex items-center justify-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-green-500" />
          <span className="font-semibold text-slate-800 text-sm">{entry.total_qty}</span>
        </div>
      </TableCell>
      <TableCell className="text-right">
        <span className="font-bold text-green-800 text-sm">{fmt(entry.total_amount, entry.currency)}</span>
      </TableCell>
      <TableCell className="text-center">
        <div className="inline-flex items-center gap-1.5">
          <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />{entry.status_label}
          </span>
          <span
            title={checkoutUi.title}
            className={`inline-flex items-center justify-center rounded-full border px-1.5 py-0.5 ${checkoutUi.cls}`}
          >
            {checkoutUi.icon}
            <span className="sr-only">{checkoutUi.label}</span>
          </span>
        </div>
      </TableCell>
      <TableCell className="pr-4">
        <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-green-600 transition-colors" />
      </TableCell>
    </TableRow>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

type TabId = "list" | "trend"

export default function WageEntryReport() {
  const [tab, setTab] = useState<TabId>("list")
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null)

  const [project, setProject]   = useState<string>(ALL_VAL)
  const [company, setCompany]   = useState<string>(ALL_VAL)
  const [status, setStatus]     = useState<string>(ALL_VAL)
  const [dateFrom, setDateFrom] = useState<string>("")
  const [dateTo, setDateTo]     = useState<string>("")
  const [pendingCheckout, setPendingCheckout] = useState<boolean>(false)
  const [search, setSearch]     = useState<string>("")

  const { companies: companyOpts, statuses: statusOpts, loading: filterOptsLoading } = useWageFilterOptions()
  const { projects: projectOpts, loading: projectsLoading } = useWageProjectsForCompany(company, ALL_VAL)

  /** Reset project when company changes — projects are scoped by company */
  useEffect(() => {
    setProject(ALL_VAL)
  }, [company])

  /** One permitted company → select it automatically (same idea as narrowing scope on backend) */
  useEffect(() => {
    if (!filterOptsLoading && companyOpts.length === 1 && company === ALL_VAL) {
      setCompany(companyOpts[0].value)
    }
  }, [filterOptsLoading, companyOpts, company])

  /** Clear company selection if no longer permitted */
  useEffect(() => {
    if (filterOptsLoading || company === ALL_VAL || companyOpts.length === 0) return
    if (!companyOpts.some(c => c.value === company)) {
      setCompany(ALL_VAL)
    }
  }, [company, companyOpts, filterOptsLoading])

  const filters: WageFilters = useMemo(() => ({
    project: project !== ALL_VAL ? project : undefined,
    company: company !== ALL_VAL ? company : undefined,
    status:  status  !== ALL_VAL ? status  : undefined,
    date_from: dateFrom || undefined,
    date_to:   dateTo   || undefined,
    pending_checkout: pendingCheckout || undefined,
  }), [project, company, status, dateFrom, dateTo, pendingCheckout])

  const { data: summary, loading: sumLoading, reload: sumReload } = useWageSummary(filters)
  const { data: entries, loading: listLoading, error: listError, reload: listReload } = useWageEntries(filters)
  const { data: trend, loading: trendLoading } = useWageTrend(
    project !== ALL_VAL ? project : undefined,
    company !== ALL_VAL ? company : undefined,
  )

  function setToday() {
    const t = new Date().toISOString().slice(0, 10)
    setDateFrom(t); setDateTo(t)
  }
  function clearDates() { setDateFrom(""); setDateTo(""); setPendingCheckout(false) }
  function reload() { sumReload(); listReload() }

  const filteredEntries = useMemo(() => {
    if (!search) return entries
    const q = search.toLowerCase()
    return entries.filter(e =>
      e.name.toLowerCase().includes(q) ||
      e.project.toLowerCase().includes(q) ||
      e.stage.toLowerCase().includes(q) ||
      e.company.toLowerCase().includes(q)
    )
  }, [entries, search])

  const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: "list",  label: "Wage Entries", icon: <FileText className="h-4 w-4" /> },
    { id: "trend", label: "Trend",        icon: <TrendingUp className="h-4 w-4" /> },
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-emerald-50 p-4">
      {selectedEntry && <div className="fixed inset-0 bg-black/30 z-40 backdrop-blur-[1px]" onClick={() => setSelectedEntry(null)} />}
      {selectedEntry && <DetailPanel entryName={selectedEntry} onClose={() => setSelectedEntry(null)} />}

      <div className="max-w-8xl mx-auto space-y-6">

        {/* ── Page header ── */}
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            className="border-green-300 text-green-700 hover:bg-green-50 flex items-center gap-2"
            onClick={() => window.location.assign(`${window.location.origin}/app`)}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Desk
          </Button>
          <div className="text-center space-y-2 flex-1">
            <div className="flex items-center justify-center gap-3">
              <div className="p-2 bg-gradient-to-br from-green-600 to-emerald-700 rounded-xl text-white shadow-md">
                <Leaf className="h-6 w-6" />
              </div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-green-700 to-emerald-800 bg-clip-text text-transparent">
                Wage Entry Report
              </h1>
            </div>
            <p className="text-slate-500 text-base">Track daily wages · worker check-in/out · project breakdowns</p>
          </div>
          <Button variant="outline" className="border-green-300 text-green-700 hover:bg-green-50 flex items-center gap-2" onClick={reload}>
            <RefreshCw className={`h-4 w-4 ${sumLoading || listLoading ? "animate-spin" : ""}`} />Refresh
          </Button>
        </div>

        {/* ── Filters ── */}
        <Card className="border-green-200 shadow-sm">
          <CardContent className="p-4">
            {/*
              All labels sit in a CSS grid row at the top,
              all inputs sit in the second row at the bottom.
              Each column is sized to its input width.
            */}
            <div
              className="grid items-end gap-x-3 gap-y-1"
              style={{ gridTemplateColumns: "11rem 11rem 9rem 10rem 10rem 12rem auto" }}
            >
              {/* ── ROW 1: labels ── */}
              <label className="text-xs font-semibold text-green-700 uppercase tracking-wide flex items-center gap-1">
                <Building2 className="h-3 w-3" />Company
              </label>
              <label className="text-xs font-semibold text-green-700 uppercase tracking-wide flex items-center gap-1">
                <Briefcase className="h-3 w-3" />Project
              </label>
              <label className="text-xs font-semibold text-green-700 uppercase tracking-wide flex items-center gap-1">
                <Filter className="h-3 w-3" />Status
              </label>
              <label className="text-xs font-semibold text-green-700 uppercase tracking-wide flex items-center gap-1">
                <CalendarDays className="h-3 w-3" />Date From
              </label>
              <label className="text-xs font-semibold text-green-700 uppercase tracking-wide">
                Date To
              </label>
              <label className="text-xs font-semibold text-green-700 uppercase tracking-wide">
                Check-Out
              </label>
              {/* empty header cell for buttons column */}
              <span />

              {/* ── ROW 2: fields ── */}
              <SearchableCombobox
                value={company}
                onChange={setCompany}
                options={companyOpts}
                allLabel="All Companies"
                className="w-full"
                disabled={filterOptsLoading && companyOpts.length === 0}
              />
              <SearchableCombobox
                value={project}
                onChange={setProject}
                options={projectOpts}
                allLabel={company === ALL_VAL ? "Select company first" : "All Projects"}
                className="w-full"
                disabled={company === ALL_VAL || filterOptsLoading || projectsLoading}
              />
              <SearchableCombobox
                value={status}
                onChange={setStatus}
                options={statusOpts}
                allLabel="All Status"
                className="w-full"
              />
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="h-9 px-3 text-sm border border-green-200 rounded-md focus:outline-none focus:ring-2 focus:ring-green-300 bg-white hover:border-green-400 w-full"
              />
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="h-9 px-3 text-sm border border-green-200 rounded-md focus:outline-none focus:ring-2 focus:ring-green-300 bg-white hover:border-green-400 w-full"
              />
              <label className="h-9 px-3 text-sm border border-green-200 rounded-md bg-white hover:border-green-400 w-full inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={pendingCheckout}
                  onChange={e => setPendingCheckout(e.target.checked)}
                  className="h-4 w-4 accent-amber-600"
                />
                <span className="text-slate-700">Pending only</span>
              </label>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="border-green-300 text-green-700 hover:bg-green-50 whitespace-nowrap" onClick={setToday}>
                  Today
                </Button>
                {(dateFrom || dateTo || pendingCheckout) && (
                  <Button size="sm" variant="ghost" className="text-slate-400 hover:text-slate-600" onClick={clearDates}>
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── KPI cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-4">
          <KpiCard icon={<FileText className="h-5 w-5"/>}     label="Total Entries"  value={summary?.total_entries ?? "—"}              gradient="from-green-600 to-green-800"/>
          <KpiCard icon={<DollarSign className="h-5 w-5"/>}   label="Total Amount"   value={summary ? fmt(summary.total_amount) : "—"}  gradient="from-emerald-500 to-emerald-700"/>
          <KpiCard icon={<Users className="h-5 w-5"/>}        label="Total Workers"  value={summary?.total_workers ?? "—"}              gradient="from-teal-500 to-teal-700"/>
          <KpiCard icon={<Briefcase className="h-5 w-5"/>}    label="Projects"       value={summary?.unique_projects ?? "—"}            gradient="from-green-700 to-emerald-800"/>
          <KpiCard icon={<CheckCircle2 className="h-5 w-5"/>} label="Submitted"      value={summary?.submitted_count ?? "—"}            gradient="from-emerald-600 to-emerald-800"/>
          <KpiCard icon={<AlertCircle className="h-5 w-5"/>}  label="Draft"          value={summary?.draft_count ?? "—"}                gradient="from-amber-500 to-amber-700"/>
          <KpiCard icon={<CalendarDays className="h-5 w-5"/>} label="Today Entries"  value={summary?.today_count ?? "—"}                gradient="from-green-600 to-teal-700"/>
          <KpiCard icon={<TrendingUp className="h-5 w-5"/>}   label="Today Amount"   value={summary ? fmt(summary.today_amount) : "—"}  gradient="from-teal-600 to-emerald-700"/>
        </div>

        {/* ── Main card ── */}
        <Card className="border-green-200 shadow-lg">
          <CardHeader className="bg-gradient-to-r from-green-700 to-emerald-800 text-white rounded-t-lg p-0">
            <div className="flex items-center">
              {TABS.map((t, i) => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`flex items-center gap-2 px-6 py-4 text-sm font-semibold whitespace-nowrap transition-all shrink-0
                    ${i === 0 ? "rounded-tl-lg" : ""}
                    ${tab === t.id ? "bg-white/20 border-b-2 border-white text-white" : "text-green-200 hover:text-white hover:bg-white/10"}`}>
                  {t.icon}{t.label}
                </button>
              ))}
            </div>
          </CardHeader>

          {/* ── LIST TAB ── */}
          {tab === "list" && (
            <CardContent className="p-4 space-y-4">
              {listError && <Alert variant="destructive"><AlertDescription>{listError}</AlertDescription></Alert>}

              <div className="flex items-center gap-3">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    className="w-full pl-9 pr-3 py-2 text-sm border border-green-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-300"
                    placeholder="Search entry / project / stage…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
                <p className="text-sm text-slate-500 ml-auto">{filteredEntries.length} entries</p>
              </div>

              {listLoading ? (
                <div className="flex items-center justify-center py-16"><RefreshCw className="h-6 w-6 text-green-500 animate-spin"/></div>
              ) : filteredEntries.length === 0 ? (
                <div className="text-center py-20 text-slate-400">
                  <TreePine className="h-12 w-12 mx-auto mb-3 opacity-30"/>
                  <p className="font-medium">No wage entries found</p>
                  <p className="text-sm">Try adjusting your filters</p>
                </div>
              ) : (
                <div className="rounded-xl border border-green-100 overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-green-50">
                        <TableHead className="text-green-800 text-xs font-semibold pl-4">Entry</TableHead>
                        <TableHead className="text-green-800 text-xs font-semibold">Date</TableHead>
                        <TableHead className="text-green-800 text-xs font-semibold">Project / Stage</TableHead>
                        <TableHead className="text-green-800 text-xs font-semibold">Company</TableHead>
                        <TableHead className="text-green-800 text-xs font-semibold text-center">Workers</TableHead>
                        <TableHead className="text-green-800 text-xs font-semibold text-right">Amount</TableHead>
                        <TableHead className="text-green-800 text-xs font-semibold text-center">Status</TableHead>
                        <TableHead className="pr-4"/>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredEntries.map(e => (
                        <WageEntryRow key={e.name} entry={e} onOpen={() => setSelectedEntry(e.name)} />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          )}

          {/* ── TREND TAB ── */}
          {tab === "trend" && (
            <CardContent className="p-6 space-y-4">
              <p className="text-sm text-slate-500">Daily wage amounts — last 30 days</p>
              {trendLoading ? (
                <div className="flex items-center justify-center py-16"><RefreshCw className="h-6 w-6 text-green-500 animate-spin"/></div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                  <Card className="border-green-100 shadow-sm">
                    <CardHeader className="bg-gradient-to-r from-green-700 to-emerald-800 text-white rounded-t-lg px-5 py-3">
                      <CardTitle className="flex items-center gap-2 text-sm font-semibold"><DollarSign className="h-4 w-4"/>Daily Amount (30 days)</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4 pr-2">
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={trend}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0fdf4"/>
                          <XAxis dataKey="date_label" tick={{fontSize:10}} interval={4}/>
                          <YAxis tick={{fontSize:10}} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)}/>
                          <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{fontSize:12, borderRadius:8}}/>
                          <Bar dataKey="amount" name="Amount" fill="#16a34a" radius={[3,3,0,0]}/>
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>

                  <Card className="border-green-100 shadow-sm">
                    <CardHeader className="bg-gradient-to-r from-green-700 to-emerald-800 text-white rounded-t-lg px-5 py-3">
                      <CardTitle className="flex items-center gap-2 text-sm font-semibold"><Users className="h-4 w-4"/>Daily Workers (30 days)</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4 pr-2">
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={trend}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0fdf4"/>
                          <XAxis dataKey="date_label" tick={{fontSize:10}} interval={4}/>
                          <YAxis tick={{fontSize:10}}/>
                          <Tooltip contentStyle={{fontSize:12, borderRadius:8}}/>
                          <Bar dataKey="workers" name="Workers" fill="#059669" radius={[3,3,0,0]}/>
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                </div>
              )}
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  )
}