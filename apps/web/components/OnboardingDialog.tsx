'use client'

import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ONBOARDING_STEPS, shouldShowOnboarding } from '@/lib/onboarding'

// First-login instruction popup. Renders once per user (gated on
// profiles.onboarding_completed_at). Mounted globally in AppChrome, so it
// only appears on authenticated, non-public routes.
//
// Completion is optimistic: we stamp the profile in context immediately
// (which unmounts the dialog) and persist best-effort. A failed write just
// means the walkthrough shows again next sign-in — never a blocked user.
export default function OnboardingDialog() {
  const { userId, profile, setProfile } = useAuth()
  const [step, setStep] = useState(0)

  if (!shouldShowOnboarding(profile) || !userId || !profile) return null

  const p = profile
  const uid = userId
  const current = ONBOARDING_STEPS[step]!
  const isLast = step >= ONBOARDING_STEPS.length - 1

  function complete() {
    const completedAt = new Date().toISOString()
    setProfile({ ...p, onboarding_completed_at: completedAt })
    void supabase
      .from('profiles')
      .update({ onboarding_completed_at: completedAt })
      .eq('id', uid)
      .then(({ error }) => {
        if (error) console.warn('[onboarding] failed to persist completion', error)
      })
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) complete() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-emerald-600" aria-hidden="true" />
            {current.title}
          </DialogTitle>
          <DialogDescription>{current.body}</DialogDescription>
        </DialogHeader>

        {current.bullets && (
          <ul className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
            {current.bullets.map((b) => (
              <li key={b} className="flex gap-2">
                <span aria-hidden="true" className="mt-0.5 text-emerald-600">•</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-center gap-1.5 pt-1" aria-hidden="true">
          {ONBOARDING_STEPS.map((s, i) => (
            <span
              key={s.title}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? 'w-5 bg-emerald-600' : 'w-1.5 bg-slate-300 dark:bg-slate-700'
              }`}
            />
          ))}
        </div>

        <DialogFooter>
          {step > 0 && (
            <Button variant="ghost" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          {isLast ? (
            <Button onClick={complete}>Got it — let’s go</Button>
          ) : (
            <Button onClick={() => setStep(step + 1)}>Next</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
