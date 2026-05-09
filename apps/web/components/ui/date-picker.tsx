"use client"

import { format } from "date-fns"
import { Calendar as CalendarIcon } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface DatePickerProps {
  value?:        Date
  onChange?:     (date: Date | undefined) => void
  placeholder?:  string
  disabled?:     boolean
  className?:    string
  /** Pass through to react-day-picker — e.g. { before: new Date() }. */
  matcher?:      React.ComponentProps<typeof Calendar>["disabled"]
}

// Composed primitive: Calendar inside Popover with a button trigger
// that shows the formatted selected date or a placeholder. Drop this
// in anywhere a single date is being picked (permit expiry, training
// renewal, near-miss occurred-at).
function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  disabled,
  className,
  matcher,
}: DatePickerProps) {
  return (
    <Popover>
      <PopoverTrigger
        render={(triggerProps) => (
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "w-full justify-start text-left font-normal",
              !value && "text-muted-foreground",
              className
            )}
            {...triggerProps}
          >
            <CalendarIcon className="mr-2 size-4" />
            {value ? format(value, "PPP") : placeholder}
          </Button>
        )}
      />
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={onChange}
          disabled={matcher}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  )
}

export { DatePicker }
