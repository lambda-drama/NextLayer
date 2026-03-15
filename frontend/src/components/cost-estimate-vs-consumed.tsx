"use client"

import { useState } from "react"
import { Link } from "react-router-dom"
import { ArrowLeft, BarChart3, Building2 } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { Button } from "./ui/button"
import { Combobox } from "./ui/combobox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table"
import { Alert, AlertDescription } from "../../components/ui/alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"

import { useCompanies } from "../hook/useCompanies"
import { usePermissionAwareCompanies } from "../hook/usePermissionAwareCompanies"
import { useAllCompaniesForUI } from "../hook/useAllCompaniesForUI"
import { useProjects } from "../hook/useProjects"
import {
  useCostEstimateVsConsumed,
  type CostEstimateVsConsumedEntry,
  type CostEstimateVsConsumedTotals,
  type CostEstimateVsConsumedMeta,
} from "../hook/useCostEstimateVsConsumed"

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

interface SummaryCardProps {
  title: string
  value: number
  currency: string
  tone: "primary" | "success" | "danger" | "muted"
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

export default function CostEstimateVsConsumed() {
  const [company, setCompany] = useState<string>("")
  const [project, setProject] = useState<string>("")
  const [projectType, setProjectType] = useState<string>("all")
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

  const [projectTypes, setProjectTypes] = useState<string[]>([])

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  // Load Project Types for filter
  useState(() => {
    const fetchProjectTypes = async () => {
      try {
        const params = new URLSearchParams()
        params.set("fields", JSON.stringify(["name"]))
        params.set("limit_page_length", "0")

        const csrfToken =
          (window as unknown as { csrf_token?: string }).csrf_token || ""

        const response = await fetch(`/api/resource/Project Type?${params.toString()}`, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "X-Frappe-CSRF-Token": csrfToken,
          },
          credentials: "include",
        })

        if (!response.ok) {
          return
        }

        const result = await response.json()
        const data: { name: string }[] = Array.isArray(result?.data) ? result.data : []
        setProjectTypes(data.map((d) => d.name))
      } catch {
        setProjectTypes([])
      }
    }

    fetchProjectTypes()
  })

  const {
    data,
    isLoading,
    error: fetchError,
  }: {
    data: {
      entries: CostEstimateVsConsumedEntry[]
      totals: CostEstimateVsConsumedTotals
      meta: CostEstimateVsConsumedMeta
    } | null
    isLoading: boolean
    error: string | null
  } = useCostEstimateVsConsumed({
    company,
    project,
    projectType,
    fromDate,
    toDate,
    currency,
    enabled: hasLoadedData,
  })

  const entries = data?.entries ?? []
  const totals = data?.totals
  const meta = data?.meta
  const displayCurrency = meta?.display_currency || currency || "USD"

  const handleLoadData = () => {
    if (!company) {
      setError("Please select a company")
      return
    }
    setError("")
    setExpandedGroups(new Set())
    setHasLoadedData(true)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20 p-4">
      <div className="max-w-8xl mx-auto space-y-5">
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
              Cost Estimate vs Consumed
            </h1>
            <p className="text-gray-500 text-sm mt-0.5">
              Compare project Cost Estimate (materials) against actual consumption
              (Purchase Invoices &amp; Stock Entries)
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
                  Project Type
                </label>
                <Select value={projectType} onValueChange={setProjectType}>
                  <SelectTrigger className="border-blue-200 focus:border-blue-400 text-sm">
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent className="bg-blue-200">
                    <SelectItem value="all">All Types</SelectItem>
                    {projectTypes.map((pt) => (
                      <SelectItem key={pt} value={pt}>
                        {pt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                      : "Select project"
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
                  <SelectContent className="bg-blue-200">
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

        {hasLoadedData && meta?.message && (
          <Alert className="border-blue-200 bg-blue-50">
            <AlertDescription className="text-blue-800">{meta.message}</AlertDescription>
          </Alert>
        )}

        {/* Sticky summary + labour/overhead cards */}
        {hasLoadedData && meta && totals && (
          <div className="sticky top-0 z-20 space-y-4 pb-4 bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <SummaryCard
                title="Estimated Materials (Total)"
                value={totals.estimate_amount}
                currency={displayCurrency}
                tone="primary"
              />
              <SummaryCard
                title="Consumed (Total)"
                value={totals.consumed_amount}
                currency={displayCurrency}
                tone="success"
              />
              <SummaryCard
                title="Variance (Estimate - Consumed)"
                value={totals.variance_amount}
                currency={displayCurrency}
                tone={totals.variance_amount >= 0 ? "muted" : "danger"}
              />
              <SummaryCard
                title="Estimate Grand Total (All Costs)"
                value={meta.estimate_grand_total}
                currency={displayCurrency}
                tone="muted"
              />
            </div>

            {/* Labour & Overhead summary (only when we have a Cost Estimate) */}
            {meta.has_cost_estimate && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <SummaryCard
                  title="Labour Estimate (Total)"
                  value={meta.estimate_labor}
                  currency={displayCurrency}
                  tone="success"
                />
                <SummaryCard
                  title="Overhead Estimate (Total)"
                  value={meta.estimate_overhead}
                  currency={displayCurrency}
                  tone="primary"
                />
              </div>
            )}

            {/* Expense total (only when no Cost Estimate — combined expense by account) */}
            {meta.has_cost_estimate === false && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <SummaryCard
                  title="Expense Total (Actual)"
                  value={
                    Object.values(meta.combined_expense_actual_by_account || {}).reduce(
                      (sum, amt) => sum + (typeof amt === "number" ? amt : 0),
                      0,
                    )
                  }
                  currency={displayCurrency}
                  tone="primary"
                />
              </div>
            )}
          </div>
        )}

        {/* Table */}
        {hasLoadedData && (
          <Card className="border-blue-200 shadow-md overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-blue-700 to-blue-800 text-white rounded-t-lg py-4 px-6">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <BarChart3 className="h-5 w-5" />
                  Line Breakdown
                </CardTitle>
                {meta && (
                  <span className="text-xs text-blue-100">
                    Project:{" "}
                    <span className="font-semibold text-white">{meta.project || "—"}</span>
                    {meta.has_cost_estimate && meta.estimate_name ? (
                      <> · Estimate: <span className="font-mono">{meta.estimate_name}</span></>
                    ) : (
                      <> · <span className="text-blue-200">No Cost Estimate</span></>
                    )}
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
                        Type
                      </TableHead>
                      <TableHead className="text-blue-800 text-xs font-semibold whitespace-nowrap">
                        Item / Group
                      </TableHead>
                      <TableHead className="text-blue-800 text-xs font-semibold text-right whitespace-nowrap">
                        Est. Qty
                      </TableHead>
                      <TableHead className="text-blue-800 text-xs font-semibold text-right whitespace-nowrap">
                        Est. Amount
                      </TableHead>
                      <TableHead className="text-blue-800 text-xs font-semibold text-right whitespace-nowrap">
                        Consumed Qty
                      </TableHead>
                      <TableHead className="text-blue-800 text-xs font-semibold text-right whitespace-nowrap">
                        Consumed Amount
                      </TableHead>
                      <TableHead className="text-blue-800 text-xs font-semibold text-right whitespace-nowrap">
                        Variance Qty
                      </TableHead>
                      <TableHead className="text-blue-800 text-xs font-semibold text-right whitespace-nowrap">
                        Variance Amount
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={8}
                          className="text-center text-gray-500 py-10 text-sm"
                        >
                          {meta?.has_cost_estimate === false
                            ? "No consumption data for this project in the selected period."
                            : "No data found. Add a Cost Estimate and/or ensure Purchase Invoices / Stock Entries exist for the selected period."}
                        </TableCell>
                      </TableRow>
                    ) : (
                      entries.map((row: CostEstimateVsConsumedEntry) => {
                        const hasChildren =
                          row.key_type === "Item Group" &&
                          meta?.group_items &&
                          Array.isArray(meta.group_items[row.key]) &&
                          meta.group_items[row.key].length > 0

                        const isExpanded = expandedGroups.has(row.key)

                        return (
                          <>
                            <TableRow
                              key={row.key}
                              className={hasChildren ? "cursor-pointer" : ""}
                              onClick={() => {
                                if (!hasChildren) return
                                setExpandedGroups((prev) => {
                                  const next = new Set(prev)
                                  if (next.has(row.key)) {
                                    next.delete(row.key)
                                  } else {
                                    next.add(row.key)
                                  }
                                  return next
                                })
                              }}
                            >
                              <TableCell className="text-xs text-gray-600 whitespace-nowrap">
                                {row.key_type}
                                {hasChildren && (
                                  <span className="ml-1 text-[10px] text-blue-500">
                                    {isExpanded ? "▾" : "▸"}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-xs font-medium text-gray-900 whitespace-nowrap">
                                {row.label}
                              </TableCell>
                              <TableCell className="text-xs text-right text-gray-700 whitespace-nowrap">
                                {row.estimate_qty.toLocaleString("en-US", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </TableCell>
                              <TableCell className="text-xs text-right text-blue-900 font-mono whitespace-nowrap">
                                {fmt(row.estimate_amount, row.currency)}
                              </TableCell>
                              <TableCell className="text-xs text-right text-gray-700 whitespace-nowrap">
                                {row.consumed_qty.toLocaleString("en-US", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </TableCell>
                              <TableCell className="text-xs text-right text-emerald-800 font-mono whitespace-nowrap">
                                {fmt(row.consumed_amount, row.currency)}
                              </TableCell>
                              <TableCell
                                className={`text-xs text-right font-mono whitespace-nowrap ${
                                  row.variance_qty < 0 ? "text-red-700" : "text-slate-700"
                                }`}
                              >
                                {row.variance_qty.toLocaleString("en-US", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </TableCell>
                              <TableCell
                                className={`text-xs text-right font-mono whitespace-nowrap ${
                                  row.variance_amount < 0 ? "text-red-700" : "text-slate-700"
                                }`}
                              >
                                {fmt(row.variance_amount, row.currency)}
                              </TableCell>
                            </TableRow>

                            {hasChildren &&
                              isExpanded &&
                              meta?.group_items?.[row.key]?.map((item) => (
                                <TableRow key={`${row.key}-${item.item_code}`}>
                                  <TableCell className="text-[11px] text-gray-400 pl-6">
                                    Item
                                  </TableCell>
                                  <TableCell className="text-[11px] text-gray-700">
                                    {item.item_code}
                                  </TableCell>
                                  <TableCell />
                                  <TableCell />
                                  <TableCell className="text-[11px] text-right text-gray-700">
                                    {item.consumed_qty.toLocaleString("en-US", {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2,
                                    })}
                                  </TableCell>
                                  <TableCell className="text-[11px] text-right font-mono text-emerald-700">
                                    {fmt(
                                      item.consumed_amount_ccy,
                                      displayCurrency,
                                    )}
                                  </TableCell>
                                  <TableCell />
                                  <TableCell />
                                </TableRow>
                              ))}
                          </>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* When no Cost Estimate: single Expense by account (actual only) */}
        {hasLoadedData && meta && meta.has_cost_estimate === false && (
          <Card className="border-blue-200 shadow-sm mt-4">
            <CardHeader className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg py-3 px-5">
              <CardTitle className="flex items-center gap-2 text-sm">
                Expense by Account (Actual)
              </CardTitle>
              <p className="text-xs text-blue-100 mt-1">
                No Cost Estimate — labour/overhead cannot be split; showing actual expense by account for the project.
              </p>
            </CardHeader>
            <CardContent className="p-4">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-blue-50">
                      <TableHead className="text-blue-800 text-xs font-semibold">
                        Expense Account
                      </TableHead>
                      <TableHead className="text-blue-800 text-xs font-semibold text-right">
                        Actual Amount
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {meta.combined_expense_actual_by_account &&
                    Object.keys(meta.combined_expense_actual_by_account).length > 0 ? (
                      Object.entries(meta.combined_expense_actual_by_account).map(
                        ([account, amount]) => (
                          <TableRow key={account}>
                            <TableCell className="text-xs text-gray-800">
                              {account}
                            </TableCell>
                            <TableCell className="text-xs text-right font-mono text-blue-900">
                              {fmt(amount, displayCurrency)}
                            </TableCell>
                          </TableRow>
                        ),
                      )
                    ) : (
                      <TableRow>
                        <TableCell
                          colSpan={2}
                          className="text-center text-xs text-gray-500 py-4"
                        >
                          No expense GL entries for this project in the selected period.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Detailed Labour & Overhead breakdown (only when Cost Estimate exists) */}
        {hasLoadedData && meta && meta.has_cost_estimate && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
            <Card className="border-emerald-200 shadow-sm">
              <CardHeader className="bg-gradient-to-r from-emerald-600 to-emerald-700 text-white rounded-t-lg py-3 px-5">
                <CardTitle className="flex items-center gap-2 text-sm">
                  Labour Estimate by Expense Account
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-emerald-50">
                        <TableHead className="text-emerald-900 text-xs font-semibold">
                          Expense Account
                        </TableHead>
                        <TableHead className="text-emerald-900 text-xs font-semibold text-right">
                          Estimated Labour
                        </TableHead>
                        <TableHead className="text-emerald-900 text-xs font-semibold text-right">
                          Actual Labour
                        </TableHead>
                        <TableHead className="text-emerald-900 text-xs font-semibold text-right">
                          Variance
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {meta.labor_by_expense_account &&
                      Object.keys(meta.labor_by_expense_account).length > 0 ? (
                        Object.entries(meta.labor_by_expense_account).map(
                          ([account, est]) => {
                            const actual =
                              meta.labor_actual_by_expense_account?.[account] ?? 0
                            const variance =
                              meta.labor_variance_by_expense_account?.[account] ??
                              (est as number) - actual

                            return (
                              <TableRow key={account}>
                                <TableCell className="text-xs text-gray-800">
                                  {account}
                                </TableCell>
                                <TableCell className="text-xs text-right font-mono text-emerald-800">
                                  {fmt(est as number, displayCurrency)}
                                </TableCell>
                                <TableCell className="text-xs text-right font-mono text-slate-800">
                                  {fmt(actual, displayCurrency)}
                                </TableCell>
                                <TableCell
                                  className={`text-xs text-right font-mono ${
                                    variance < 0 ? "text-red-700" : "text-slate-700"
                                  }`}
                                >
                                  {fmt(variance, displayCurrency)}
                                </TableCell>
                              </TableRow>
                            )
                          },
                        )
                      ) : (
                        <TableRow>
                          <TableCell
                            colSpan={4}
                            className="text-center text-xs text-gray-500 py-4"
                          >
                            No labour rows with expense accounts on this Cost Estimate.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card className="border-indigo-200 shadow-sm">
              <CardHeader className="bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-t-lg py-3 px-5">
                <CardTitle className="flex items-center gap-2 text-sm">
                  Overhead Estimate by Expense Account
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-indigo-50">
                        <TableHead className="text-indigo-900 text-xs font-semibold">
                          Expense Account
                        </TableHead>
                        <TableHead className="text-indigo-900 text-xs font-semibold text-right">
                          Estimated Overhead
                        </TableHead>
                        <TableHead className="text-indigo-900 text-xs font-semibold text-right">
                          Actual Overhead
                        </TableHead>
                        <TableHead className="text-indigo-900 text-xs font-semibold text-right">
                          Variance
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {meta.overhead_by_expense_account &&
                      Object.keys(meta.overhead_by_expense_account).length > 0 ? (
                        Object.entries(meta.overhead_by_expense_account).map(
                          ([account, est]) => {
                            const actual =
                              meta.overhead_actual_by_expense_account?.[account] ?? 0
                            const variance =
                              meta.overhead_variance_by_expense_account?.[account] ??
                              (est as number) - actual

                            return (
                              <TableRow key={account}>
                                <TableCell className="text-xs text-gray-800">
                                  {account}
                                </TableCell>
                                <TableCell className="text-xs text-right font-mono text-indigo-800">
                                  {fmt(est as number, displayCurrency)}
                                </TableCell>
                                <TableCell className="text-xs text-right font-mono text-slate-800">
                                  {fmt(actual, displayCurrency)}
                                </TableCell>
                                <TableCell
                                  className={`text-xs text-right font-mono ${
                                    variance < 0 ? "text-red-700" : "text-slate-700"
                                  }`}
                                >
                                  {fmt(variance, displayCurrency)}
                                </TableCell>
                              </TableRow>
                            )
                          },
                        )
                      ) : (
                        <TableRow>
                          <TableCell
                            colSpan={4}
                            className="text-center text-xs text-gray-500 py-4"
                          >
                            No overhead rows on this Cost Estimate.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}

