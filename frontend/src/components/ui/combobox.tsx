"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "../../lib/utils"
import { Button } from "./button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../../components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../components/ui/popover"

interface ComboboxProps {
  options: Array<{ name: string; value: string }>
  value?: string
  onValueChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  searchPlaceholder?: string
  emptyMessage?: string
}

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = "Select option...",
  disabled = false,
  className,
  searchPlaceholder = "Search...",
  emptyMessage = "No results found.",
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)

  const selectedOption = options.find((option) => option.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            // Compact single-line trigger: long values are truncated instead of
            // overflowing into the neighbouring field/column.
            "h-8 w-full min-w-0 justify-between gap-1 overflow-hidden rounded-md border-slate-200 bg-white px-2.5 text-[13px] font-normal text-slate-900 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700",
            !value && "text-slate-500 dark:text-slate-400",
            className
          )}
          disabled={disabled}
        >
          <span className="min-w-0 flex-1 truncate text-left">
            {selectedOption ? selectedOption.name : placeholder}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        // Visible panel chrome: the base `bg-popover` surface (see index.css) is
        // one step lighter than the page in dark mode and the border/shadow make
        // the open list clearly sit above the fields behind the trigger.
        className="w-[var(--radix-popover-trigger-width)] overflow-hidden border-slate-200 p-0 shadow-lg dark:border-slate-500/70 dark:shadow-black/60"
      >
        <Command className="bg-popover text-popover-foreground [&_[cmdk-input-wrapper]]:border-slate-200 dark:[&_[cmdk-input-wrapper]]:border-slate-500/70">
          <CommandInput
            placeholder={searchPlaceholder}
            className="h-8 py-1 text-[13px] text-slate-900 placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
          <CommandList>
            <CommandEmpty className="text-slate-500 dark:text-slate-400">{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.name}
                  onSelect={() => {
                    onValueChange(option.value)
                    setOpen(false)
                  }}
                  // Explicit palette for the highlighted row: the shadcn `bg-accent`
                  // token is not registered in tailwind.config.js, so cmdk's
                  // selected/active state would otherwise be invisible.
                  className="cursor-pointer gap-0 text-[13px] text-slate-700 hover:bg-blue-50 hover:text-blue-900 aria-selected:bg-blue-50 aria-selected:text-blue-900 data-[selected=true]:bg-blue-50 data-[selected=true]:text-blue-900 dark:text-slate-200 dark:hover:bg-slate-600 dark:hover:text-white dark:aria-selected:bg-slate-600 dark:aria-selected:text-white dark:data-[selected=true]:bg-slate-600 dark:data-[selected=true]:text-white"
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === option.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {option.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

