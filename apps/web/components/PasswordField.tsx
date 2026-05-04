'use client'

import { useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff, Lock } from 'lucide-react'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  labelClass?: string
}

// Password <input> with an inline show/hide toggle. Bumped to text-base on
// mobile (>=16px) so iOS Safari doesn't auto-zoom on focus.
export default function PasswordField({ labelClass: _labelClass, className = '', ...rest }: Props) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="relative">
      <Lock className="h-4 w-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input
        {...rest}
        type={visible ? 'text' : 'password'}
        className={`w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-11 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy ${className}`}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible(v => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 rounded"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}
