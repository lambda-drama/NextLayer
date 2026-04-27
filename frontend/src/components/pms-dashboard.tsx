"use client"

import { useEffect, useState, useMemo } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts"
import {
  Building2, Home, Users, TrendingUp, AlertCircle, CheckCircle2,
  Clock, DollarSign, Activity, RefreshCw, X, ChevronRight,
  Wallet, FileText, Zap, BarChart3, MapPin, Phone, Mail,
  ChevronDown, ChevronUp, CalendarDays, Layers, UserCircle, FilterX,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { Button } from "./ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Alert, AlertDescription } from "./ui/alert"

import {
  useDashboardOverview,
  useFinancialOverview,
  useUnitDetail,
  useAvailableMonths,
  usePropertiesFinancial,
  useUnitsOverview,
  useUnitMonthBreakdown,
  useTenantsContactList,
  type UnitFinancial,
  type UnitPaymentStatus,
  type UnitOverview,
  type UnitPayStatus,
  type PropertyFinancial,
  type MonthBreakdown,
} from "../hook/usePMSDashboard"

// ── Desk navigation (Frappe list) ───────────────────────────────────────────

function deskListPath(doctype: string): string {
  const slug = doctype.trim().toLowerCase().replace(/\s+/g, "-")
  return `${window.location.origin}/app/${slug}`
}

/** Open DocType list in Desk. `filters` is Frappe filter array, e.g. [["status","=","Active"]]. */
function navigateDeskList(doctype: string, filters?: unknown[][]): void {
  const path = deskListPath(doctype)
  if (filters?.length) {
    const u = new URL(path)
    u.searchParams.set("filters", JSON.stringify(filters))
    window.location.assign(u.toString())
  } else {
    window.location.assign(path)
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—"
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}
function fmtDate(d: string | null | undefined): string {
  if (!d) return "—"
  try { return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) }
  catch { return d }
}

// ── Status configs ────────────────────────────────────────────────────────────

const FINANCIAL_STATUS: Record<UnitPaymentStatus, { label: string; border: string; bg: string; dot: string; badge: string }> = {
  paid:        { label: "Paid",        border: "border-emerald-300", bg: "bg-emerald-50", dot: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  outstanding: { label: "Outstanding", border: "border-amber-300",   bg: "bg-amber-50",   dot: "bg-amber-500",  badge: "bg-amber-100 text-amber-800 border-amber-200" },
  overdue:     { label: "Overdue",     border: "border-red-400",     bg: "bg-red-50",     dot: "bg-red-500",    badge: "bg-red-100 text-red-800 border-red-200" },
  no_invoice:  { label: "No Invoice",  border: "border-slate-200",   bg: "bg-slate-50",   dot: "bg-slate-400",  badge: "bg-slate-100 text-slate-600 border-slate-200" },
}
const UNIT_STATUS: Record<UnitPayStatus, { label: string; border: string; bg: string; dot: string; badge: string }> = {
  paid:        { label: "Paid",        border: "border-emerald-300", bg: "bg-emerald-50", dot: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  outstanding: { label: "Outstanding", border: "border-amber-300",   bg: "bg-amber-50",   dot: "bg-amber-500",  badge: "bg-amber-100 text-amber-800 border-amber-200" },
  overdue:     { label: "Overdue",     border: "border-red-400",     bg: "bg-red-50",     dot: "bg-red-500",    badge: "bg-red-100 text-red-800 border-red-200" },
  vacant:      { label: "Vacant",      border: "border-slate-200",   bg: "bg-slate-50",   dot: "bg-slate-400",  badge: "bg-slate-100 text-slate-500 border-slate-200" },
}
const MONTH_STATUS: Record<string, { bg: string; text: string; border: string }> = {
  paid:        { bg: "bg-emerald-500", text: "text-white", border: "border-emerald-500" },
  outstanding: { bg: "bg-amber-400",  text: "text-white", border: "border-amber-400" },
  overdue:     { bg: "bg-red-500",    text: "text-white", border: "border-red-500" },
  no_invoice:  { bg: "bg-slate-200",  text: "text-slate-500", border: "border-slate-200" },
}
const LEASE_COLORS: Record<string, string> = {
  Active: "#ca8a04", Expired: "#f59e0b", Draft: "#94a3b8",
  Terminated: "#ef4444", Signed: "#10b981", Renewed: "#d97706",
}

const CURRENT_MONTH = "__current__"
const ALL_PROPS     = "__all__"

// ── Small components ──────────────────────────────────────────────────────────

interface KpiCardProps {
  icon: React.ReactNode; label: string; value: string | number; sub?: string
  tone?: "gold"|"green"|"amber"|"red"|"slate"
  onClick?: () => void
}
function KpiCard({ icon, label, value, sub, tone = "gold", onClick }: KpiCardProps) {
  const g = {
    gold: "from-amber-500 to-amber-800",
    green: "from-emerald-500 to-teal-600",
    amber: "from-amber-500 to-amber-700",
    red: "from-red-500 to-red-600",
    slate: "from-stone-500 to-stone-700",
  }
  const body = (
    <>
      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${g[tone]} text-white flex items-center justify-center shadow-sm`}>{icon}</div>
      <p className="text-2xl font-bold text-slate-800 mt-3">{value}</p>
      <p className="text-sm font-medium text-slate-500 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </>
  )
  const cardClass =
    "rounded-xl border border-emerald-100/80 shadow-sm bg-white hover:shadow-md transition-shadow" +
    (onClick ? " hover:border-amber-300/60 cursor-pointer w-full text-left" : "")
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cardClass}>
        <div className="p-5">{body}</div>
      </button>
    )
  }
  return (
    <Card className={cardClass}>
      <CardContent className="p-5">{body}</CardContent>
    </Card>
  )
}

// ── Screenshot-style summary card ────────────────────────────────────────────

type MetricTone = "default" | "green" | "red" | "amber" | "blue"
interface MetricRow { label: string; value: string | number; tone?: MetricTone }

const TONE_VALUE: Record<MetricTone, string> = {
  default: "text-slate-800",
  green:   "text-emerald-600",
  red:     "text-red-600",
  amber:   "text-amber-600",
  blue:    "text-amber-800",
}

type MetricRowNav = MetricRow & { onNavigate?: () => void }

interface SummaryCardProps {
  title: string
  icon: React.ReactNode
  gradient: string
  loading?: boolean
  rows?: MetricRowNav[]
  pairs?: MetricRowNav[]
}
function SummaryCard({ title, icon, gradient, loading, rows = [], pairs = [] }: SummaryCardProps) {
  return (
    <Card className="border-slate-200 shadow-md overflow-hidden">
      <div className={`bg-gradient-to-r ${gradient} text-white px-5 py-3.5 flex items-center gap-2.5`}>
        <div className="p-1.5 bg-white/20 rounded-lg ring-1 ring-amber-200/30">{icon}</div>
        <span className="font-bold text-base">{title}</span>
      </div>
      <CardContent className="p-0 divide-y divide-slate-100">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-5 w-5 text-amber-400 animate-spin"/>
          </div>
        ) : (
          <>
            {rows.map((r, i) => {
              const val = <span className={`text-sm font-bold ${TONE_VALUE[r.tone ?? "default"]}`}>{r.value}</span>
              if (r.onNavigate) {
                return (
                  <button key={i} type="button" onClick={r.onNavigate}
                    className="flex w-full items-center justify-between px-5 py-3 text-left hover:bg-amber-50/80 transition-colors">
                    <span className="text-sm text-slate-500">{r.label}</span>
                    {val}
                  </button>
                )
              }
              return (
                <div key={i} className="flex items-center justify-between px-5 py-3">
                  <span className="text-sm text-slate-500">{r.label}</span>
                  {val}
                </div>
              )
            })}
            {pairs.length > 0 && (
              <div className="grid grid-cols-2 divide-x divide-slate-100">
                {pairs.map((p, i) => {
                  const body = (
                    <>
                      <span className={`text-xl font-extrabold ${TONE_VALUE[p.tone ?? "default"]}`}>{p.value}</span>
                      <span className="text-xs text-slate-400 mt-0.5 text-center">{p.label}</span>
                    </>
                  )
                  if (p.onNavigate) {
                    return (
                      <button key={i} type="button" onClick={p.onNavigate}
                        className="flex flex-col items-center py-4 px-3 hover:bg-amber-50/80 transition-colors">
                        {body}
                      </button>
                    )
                  }
                  return (
                    <div key={i} className="flex flex-col items-center py-4 px-3">
                      {body}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}


function MonthTile({ m }: { m: MonthBreakdown }) {
  const cfg = MONTH_STATUS[m.status] ?? MONTH_STATUS.no_invoice
  const [hover, setHover] = useState(false)
  return (
    <div className="relative"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className={`rounded-lg border-2 ${cfg.border} ${cfg.bg} ${cfg.text} p-2 text-center cursor-default select-none
        ${m.is_current ? "ring-2 ring-amber-400 ring-offset-1" : ""}`}>
        <p className="text-xs font-bold">{m.month_short}</p>
        <p className="text-[10px] opacity-75">{m.year}</p>
      </div>
      {hover && m.status !== "no_invoice" && (
        <div className="absolute z-10 bottom-full left-1/2 -translate-x-1/2 mb-2 w-36
          bg-white border border-slate-200 rounded-lg shadow-lg p-2.5 text-xs pointer-events-none">
          <p className="font-semibold text-slate-700 mb-1">{m.month_label}</p>
          <div className="space-y-1">
            <div className="flex justify-between"><span className="text-slate-500">Invoiced</span><span className="font-medium">{fmt(m.invoiced)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Paid</span><span className="font-medium text-emerald-700">{fmt(m.paid)}</span></div>
            {m.outstanding > 0 && <div className="flex justify-between"><span className="text-slate-500">Due</span><span className="font-medium text-amber-700">{fmt(m.outstanding)}</span></div>}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Unit detail panel ─────────────────────────────────────────────────────────

function UnitDetailPanel({ unitName, onClose }: { unitName: string | null; onClose: () => void }) {
  const { data, loading, error } = useUnitDetail(unitName)
  const { data: breakdown, loading: bkLoading } = useUnitMonthBreakdown(unitName)

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-white shadow-2xl flex flex-col border-l border-emerald-100">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-700 via-amber-700 to-amber-950 text-white p-5 flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Home className="h-4 w-4 opacity-75" />{unitName}
          </h2>
          <p className="text-emerald-200 text-sm mt-0.5 flex items-center gap-1">
            <MapPin className="h-3 w-3" />{data?.property || "—"}
          </p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-emerald-700 transition-colors">
          <X className="h-5 w-5" />
        </button>
      </div>

      {(loading || bkLoading) && <div className="flex-1 flex items-center justify-center"><RefreshCw className="h-6 w-6 text-amber-600 animate-spin" /></div>}
      {error && <div className="p-4"><Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert></div>}

      {data && !loading && (
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">

          {/* Unit status + basic info */}
          <section className="p-5">
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
                data.unit_status === "Occupied" ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                : "bg-slate-50 text-slate-600 border-slate-200"
              }`}>{data.unit_status}</span>
              {data.contract && (
                <span className="text-xs font-medium px-2.5 py-1 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
                  Active Contract
                </span>
              )}
            </div>
            {(data as any)?.area || (data as any)?.floor ? (
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                {(data as any).area && <div><p className="text-slate-400 text-xs">Area</p><p className="font-medium">{(data as any).area}</p></div>}
                {(data as any).floor && <div><p className="text-slate-400 text-xs">Floor</p><p className="font-medium">{(data as any).floor}</p></div>}
              </div>
            ) : null}
          </section>

          {/* Tenant */}
          {data.tenant && (
            <section className="p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3 flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" />Current Tenant
              </h3>
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 space-y-2">
                <p className="font-semibold text-slate-800 text-base">{data.tenant.tenant_name}</p>
                {data.tenant.email && (
                  <a href={`mailto:${data.tenant.email}`} className="flex items-center gap-2 text-sm text-emerald-700 hover:underline">
                    <Mail className="h-3.5 w-3.5 shrink-0" />{data.tenant.email}
                  </a>
                )}
                {data.tenant.mobile_no && (
                  <a href={`tel:${data.tenant.mobile_no}`} className="flex items-center gap-2 text-sm text-slate-700 hover:underline">
                    <Phone className="h-3.5 w-3.5 shrink-0" />{data.tenant.mobile_no}
                  </a>
                )}
              </div>
            </section>
          )}

          {/* Contract */}
          {data.contract && (
            <section className="p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3 flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" />Contract Details
              </h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-slate-400 text-xs">Monthly Rent</p>
                  <p className="font-bold text-emerald-700 text-lg">{fmt(data.contract.monthly_rent)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-slate-400 text-xs">Company</p>
                  <p className="font-medium text-slate-700">{data.contract.company}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-slate-400 text-xs">Start Date</p>
                  <p className="font-medium">{fmtDate(data.contract.start_date)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-slate-400 text-xs">End Date</p>
                  <p className="font-medium">{fmtDate(data.contract.end_date)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 col-span-2">
                  <p className="text-slate-400 text-xs">Contract</p>
                  <p className="font-medium text-xs text-slate-700">{data.contract.name}</p>
                </div>
              </div>
            </section>
          )}

          {/* 12-month breakdown */}
          <section className="p-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3 flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5" />12-Month Payment History
            </h3>
            {bkLoading ? (
              <div className="flex items-center justify-center py-4"><RefreshCw className="h-4 w-4 text-emerald-300 animate-spin" /></div>
            ) : (
              <>
                <div className="grid grid-cols-6 gap-1.5 mb-3">
                  {breakdown.map(m => <MonthTile key={m.month_label} m={m} />)}
                </div>
                <div className="flex gap-4 text-xs text-slate-500 flex-wrap">
                  {Object.entries(MONTH_STATUS).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-1">
                      <span className={`inline-block h-2.5 w-2.5 rounded-sm ${v.bg}`} />
                      <span>{k === "no_invoice" ? "No Invoice" : k.charAt(0).toUpperCase() + k.slice(1)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* Pending invoices */}
          <section className="p-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3 flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
              Pending Invoices
              {data.pending_invoices.length > 0 && (
                <span className="bg-amber-100 text-amber-700 text-xs px-1.5 rounded-full ml-1">{data.pending_invoices.length}</span>
              )}
            </h3>
            {data.pending_invoices.length === 0 ? (
              <div className="text-center py-6">
                <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-400" />
                <p className="text-sm text-slate-400">All invoices paid</p>
              </div>
            ) : (
              <div className="space-y-2">
                {data.pending_invoices.map(inv => {
                  const isOverdue = inv.due_date && new Date(inv.due_date) < new Date()
                  return (
                    <div key={inv.name} className={`rounded-lg border p-3 text-sm ${isOverdue ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium text-slate-700">{inv.custom_invoice_no || inv.name}</p>
                          <p className="text-xs text-slate-400 mt-0.5">Posted: {fmtDate(inv.posting_date)}</p>
                          <p className="text-xs text-slate-400">Due: {fmtDate(inv.due_date)}</p>
                        </div>
                        <div className="text-right shrink-0 ml-3">
                          <p className={`font-bold text-base ${isOverdue ? "text-red-700" : "text-amber-700"}`}>{fmt(inv.outstanding_amount)}</p>
                          <p className="text-xs text-slate-400">of {fmt(inv.grand_total)}</p>
                          {isOverdue && <span className="text-[10px] font-semibold text-red-600 bg-red-100 px-1.5 py-0.5 rounded-full mt-0.5 inline-block">OVERDUE</span>}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* Invoice history */}
          <section className="p-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 text-emerald-300" />Recent Invoice History
            </h3>
            {data.invoice_history.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-4">No history</p>
            ) : (
              <div className="space-y-1.5">
                {data.invoice_history.map(inv => {
                  const isPaid = inv.outstanding_amount === 0
                  const paid = inv.grand_total - inv.outstanding_amount
                  return (
                    <div key={inv.name} className="flex items-center justify-between rounded-lg bg-white border border-slate-100 px-3 py-2.5">
                      <div>
                        <p className="font-medium text-slate-700 text-xs">{inv.custom_invoice_no || inv.name}</p>
                        <p className="text-xs text-slate-400">{fmtDate(inv.posting_date)}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-slate-700 text-xs">{fmt(inv.grand_total)}</p>
                        <span className={`text-xs font-medium ${isPaid ? "text-emerald-600" : "text-amber-600"}`}>
                          {isPaid ? "✓ Paid" : `${fmt(paid)} paid`}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* Expenses */}
          {data.expenses.length > 0 && (
            <section className="p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3 flex items-center gap-1.5">
                <Wallet className="h-3.5 w-3.5 text-purple-400" />Related Expenses
              </h3>
              <div className="space-y-1.5">
                {data.expenses.map(exp => (
                  <div key={exp.name} className="flex items-center justify-between rounded-lg bg-purple-50 border border-purple-100 px-3 py-2.5">
                    <div>
                      <p className="font-medium text-slate-700 text-xs truncate max-w-[200px]">{exp.description || exp.name}</p>
                      <p className="text-xs text-slate-400">{fmtDate(exp.posting_date)}</p>
                    </div>
                    <p className="font-medium text-purple-700 text-xs shrink-0 ml-2">{fmt(exp.amount)}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

// ── Unit card (shared between Financial and Units tabs) ───────────────────────

function UnitCard({ unit, statusCfg, outstandingLabel, overdueLabel, monthlyRent, tenantName, onClick }: {
  unit: string; statusCfg: { label: string; border: string; bg: string; dot: string; badge: string }
  outstandingLabel: number; overdueLabel: number; monthlyRent: number; tenantName: string; onClick: () => void
}) {
  return (
    <button onClick={onClick}
      className={`w-full text-left rounded-xl border-2 ${statusCfg.border} ${statusCfg.bg} p-4
        hover:shadow-md transition-all hover:scale-[1.01] active:scale-100`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${statusCfg.dot}`} />
          <span className="font-semibold text-slate-800 text-sm truncate max-w-[110px]">{unit}</span>
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${statusCfg.badge}`}>{statusCfg.label}</span>
      </div>
      <p className="text-xs text-slate-500 truncate mb-3">{tenantName || "—"}</p>
      <div className="space-y-1">
        {overdueLabel > 0 && <div className="flex justify-between text-xs"><span className="text-slate-500">Overdue</span><span className="font-semibold text-red-700">{fmt(overdueLabel)}</span></div>}
        {outstandingLabel > 0 && <div className="flex justify-between text-xs"><span className="text-slate-500">Outstanding</span><span className="font-semibold text-amber-700">{fmt(outstandingLabel)}</span></div>}
        <div className="flex justify-between text-xs"><span className="text-slate-500">Monthly Rent</span><span className="font-medium text-slate-700">{fmt(monthlyRent)}</span></div>
      </div>
      <div className="mt-3 flex justify-end"><ChevronRight className="h-4 w-4 text-slate-400" /></div>
    </button>
  )
}

// ── Property accordion card ───────────────────────────────────────────────────

function PropertyCard({ prop, onUnitClick }: { prop: PropertyFinancial; onUnitClick: (unitName: string) => void }) {
  const [open, setOpen] = useState(false)
  const hasIssues = prop.total_outstanding > 0

  return (
    <Card className={`border-2 transition-shadow hover:shadow-md ${hasIssues ? "border-amber-200" : "border-slate-200"}`}>
      <button className="w-full text-left" onClick={() => setOpen(v => !v)}>
        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Building2 className="h-4 w-4 text-emerald-700 shrink-0" />
                <span className="font-semibold text-slate-800 truncate">{prop.property_name}</span>
              </div>
              {prop.address && <p className="text-xs text-slate-400 flex items-center gap-1 mb-2"><MapPin className="h-3 w-3" />{prop.address}</p>}
              <div className="flex flex-wrap gap-2">
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">{prop.total_units} units</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">{prop.occupied} occupied</span>
                {prop.vacant > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">{prop.vacant} vacant</span>}
              </div>
            </div>
            <div className="text-right shrink-0">
              {prop.total_overdue > 0 && <p className="text-xs text-red-600 font-semibold">{fmt(prop.total_overdue)} overdue</p>}
              {prop.total_outstanding > 0 && <p className="text-xs text-amber-700 font-medium">{fmt(prop.total_outstanding)} outstanding</p>}
              <p className="text-xs text-slate-400 mt-0.5">{fmt(prop.total_monthly_rent)}/mo rent</p>
            </div>
          </div>
        </div>
        <div className="px-4 pb-3 flex items-center gap-1 text-xs text-emerald-700 font-medium">
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {open ? "Hide units" : `View ${prop.units.length} units`}
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {prop.units.map(u => {
              const status: UnitPayStatus =
                u.outstanding === 0 ? "paid" : u.overdue > 0 ? "overdue" : "outstanding"
              const cfg = UNIT_STATUS[status]
              return (
                <button key={u.name} onClick={() => onUnitClick(u.name)}
                  className={`flex items-center justify-between rounded-lg border ${cfg.border} ${cfg.bg} px-3 py-2 hover:shadow-sm transition-all text-left`}>
                  <div>
                    <p className="font-medium text-slate-800 text-sm">{u.name}</p>
                    <p className="text-xs text-slate-500">{u.tenant_name || "Vacant"}</p>
                  </div>
                  <div className="text-right ml-2 shrink-0">
                    {u.overdue > 0 && <p className="text-xs font-bold text-red-700">{fmt(u.overdue)}</p>}
                    {u.outstanding > 0 && u.overdue === 0 && <p className="text-xs font-semibold text-amber-700">{fmt(u.outstanding)}</p>}
                    {u.outstanding === 0 && <CheckCircle2 className="h-4 w-4 text-emerald-500 ml-auto" />}
                    <ChevronRight className="h-3 w-3 text-slate-400 mt-0.5 ml-auto" />
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </Card>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

type TabId = "overview" | "properties" | "units" | "financial" | "utility" | "tenant_contact"

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "overview",       label: "Overview",        icon: <BarChart3 className="h-4 w-4" /> },
  { id: "properties",     label: "Properties",      icon: <Building2 className="h-4 w-4" /> },
  { id: "units",          label: "Units",           icon: <Layers className="h-4 w-4" /> },
  { id: "tenant_contact", label: "Tenant contact",  icon: <UserCircle className="h-4 w-4" /> },
  { id: "financial",      label: "Financial",       icon: <DollarSign className="h-4 w-4" /> },
  { id: "utility",        label: "Utility",         icon: <Zap className="h-4 w-4" /> },
]

/** Desk — Tenant Contract filters (submitted leases only). */
function deskContractSubmitted(status?: string): unknown[][] {
  const row: unknown[][] = [["docstatus", "=", 1]]
  if (status) row.push(["status", "=", status])
  return row
}

function deskContractExpiringSoon(): unknown[][] {
  const t = new Date()
  const start = t.toISOString().slice(0, 10)
  const end = new Date(t.getTime() + 30 * 86400000).toISOString().slice(0, 10)
  return [
    ["docstatus", "=", 1],
    ["status", "=", "Active"],
    ["end_date", "between", [start, end]],
  ]
}

function deskTenantForm(name: string): string {
  return `${window.location.origin}/app/tenant/${encodeURIComponent(name)}`
}

type PropertyQuickFilter = null | "fully_occupied" | "outstanding"
type UnitsQuickFilter = null | "occupied" | "vacant" | "overdue" | "outstanding"


export default function PMSDashboard() {
  const [tab, setTab]                       = useState<TabId>("overview")
  const [selectedMonth, setSelectedMonth]   = useState<string>(CURRENT_MONTH)
  const [propertyFilter, setPropertyFilter] = useState<string>(ALL_PROPS)
  const [unitSearch, setUnitSearch]         = useState("")
  const [propSearch, setPropSearch]         = useState("")
  const [selectedUnit, setSelectedUnit]     = useState<string | null>(null)
  const [propertyQuickFilter, setPropertyQuickFilter] = useState<PropertyQuickFilter>(null)
  const [unitsQuickFilter, setUnitsQuickFilter]       = useState<UnitsQuickFilter>(null)

  const months = useAvailableMonths()

  const { data: overview, loading: ovLoading, error: ovError, reload: ovReload } = useDashboardOverview()
  const { data: propsData, loading: propLoading, error: propError }              = usePropertiesFinancial()
  const { data: unitsData, loading: unitsLoading, error: unitsError }            = useUnitsOverview()
  const {
    data: tenantContacts,
    loading: tenantsLoading,
    error: tenantsError,
    reload: tenantsReload,
  } = useTenantsContactList()

  useEffect(() => {
    if (tab !== "units") setUnitsQuickFilter(null)
    if (tab !== "properties") setPropertyQuickFilter(null)
  }, [tab])

  const { month: filterMonth, year: filterYear } = useMemo(() => {
    if (selectedMonth === CURRENT_MONTH) return { month: undefined, year: undefined }
    const [y, m] = selectedMonth.split("-")
    return { month: Number(m), year: Number(y) }
  }, [selectedMonth])

  const { data: financial, loading: finLoading, error: finError } = useFinancialOverview(filterMonth, filterYear)

  const finProperties = useMemo(() => {
    const set = new Set(financial.map(u => u.property).filter(Boolean))
    return [ALL_PROPS, ...Array.from(set)]
  }, [financial])

  const filteredFinancial = useMemo(
    () => propertyFilter === ALL_PROPS ? financial : financial.filter(u => u.property === propertyFilter),
    [financial, propertyFilter]
  )
  const finSummary = useMemo(() => filteredFinancial.reduce(
    (acc, u) => ({ invoiced: acc.invoiced + u.invoiced, paid: acc.paid + u.paid, outstanding: acc.outstanding + u.outstanding, overdue: acc.overdue + u.overdue }),
    { invoiced: 0, paid: 0, outstanding: 0, overdue: 0 }
  ), [filteredFinancial])

  const filteredUnits = useMemo(() => {
    let list = unitsData
    if (propertyFilter !== ALL_PROPS) {
      list = list.filter(u => u.property === propertyFilter)
    }
    if (unitsQuickFilter === "occupied") {
      list = list.filter(u => u.unit_status === "Occupied")
    } else if (unitsQuickFilter === "vacant") {
      list = list.filter(u => u.unit_status !== "Occupied")
    } else if (unitsQuickFilter === "overdue") {
      list = list.filter(u => u.overdue > 0)
    } else if (unitsQuickFilter === "outstanding") {
      list = list.filter(u => u.outstanding > 0)
    }
    if (unitSearch) {
      const q = unitSearch.toLowerCase()
      list = list.filter(u =>
        u.unit.toLowerCase().includes(q) ||
        u.tenant_name.toLowerCase().includes(q) ||
        u.property.toLowerCase().includes(q)
      )
    }
    return list
  }, [unitsData, unitSearch, propertyFilter, unitsQuickFilter])

  const filteredProps = useMemo(() => {
    let list = propSearch
      ? propsData.filter(p => p.property_name.toLowerCase().includes(propSearch.toLowerCase()))
      : propsData
    if (propertyQuickFilter === "fully_occupied") {
      list = list.filter(p => p.total_units > 0 && p.vacant === 0)
    } else if (propertyQuickFilter === "outstanding") {
      list = list.filter(p => p.total_outstanding > 0)
    }
    return list
  }, [propsData, propSearch, propertyQuickFilter])

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-amber-50/35 to-teal-50 p-4">
      {selectedUnit && <div className="fixed inset-0 bg-black/30 z-40 backdrop-blur-[1px]" onClick={() => setSelectedUnit(null)} />}
      {selectedUnit && <UnitDetailPanel unitName={selectedUnit} onClose={() => setSelectedUnit(null)} />}

      <div className="max-w-8xl mx-auto space-y-6">

        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div className="text-center space-y-2 flex-1">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-emerald-700 via-amber-700 to-amber-900 bg-clip-text text-transparent">
              Property Management Dashboard
            </h1>
            <p className="text-gray-600 text-lg">Portfolio overview · financial health · occupancy analytics</p>
          </div>
          <Button variant="outline" className="flex items-center gap-2" onClick={ovReload}>
            <RefreshCw className={`h-4 w-4 ${ovLoading ? "animate-spin" : ""}`} />Refresh
          </Button>
        </div>

        {/* ── Main card with tab header ── */}
        <Card className="border-emerald-200/90 shadow-lg ring-1 ring-amber-200/40">
          {/* Tab bar as card header */}
          <CardHeader className="bg-gradient-to-r from-emerald-700 via-amber-700 to-amber-950 text-white rounded-t-lg p-0">
            <div className="flex items-center overflow-x-auto">
              {TABS.map((t, i) => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`flex items-center gap-2 px-5 py-4 text-sm font-semibold whitespace-nowrap transition-all shrink-0
                    ${i === 0 ? "rounded-tl-lg" : ""}
                    ${tab === t.id ? "bg-white/20 border-b-2 border-amber-200 text-white" : "text-amber-100/90 hover:text-white hover:bg-white/10"}`}>
                  {t.icon}{t.label}
                </button>
              ))}
            </div>
          </CardHeader>

          {/* ── OVERVIEW ── */}
          {tab === "overview" && (
            <CardContent className="p-6 space-y-6">
              {ovError && <Alert variant="destructive"><AlertDescription>{ovError}</AlertDescription></Alert>}

              {/* ── Summary cards row — screenshot style ── */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">

                {/* Contracts → Desk list with filters */}
                <SummaryCard
                  title="Contracts" icon={<FileText className="h-5 w-5"/>}
                  gradient="from-emerald-700 via-amber-700 to-amber-950"
                  loading={ovLoading}
                  rows={[
                    {
                      label: "Total Contracts",
                      value: overview?.total_contracts ?? 0,
                      tone: "default",
                      onNavigate: () => navigateDeskList("Tenant Contract", deskContractSubmitted()),
                    },
                  ]}
                  pairs={[
                    {
                      label: "Active",
                      value: overview?.active_contracts ?? 0,
                      tone: "green",
                      onNavigate: () => navigateDeskList("Tenant Contract", deskContractSubmitted("Active")),
                    },
                    {
                      label: "Expired",
                      value: overview?.expired_contracts ?? 0,
                      tone: "red",
                      onNavigate: () => navigateDeskList("Tenant Contract", deskContractSubmitted("Expired")),
                    },
                    {
                      label: "Terminated",
                      value: overview?.terminated_contracts ?? 0,
                      tone: "red",
                      onNavigate: () => navigateDeskList("Tenant Contract", deskContractSubmitted("Terminated")),
                    },
                    {
                      label: "Expiring (30d)",
                      value: overview?.expiring_soon ?? 0,
                      tone: "amber",
                      onNavigate: () => navigateDeskList("Tenant Contract", deskContractExpiringSoon()),
                    },
                  ]}
                />

                {/* Properties — Occupied / Vacant → Units tab */}
                <SummaryCard
                  title="Properties" icon={<Building2 className="h-5 w-5"/>}
                  gradient="from-teal-600 via-amber-600 to-amber-900"
                  loading={ovLoading}
                  rows={[
                    { label: "Total Properties", value: overview?.total_properties ?? 0, tone: "default" },
                    { label: "Total Units",       value: overview?.total_units ?? 0,      tone: "default" },
                  ]}
                  pairs={[
                    {
                      label: "Occupied",
                      value: overview?.occupied_units ?? 0,
                      tone: "green",
                      onNavigate: () => { setUnitsQuickFilter("occupied"); setTab("units") },
                    },
                    {
                      label: "Vacant",
                      value: overview?.vacant_units ?? 0,
                      tone: "red",
                      onNavigate: () => { setUnitsQuickFilter("vacant"); setTab("units") },
                    },
                  ]}
                />

                {/* Invoices — display only (no drill-down) */}
                <SummaryCard
                  title="Invoices" icon={<DollarSign className="h-5 w-5"/>}
                  gradient="from-emerald-600 via-amber-600 to-amber-950"
                  loading={ovLoading}
                  rows={[
                    {
                      label: `Paid (${new Date().toLocaleDateString("en-GB",{month:"short",year:"numeric"})})`,
                      value: overview ? fmt(overview.monthly_paid) : "—",
                      tone: "green",
                    },
                    {
                      label: "Invoiced (this month)",
                      value: overview ? fmt(overview.monthly_revenue) : "—",
                      tone: "default",
                    },
                    {
                      label: "Outstanding Invoices",
                      value: overview ? fmt(overview.total_outstanding) : "—",
                      tone: overview && overview.total_outstanding > 0 ? "red" : "green",
                    },
                  ]}
                />

              </div>

              {/* ── Revenue trend + Lease status charts ── */}
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <Card className="xl:col-span-2 border-emerald-100 shadow-sm ring-1 ring-amber-100/60">
                  <CardHeader className="bg-gradient-to-r from-emerald-700 via-amber-700 to-amber-950 text-white rounded-t-lg px-6 py-4">
                    <CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="h-4 w-4"/>Revenue Trend — Last 6 Months</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4 pr-2">
                    {overview?.revenue_trend?.length ? (
                      <ResponsiveContainer width="100%" height={240}>
                        <BarChart data={overview.revenue_trend} barGap={4}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
                          <XAxis dataKey="month" tick={{fontSize:11}}/>
                          <YAxis tick={{fontSize:11}} tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k`:String(v)}/>
                          <Tooltip formatter={(v:number)=>fmt(v)} contentStyle={{fontSize:12,borderRadius:8}}/>
                          <Legend wrapperStyle={{fontSize:12}}/>
                          <Bar dataKey="revenue" name="Invoiced" fill="#059669" radius={[4,4,0,0]}/>
                          <Bar dataKey="collected" name="Collected" fill="#ca8a04" radius={[4,4,0,0]}/>
                        </BarChart>
                      </ResponsiveContainer>
                    ) : <div className="h-[240px] flex items-center justify-center text-slate-400 text-sm">No revenue data</div>}
                  </CardContent>
                </Card>

                <Card className="border-emerald-100 shadow-sm ring-1 ring-amber-100/60">
                  <CardHeader className="bg-gradient-to-r from-emerald-700 via-amber-700 to-amber-950 text-white rounded-t-lg px-6 py-4">
                    <CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4"/>Lease Status</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4">
                    {overview?.lease_status && Object.keys(overview.lease_status).length ? (
                      <>
                        <ResponsiveContainer width="100%" height={160}>
                          <PieChart>
                            <Pie data={Object.entries(overview.lease_status).map(([k,v])=>({name:k,value:v}))}
                              cx="50%" cy="50%" innerRadius={40} outerRadius={65} paddingAngle={3} dataKey="value">
                              {Object.keys(overview.lease_status).map(k=><Cell key={k} fill={LEASE_COLORS[k]??"#94a3b8"}/>)}
                            </Pie>
                            <Tooltip contentStyle={{fontSize:12,borderRadius:8}}/>
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="space-y-2 mt-2">
                          {Object.entries(overview.lease_status).map(([k,v])=>(
                            <div key={k} className="flex items-center justify-between text-sm">
                              <div className="flex items-center gap-2">
                                <span className="h-2.5 w-2.5 rounded-full" style={{backgroundColor:LEASE_COLORS[k]??"#94a3b8"}}/>
                                <span className="text-slate-600">{k}</span>
                              </div>
                              <span className="font-semibold text-slate-800">{v}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : <div className="h-[200px] flex items-center justify-center text-slate-400 text-sm">No contracts</div>}
                  </CardContent>
                </Card>
              </div>

              {/* ── Top tenants + Properties tables ── */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {/* Top tenants */}
                <Card className="border-emerald-100 shadow-sm ring-1 ring-amber-100/60">
                  <CardHeader className="bg-gradient-to-r from-emerald-700 via-amber-700 to-amber-950 text-white rounded-t-lg px-5 py-3">
                    <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                      <Users className="h-4 w-4"/>Top Tenants by Monthly Rent
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    {overview?.top_tenants?.length ? (
                      <Table>
                        <TableHeader><TableRow className="bg-emerald-50">
                          <TableHead className="text-teal-800 text-xs font-semibold pl-4">#</TableHead>
                          <TableHead className="text-teal-800 text-xs font-semibold">Tenant</TableHead>
                          <TableHead className="text-teal-800 text-xs font-semibold">Unit</TableHead>
                          <TableHead className="text-teal-800 text-xs font-semibold">Property</TableHead>
                          <TableHead className="text-teal-800 text-xs font-semibold text-right pr-4">Monthly Rent</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                          {overview.top_tenants.map((t,i)=>(
                            <TableRow key={t.tenant_id} className="hover:bg-emerald-50/50">
                              <TableCell className="text-xs text-slate-400 font-medium pl-4">{i+1}</TableCell>
                              <TableCell><p className="font-medium text-slate-800 text-sm">{t.tenant_name}</p><p className="text-xs text-slate-400">{t.company}</p></TableCell>
                              <TableCell className="text-sm text-slate-700">{t.unit}</TableCell>
                              <TableCell className="text-sm text-slate-500">{t.property}</TableCell>
                              <TableCell className="text-right font-bold text-emerald-700 text-sm pr-4">{fmt(t.monthly_rent)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : <div className="py-10 text-center text-slate-400 text-sm">No active tenants</div>}
                  </CardContent>
                </Card>

                {/* Properties table */}
                <Card className="border-emerald-100 shadow-sm ring-1 ring-amber-100/60">
                  <CardHeader className="bg-gradient-to-r from-emerald-700 via-amber-700 to-amber-950 text-white rounded-t-lg px-5 py-3">
                    <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                      <Building2 className="h-4 w-4"/>Properties
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    {overview?.property_stats?.length ? (
                      <Table>
                        <TableHeader><TableRow className="bg-emerald-50">
                          <TableHead className="text-teal-800 text-xs font-semibold pl-4">Property</TableHead>
                          <TableHead className="text-teal-800 text-xs font-semibold text-center">Total</TableHead>
                          <TableHead className="text-teal-800 text-xs font-semibold text-center">Occ.</TableHead>
                          <TableHead className="text-teal-800 text-xs font-semibold text-center">Vacant</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                          {overview.property_stats.map(p=>{
                            const rate = p.total_units ? Math.round((p.occupied / p.total_units) * 100) : 0
                            return (
                              <TableRow key={p.name} className="hover:bg-emerald-50/50">
                                <TableCell className="pl-4">
                                  <p className="font-medium text-slate-800 text-sm">{p.property_name}</p>
                                  <div className="mt-1 h-1.5 w-24 rounded-full bg-slate-200">
                                    <div className="h-full rounded-full bg-emerald-500" style={{width:`${rate}%`}}/>
                                  </div>
                                </TableCell>
                                <TableCell className="text-center text-sm">{p.total_units}</TableCell>
                                <TableCell className="text-center"><span className="text-sm font-medium text-emerald-700">{p.occupied}</span></TableCell>
                                <TableCell className="text-center"><span className={`text-sm font-medium ${p.vacant>0?"text-amber-600":"text-slate-400"}`}>{p.vacant}</span></TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    ) : <div className="py-10 text-center text-slate-400 text-sm">No properties</div>}
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          )}

          {/* ── PROPERTIES TAB ── */}
          {tab === "properties" && (
            <CardContent className="p-6 space-y-4">
              {propError && <Alert variant="destructive"><AlertDescription>{propError}</AlertDescription></Alert>}

              {/* Summary row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <KpiCard icon={<Building2 className="h-5 w-5"/>} label="Properties" value={propsData.length} tone="gold"/>
                <KpiCard
                  icon={<CheckCircle2 className="h-5 w-5"/>}
                  label="Total Occupied"
                  value={propsData.reduce((s,p)=>s+p.occupied,0)}
                  tone="green"
                  onClick={() => setPropertyQuickFilter(f => f === "fully_occupied" ? null : "fully_occupied")}
                  sub={propertyQuickFilter === "fully_occupied" ? "Fully occupied properties" : undefined}
                />
                <KpiCard
                  icon={<AlertCircle className="h-5 w-5"/>}
                  label="Total Outstanding"
                  value={fmt(propsData.reduce((s,p)=>s+p.total_outstanding,0))}
                  tone="amber"
                  onClick={() => setPropertyQuickFilter(f => f === "outstanding" ? null : "outstanding")}
                  sub={propertyQuickFilter === "outstanding" ? "Properties with outstanding balance" : undefined}
                />
                <KpiCard icon={<Clock className="h-5 w-5"/>} label="Total Overdue" value={fmt(propsData.reduce((s,p)=>s+p.total_overdue,0))} tone="red"/>
              </div>

              {propertyQuickFilter && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-sm text-amber-950">
                  <FilterX className="h-4 w-4 shrink-0 opacity-70"/>
                  <span className="font-medium">
                    {propertyQuickFilter === "fully_occupied"
                      ? "Showing fully occupied properties only"
                      : "Showing properties with outstanding balance"}
                  </span>
                  <Button type="button" variant="outline" size="sm" className="ml-auto border-amber-300 text-amber-900"
                    onClick={() => setPropertyQuickFilter(null)}>
                    Clear
                  </Button>
                </div>
              )}

              {/* Search */}
              <input
                className="w-full max-w-sm px-3 py-2 text-sm border border-emerald-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-300"
                placeholder="Search properties…"
                value={propSearch}
                onChange={e => setPropSearch(e.target.value)}
              />

              {propLoading ? (
                <div className="flex items-center justify-center py-16"><RefreshCw className="h-6 w-6 text-amber-600 animate-spin"/></div>
              ) : filteredProps.length === 0 ? (
                <div className="text-center py-16 text-slate-400"><Building2 className="h-10 w-10 mx-auto mb-3 opacity-40"/><p>No properties found</p></div>
              ) : (
                <div className="space-y-3">
                  {filteredProps.map(p => <PropertyCard key={p.name} prop={p} onUnitClick={setSelectedUnit}/>)}
                </div>
              )}
            </CardContent>
          )}

          {/* ── UNITS TAB ── */}
          {tab === "units" && (
            <CardContent className="p-6 space-y-4">
              {unitsError && <Alert variant="destructive"><AlertDescription>{unitsError}</AlertDescription></Alert>}

              {/* Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <KpiCard icon={<Home className="h-5 w-5"/>} label="Total Units" value={unitsData.length} tone="gold"/>
                <KpiCard
                  icon={<CheckCircle2 className="h-5 w-5"/>}
                  label="Occupied"
                  value={unitsData.filter(u => u.unit_status === "Occupied").length}
                  tone="green"
                  onClick={() => setUnitsQuickFilter(f => f === "occupied" ? null : "occupied")}
                  sub={unitsQuickFilter === "occupied" ? "Occupied units only" : undefined}
                />
                <KpiCard
                  icon={<AlertCircle className="h-5 w-5"/>}
                  label="Outstanding"
                  value={fmt(unitsData.reduce((s, u) => s + u.outstanding, 0))}
                  tone="amber"
                  onClick={() => setUnitsQuickFilter(f => f === "outstanding" ? null : "outstanding")}
                  sub={unitsQuickFilter === "outstanding" ? "Units with outstanding balance" : undefined}
                />
                <KpiCard
                  icon={<Clock className="h-5 w-5"/>}
                  label="Overdue"
                  value={fmt(unitsData.reduce((s, u) => s + u.overdue, 0))}
                  tone="red"
                  onClick={() => setUnitsQuickFilter(f => f === "overdue" ? null : "overdue")}
                  sub={unitsQuickFilter === "overdue" ? "Units with overdue amounts" : undefined}
                />
              </div>

              {unitsQuickFilter && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-sm text-amber-950">
                  <FilterX className="h-4 w-4 shrink-0 opacity-70"/>
                  <span className="font-medium">
                    {unitsQuickFilter === "occupied" && "Showing occupied units only"}
                    {unitsQuickFilter === "vacant" && "Showing vacant / non-occupied units"}
                    {unitsQuickFilter === "overdue" && "Showing units with overdue amounts"}
                    {unitsQuickFilter === "outstanding" && "Showing units with outstanding balance"}
                  </span>
                  <Button type="button" variant="outline" size="sm" className="ml-auto border-amber-300 text-amber-900"
                    onClick={() => setUnitsQuickFilter(null)}>
                    Clear
                  </Button>
                </div>
              )}

              {/* Filters row */}
              <div className="flex flex-wrap items-center gap-3">
                <input
                  className="px-3 py-2 text-sm border border-emerald-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-300 w-52"
                  placeholder="Search unit…"
                  value={unitSearch}
                  onChange={e => setUnitSearch(e.target.value)}
                />
                <div className="w-52">
                  <Select value={propertyFilter} onValueChange={setPropertyFilter}>
                    <SelectTrigger className="border-emerald-200 text-sm"><SelectValue placeholder="All Properties"/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_PROPS}>All Properties</SelectItem>
                      {Array.from(new Set(unitsData.map(u=>u.property).filter(Boolean))).sort().map(p=>(
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-wrap gap-3 ml-auto">
                  {(Object.entries(UNIT_STATUS) as [UnitPayStatus, typeof UNIT_STATUS[UnitPayStatus]][]).map(([k,v])=>(
                    <div key={k} className="flex items-center gap-1.5">
                      <span className={`h-2.5 w-2.5 rounded-full ${v.dot}`}/>
                      <span className="text-xs text-slate-600">{v.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {unitsLoading ? (
                <div className="flex items-center justify-center py-16"><RefreshCw className="h-6 w-6 text-amber-600 animate-spin"/></div>
              ) : filteredUnits.length === 0 ? (
                <div className="text-center py-16 text-slate-400"><Home className="h-10 w-10 mx-auto mb-3 opacity-40"/><p>No units found</p></div>
              ) : (
                <Card className="border-emerald-100 shadow-sm">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-emerald-50">
                        <TableHead className="text-teal-800 text-xs font-semibold">Unit</TableHead>
                        <TableHead className="text-teal-800 text-xs font-semibold">Property</TableHead>
                        <TableHead className="text-teal-800 text-xs font-semibold">Tenant</TableHead>
                        <TableHead className="text-teal-800 text-xs font-semibold">Floor / Area</TableHead>
                        <TableHead className="text-teal-800 text-xs font-semibold text-right">Monthly Rent</TableHead>
                        <TableHead className="text-teal-800 text-xs font-semibold text-right">Outstanding</TableHead>
                        <TableHead className="text-teal-800 text-xs font-semibold text-right">Overdue</TableHead>
                        <TableHead className="text-teal-800 text-xs font-semibold text-center">Status</TableHead>
                        <TableHead className="text-teal-800 text-xs font-semibold"/>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredUnits.map(u => {
                        const cfg = UNIT_STATUS[u.pay_status] ?? UNIT_STATUS.vacant
                        return (
                          <TableRow key={u.unit}
                            className="hover:bg-emerald-50/60 cursor-pointer transition-colors"
                            onClick={() => setSelectedUnit(u.unit)}
                          >
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${cfg.dot}`}/>
                                <span className="font-semibold text-slate-800 text-sm">{u.unit}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <p className="text-sm text-slate-700">{u.property || "—"}</p>
                            </TableCell>
                            <TableCell>
                              {u.tenant_name
                                ? <p className="text-sm text-slate-700">{u.tenant_name}</p>
                                : <span className="text-xs text-slate-400 italic">Vacant</span>}
                            </TableCell>
                            <TableCell>
                              <p className="text-xs text-slate-500">
                                {[u.floor && `Floor ${u.floor}`, u.area && `${u.area} m²`].filter(Boolean).join(" · ") || "—"}
                              </p>
                            </TableCell>
                            <TableCell className="text-right">
                              <span className="text-sm font-medium text-slate-700">{u.monthly_rent ? fmt(u.monthly_rent) : "—"}</span>
                            </TableCell>
                            <TableCell className="text-right">
                              {u.outstanding > 0
                                ? <span className="text-sm font-semibold text-amber-700">{fmt(u.outstanding)}</span>
                                : <span className="text-xs text-slate-400">—</span>}
                            </TableCell>
                            <TableCell className="text-right">
                              {u.overdue > 0
                                ? <span className="text-sm font-bold text-red-700">{fmt(u.overdue)}</span>
                                : <span className="text-xs text-slate-400">—</span>}
                            </TableCell>
                            <TableCell className="text-center">
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cfg.badge}`}>{cfg.label}</span>
                            </TableCell>
                            <TableCell>
                              <ChevronRight className="h-4 w-4 text-slate-400"/>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </Card>
              )}
            </CardContent>
          )}

          {/* ── TENANT CONTACT ── */}
          {tab === "tenant_contact" && (
            <CardContent className="p-6 space-y-4">
              {tenantsError && (
                <Alert variant="destructive"><AlertDescription>{tenantsError}</AlertDescription></Alert>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-slate-600 text-sm max-w-xl">
                  Contact details from the <span className="font-medium text-amber-900">Tenant</span> register. Open a record in Desk to edit.
                </p>
                <Button variant="outline" type="button" className="border-amber-200 text-amber-950" onClick={tenantsReload}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${tenantsLoading ? "animate-spin" : ""}`}/>Refresh
                </Button>
              </div>
              {tenantsLoading && !tenantContacts.length ? (
                <div className="flex items-center justify-center py-16">
                  <RefreshCw className="h-6 w-6 text-amber-600 animate-spin"/>
                </div>
              ) : tenantContacts.length === 0 ? (
                <div className="text-center text-slate-400 text-sm py-16 border border-dashed border-amber-200/80 rounded-xl bg-amber-50/30">
                  No tenants found
                </div>
              ) : (
                <Card className="border-emerald-100 shadow-sm ring-1 ring-amber-100/60 overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-amber-50/80">
                        <TableHead className="text-amber-950/90 text-xs font-semibold pl-4">Tenant</TableHead>
                        <TableHead className="text-amber-950/90 text-xs font-semibold">Status</TableHead>
                        <TableHead className="text-amber-950/90 text-xs font-semibold">Email</TableHead>
                        <TableHead className="text-amber-950/90 text-xs font-semibold">Phone</TableHead>
                        <TableHead className="text-amber-950/90 text-xs font-semibold">Property / unit</TableHead>
                        <TableHead className="text-amber-950/90 text-xs font-semibold text-right pr-4">Desk</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tenantContacts.map(t => (
                        <TableRow key={t.name} className="hover:bg-amber-50/50">
                          <TableCell className="pl-4 font-medium text-slate-800 text-sm">{t.tenant_name}</TableCell>
                          <TableCell className="text-xs text-slate-600">{t.status || "—"}</TableCell>
                          <TableCell>
                            {t.email
                              ? <a className="text-sm text-amber-800 hover:underline" href={`mailto:${t.email}`}>{t.email}</a>
                              : <span className="text-xs text-slate-400">—</span>}
                          </TableCell>
                          <TableCell>
                            {t.mobile_no
                              ? <a className="text-sm text-slate-700 hover:underline" href={`tel:${t.mobile_no}`}>{t.mobile_no}</a>
                              : <span className="text-xs text-slate-400">—</span>}
                          </TableCell>
                          <TableCell className="text-xs text-slate-600">
                            {[t.property, t.current_unit].filter(Boolean).join(" · ") || "—"}
                          </TableCell>
                          <TableCell className="text-right pr-4">
                            <a
                              href={deskTenantForm(t.name)}
                              className="text-xs font-medium text-amber-800 hover:underline"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Open
                            </a>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              )}
            </CardContent>
          )}

          {/* ── FINANCIAL ── */}
          {tab === "financial" && (
            <CardContent className="p-6 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Month</label>
                  <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                    <SelectTrigger className="border-emerald-200"><SelectValue placeholder="Current Month"/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={CURRENT_MONTH}>Current Month</SelectItem>
                      {months.map(m=><SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Property</label>
                  <Select value={propertyFilter} onValueChange={setPropertyFilter}>
                    <SelectTrigger className="border-emerald-200"><SelectValue placeholder="All Properties"/></SelectTrigger>
                    <SelectContent>
                      {finProperties.map(p=><SelectItem key={p} value={p}>{p===ALL_PROPS?"All Properties":p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <KpiCard icon={<TrendingUp className="h-5 w-5"/>} label="Invoiced" value={fmt(finSummary.invoiced)} tone="gold"/>
                <KpiCard icon={<CheckCircle2 className="h-5 w-5"/>} label="Collected"    value={fmt(finSummary.paid)}          tone="green"/>
                <KpiCard icon={<Clock className="h-5 w-5"/>}        label="Outstanding"  value={fmt(finSummary.outstanding)}   tone="amber"/>
                <KpiCard icon={<AlertCircle className="h-5 w-5"/>}  label="Overdue"      value={fmt(finSummary.overdue)}       tone="red"/>
              </div>
              <div className="flex flex-wrap gap-3 items-center">
                {(Object.entries(FINANCIAL_STATUS) as [UnitPaymentStatus, typeof FINANCIAL_STATUS[UnitPaymentStatus]][]).map(([k,v])=>(
                  <div key={k} className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${v.dot}`}/><span className="text-xs text-slate-600">{v.label}</span></div>
                ))}
              </div>
              {finError && <Alert variant="destructive"><AlertDescription>{finError}</AlertDescription></Alert>}
              {finLoading ? (
                <div className="flex items-center justify-center py-16"><RefreshCw className="h-6 w-6 text-amber-600 animate-spin"/></div>
              ) : filteredFinancial.length === 0 ? (
                <div className="text-center py-16 text-slate-400"><Building2 className="h-10 w-10 mx-auto mb-3 opacity-40"/><p>No contracts found for this period</p></div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                  {filteredFinancial.map(u=>{
                    const cfg = FINANCIAL_STATUS[u.status] ?? FINANCIAL_STATUS.no_invoice
                    return (
                      <UnitCard key={u.contract} unit={u.unit}
                        statusCfg={cfg} outstandingLabel={u.outstanding} overdueLabel={u.overdue}
                        monthlyRent={u.monthly_rent} tenantName={u.tenant_name}
                        onClick={() => setSelectedUnit(u.unit)}/>
                    )
                  })}
                </div>
              )}
            </CardContent>
          )}

          {/* ── UTILITY ── */}
          {tab === "utility" && (
            <CardContent className="py-20 text-center space-y-3">
              <Zap className="h-12 w-12 mx-auto text-emerald-200"/>
              <p className="text-xl font-semibold text-slate-600">Coming Soon</p>
              <p className="text-slate-400 text-sm max-w-md mx-auto">
                Utility consumption analytics — water, electricity, and gas trends per unit and property — will be available in a future release.
              </p>
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  )
}
