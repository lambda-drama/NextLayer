"use client"

import { useEffect, useState, type ReactNode, type ChangeEvent } from "react"
import { NavLink, useLocation } from "react-router-dom"
import { Moon, Sun } from "lucide-react"
import { cn } from "../lib/utils"

/**
 * Slim, theme-aware top bar used by the Intercompany pages.
 * Visual language: compact height, muted surface, amber brand + active tab underline.
 * (Pure UI — it only renders navigation links that already exist as routes.)
 */
const NAV_ITEMS = [
  { to: "/reconciliation", label: "Reconciliation" },
  { to: "/ledger", label: "Ledger Summary" },
  { to: "/import-export", label: "Import / Export" },
  { to: "/cost-estimate-vs-consumed", label: "CEC" },
  { to: "/quotation-stages", label: "Quotation Stages" },
]

const THEME_STORAGE_KEY = "nextlayer-ui-theme"

export default function IntercompanyTopNav({ className }: { className?: string }) {
  const [theme, setTheme] = useState<"light" | "dark">("light")
  const { pathname } = useLocation()

  // The root route renders the reconciliation page, so both "/" and
  // "/reconciliation" should light up the Reconciliation tab.
  const isItemActive = (to: string, isActive: boolean) =>
    isActive || (to === "/reconciliation" && pathname === "/")

  // Restore the saved theme (falls back to the OS preference) on mount
  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === "dark" || stored === "light") {
      setTheme(stored)
    } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setTheme("dark")
    }
  }, [])

  // Apply + persist the theme
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:border-slate-700 dark:bg-slate-800/95 dark:supports-[backdrop-filter]:bg-slate-800/80",
        className
      )}
    >
      <div className="mx-auto flex h-11 max-w-screen-2xl items-center gap-3 px-4">
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.18em] text-amber-500 dark:text-amber-400">
          Intercompany
        </span>

        <nav className="flex h-full min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "relative flex h-full items-center whitespace-nowrap rounded-sm px-2.5 text-[13px] font-medium transition-colors",
                  "after:absolute after:inset-x-2.5 after:bottom-0 after:h-[2px] after:rounded-full after:transition-colors",
                  isItemActive(item.to, isActive)
                    ? "text-slate-900 after:bg-amber-500 dark:text-white dark:after:bg-amber-400"
                    : "text-slate-500 hover:text-slate-900 after:bg-transparent dark:text-slate-400 dark:hover:text-white"
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <button
          type="button"
          onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white"
        >
          {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </button>
      </div>
    </header>
  )
}


/** Compact page title row: small bold title + inline muted helper text. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h1 className="text-[17px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          {title}
        </h1>
        {subtitle ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  )
}

/** Shared compact input styling for native date/number/text inputs. */
export const compactInputClass =
  "h-8 w-full rounded-md border border-slate-200 bg-white px-2.5 text-[13px] text-slate-900 shadow-sm transition-colors focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-blue-500 dark:focus:ring-blue-500"

/** Compact labelled filter field (label sits above a small control). */
export function FilterField({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
        {label}
      </label>
      {children}
    </div>
  )
}

/** Compact inline checkbox option (chip style, no boxed container). */
export function CheckOption({
  id,
  label,
  checked,
  onChange,
  disabled = false,
}: {
  id: string
  label: string
  checked: boolean
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
  disabled?: boolean
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "inline-flex cursor-pointer select-none items-center gap-2 whitespace-nowrap text-xs text-slate-600 dark:text-slate-300",
        disabled && "cursor-not-allowed opacity-60"
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-slate-300 text-blue-600 accent-blue-600 focus:ring-blue-500 focus:ring-offset-0 disabled:cursor-not-allowed dark:border-slate-500 dark:bg-slate-700"
      />
      {label}
    </label>
  )
}
