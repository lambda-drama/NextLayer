"use client"

import { useState } from "react"
import { Link } from "react-router-dom"
import { ArrowLeft, Building2, FileText } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { Button } from "./ui/button"
import { Combobox } from "./ui/combobox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table"
import { Alert, AlertDescription } from "./ui/alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"

import { useCompanies } from "../hook/useCompanies"
import { usePermissionAwareCompanies } from "../hook/usePermissionAwareCompanies"
import { useAllCompaniesForUI } from "../hook/useAllCompaniesForUI"
import { useProjects } from "../hook/useProjects"
import {
  useQuotationStagesReport,
  type QuotationStagesEntry,
  type QuotationStagesTotals,
  type QuotationStagesMeta,
} from "../hook/useQuotationStagesReport"

const CURRENCY_OPTIONS = [
  { value: "all", label: "Company Currency" },
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

function fmt(amount: number | null | undefined, curr: string): string {
  if (amount == null || isNaN(amount as number)) return "—"
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: curr || "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${curr} ${(amount ?? 0).toFixed(2)}`
  }
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "—"
  try {
    return new Date(d).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
  } catch {
    return "—"
  }
}

interface SummaryCardProps {
  title: string
  value: number
  currency: string
  tone: "primary" | "success" | "muted" | "danger"
}

function SummaryCard({ title, value, currency, tone }: SummaryCardProps) {
  const toneClasses =
    tone === "primary"
      ? "bg-blue-50 border-blue-200 text-blue-900"
      : tone === "success"
      ? "bg-emerald-50 border-emerald-200 text-emerald-900"
      : tone === "danger"
      ? "bg-red-50 border-red-200 text-red-900"
      : "bg-slate-50 border-slate-200 text-slate-900"

  return (
    <Card className={`border ${toneClasses}`}>
      <CardContent className="p-4 space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </p>
        <p className="text-xl font-bold">{fmt(value, currency)}</p>
      </CardContent>
    </Card>
  )
}

function QuotationLink({ name, children }: { name: string | null; children: React.ReactNode }) {
  if (!name) return <span className="text-slate-400">{children ?? "—"}</span>
  const href = `/app/quotation/${encodeURIComponent(name)}`
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-700 hover:text-blue-900 hover:underline font-medium"
    >
      {children ?? name}
    </a>
  )
}

export default function QuotationStagesReport() {
  const [company, setCompany] = useState<string>("")
  const [project, setProject] = useState<string>("")
  const [fromDate, setFromDate] = useState<string>(`${new Date().getFullYear()}-01-01`)
  const [toDate, setToDate] = useState<string>(new Date().toISOString().split("T")[0])
  const [currency, setCurrency] = useState<string>("all")
  const [hasLoadedData, setHasLoadedData] = useState(false)
  const [error, setError] = useState<string>("")

  const { companies: baseCompanies } = useCompanies()
  const { companies: permissionAwareCompanies } = usePermissionAwareCompanies()
  const { companies: allCompanies } = useAllCompaniesForUI()
  const displayCompanies =
    permissionAwareCompanies.length > 0
      ? permissionAwareCompanies
      : allCompanies.length > 0
      ? allCompanies
      : baseCompanies

  const { projects, isLoading: projectsLoading } = useProjects(company)

  const {
    data,
    isLoading,
    error: fetchError,
  } = useQuotationStagesReport({
    company,
    project,
    fromDate,
    toDate,
    currency,
    enabled: hasLoadedData,
  })

  const entries = (data?.entries ?? []) as QuotationStagesEntry[]
  const totals = data?.totals as QuotationStagesTotals | undefined
  const meta = data?.meta as QuotationStagesMeta | undefined
  const displayCurrency = meta?.display_currency || (currency === "all" ? "USD" : currency)

  const handleLoadData = () => {
    if (!company) {
      setError("Please select a company")
      return
    }
    setError("")
    setHasLoadedData(true)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20 p-4">
      <div className="max-w-[1920px] mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link to="/reconciliation">
            <Button
              variant="outline"
              size="sm"
              className="flex items-center gap-1.5 shrink-0"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </Link>

          <div className="flex-1 text-center">
            <h1 className="text-3xl font-bold text-blue-900 tracking-tight">
              Quotation Stages Report
            </h1>
            <p className="text-gray-500 text-sm mt-0.5">
              Compare Initial Quote → After Site Visit → Final Quote by deal
            </p>
          </div>
        </div>

        {/* Filters */}
        <Card className="border-blue-200 shadow-md">
          <CardHeader className="bg-gradient-to-r from-blue-700 to-blue-800 text-white rounded-t-lg py-4 px-6">
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-5 w-5" />
              Report Filters
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Company
                </label>
                <Combobox
                  options={displayCompanies.map((c) => ({
                    name:
                      ("company_name" in c ? (c as { company_name?: string }).company_name : c.name) ??
                      c.name,
                    value: c.name,
                  }))}
                  value={company}
                  onValueChange={(val) => {
                    setCompany(val)
                    setProject("")
                  }}
                  placeholder="Select company"
                  searchPlaceholder="Search companies..."
                  emptyMessage="No companies found."
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Project
                </label>
                <Combobox
                  options={projects.map((p) => ({
                    name: p.project_name || p.name,
                    value: p.name,
                  }))}
                  value={project}
                  onValueChange={setProject}
                  placeholder={
                    !company
                      ? "Select company first"
                      : projectsLoading
                      ? "Loading projects..."
                      : "All projects"
                  }
                  disabled={!company || projectsLoading}
                  searchPlaceholder="Search projects..."
                  emptyMessage={company ? "No projects found." : "Select company first."}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  From Date
                </label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full p-2 border border-blue-200 rounded-md focus:border-blue-400 focus:outline-none text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  To Date
                </label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full p-2 border border-blue-200 rounded-md focus:border-blue-400 focus:outline-none text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Display Currency
                </label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger className="border-blue-200 focus:border-blue-400 text-sm">
                    <SelectValue placeholder="Company Currency" />
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
                  className="bg-blue-700 hover:bg-blue-800 text-white px-6 w-full h-10"
                >
                  {isLoading ? "Loading…" : "Load Report"}
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

        {/* Sticky summary cards */}
        {hasLoadedData && meta && totals && (
          <div className="sticky top-0 z-20 space-y-4 pb-4 bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <SummaryCard
                title="Initial Quote (Total)"
                value={totals.total_initial}
                currency={displayCurrency}
                tone="primary"
              />
              <SummaryCard
                title="After Site Visit (Total)"
                value={totals.total_after_site_visit}
                currency={displayCurrency}
                tone="primary"
              />
              <SummaryCard
                title="Final Quote (Total)"
                value={totals.total_final}
                currency={displayCurrency}
                tone="success"
              />
              <SummaryCard
                title="Variance (Initial → Final)"
                value={totals.variance_initial_to_final}
                currency={displayCurrency}
                tone={totals.variance_initial_to_final >= 0 ? "muted" : "danger"}
              />
              <Card className="border-slate-200 bg-slate-50">
                <CardContent className="p-4 space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Deals
                  </p>
                  <p className="text-xl font-bold text-slate-900">{totals.deal_count}</p>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Main table: deals with three stages */}
        {hasLoadedData && (
          <Card className="border-blue-200 shadow-md overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-blue-700 to-blue-800 text-white rounded-t-lg py-4 px-6">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="h-5 w-5" />
                  Quotations by Stage
                </CardTitle>
                {meta && (
                  <span className="text-xs text-blue-100">
                    {meta.company} · {meta.from_date} → {meta.to_date}
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-blue-50">
                      <TableHead className="text-blue-800 text-xs font-semibold whitespace-nowrap">
                        Customer / Deal
                      </TableHead>
                      <TableHead className="text-blue-800 text-xs font-semibold whitespace-nowrap">
                        Project
                      </TableHead>
                      <TableHead className="text-blue-800 text-xs font-semibold whitespace-nowrap min-w-[140px]">
                        Initial Quote
                      </TableHead>
                      <TableHead className="text-blue-800 text-xs font-semibold whitespace-nowrap min-w-[140px]">
                        After Site Visit
                      </TableHead>
                      <TableHead className="text-blue-800 text-xs font-semibold whitespace-nowrap min-w-[140px]">
                        Final Quote
                      </TableHead>
                      <TableHead className="text-blue-800 text-xs font-semibold text-right whitespace-nowrap">
                        Variance (Initial → Final)
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="text-center text-gray-500 py-10 text-sm"
                        >
                          No quotations found. Ensure submitted quotations have Revision Type
                          (Initial Quote, After Site Visit, Final Quote) in the selected period.
                        </TableCell>
                      </TableRow>
                    ) : (
                      entries.map((row) => (
                        <TableRow key={row.group_key} className="hover:bg-blue-50/50">
                          <TableCell className="text-sm font-medium text-gray-900">
                            {row.party_name || row.group_key}
                          </TableCell>
                          <TableCell className="text-xs text-gray-600">
                            {row.project || "—"}
                          </TableCell>
                          <TableCell className="text-xs align-top">
                            <div className="space-y-0.5">
                              <QuotationLink name={row.initial_quote_name}>
                                {row.initial_quote_name || "—"}
                              </QuotationLink>
                              <div className="text-gray-500">{formatDate(row.initial_quote_date)}</div>
                              <div className="font-mono text-blue-900">
                                {fmt(row.initial_quote_amount, row.currency)}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs align-top">
                            <div className="space-y-0.5">
                              <QuotationLink name={row.after_site_visit_name}>
                                {row.after_site_visit_name || "—"}
                              </QuotationLink>
                              <div className="text-gray-500">
                                {formatDate(row.after_site_visit_date)}
                              </div>
                              <div className="font-mono text-blue-900">
                                {fmt(row.after_site_visit_amount, row.currency)}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs align-top">
                            <div className="space-y-0.5">
                              <QuotationLink name={row.final_quote_name}>
                                {row.final_quote_name || "—"}
                              </QuotationLink>
                              <div className="text-gray-500">{formatDate(row.final_quote_date)}</div>
                              <div className="font-mono text-blue-900 font-medium">
                                {fmt(row.final_quote_amount, row.currency)}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell
                            className={`text-xs text-right font-mono align-top ${
                              row.variance_initial_to_final < 0
                                ? "text-red-700"
                                : "text-slate-700"
                            }`}
                          >
                            {fmt(row.variance_initial_to_final, row.currency)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
