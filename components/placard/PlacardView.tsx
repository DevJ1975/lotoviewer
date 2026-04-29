'use client'

import { useState } from 'react'
import { Languages } from 'lucide-react'
import type { Equipment, LotoEnergyStep } from '@/lib/types'
import { ENERGY_CODES, energyCodeFor } from '@/lib/energyCodes'
import { PLACARD_TEXT } from '@/lib/placardText'
import { parseAnnotations } from '@/lib/photoAnnotations'
import PlacardPhotoSlot from './PlacardPhotoSlot'

interface Props {
  equipment: Equipment
  steps:     LotoEnergyStep[]
  onPhotoSuccess?: (msg: string) => void
  onPhotoError?:   (msg: string) => void
  // Fires with the photo type whenever a slot reports a successful save —
  // lets the parent implement behaviors like auto-advance after capture.
  onPhotoSaved?:   (type: 'equip' | 'iso') => void
}

type Lang = 'en' | 'es'

// ── Color palette matching physical placard ────────────────────────────────
const COLOR = {
  yellow: '#FFD900',
  red:    '#BF1414',
  blue:   '#D9EBFF',
  navy:   '#214487',
}

function EnergyBadge({ code }: { code: string }) {
  const { hex, textHex } = energyCodeFor(code)
  return (
    <span
      className="inline-flex items-center justify-center w-8 h-6 rounded text-[11px] font-bold font-mono shrink-0 shadow-sm"
      style={{ backgroundColor: hex, color: textHex }}
    >
      {code}
    </span>
  )
}

export default function PlacardView({ equipment, steps, onPhotoSuccess, onPhotoError, onPhotoSaved }: Props) {
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const [lang, setLang] = useState<Lang>('en')
  const notes = lang === 'en'
    ? (equipment.notes?.trim()    ? equipment.notes    : PLACARD_TEXT.warningFallback.en)
    : (equipment.notes_es?.trim() ? equipment.notes_es : PLACARD_TEXT.warningFallback.es)

  return (
    <article className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 shadow-md rounded-lg overflow-hidden font-sans relative">
      {/* ── Language toggle — floats top-right of the placard ─────────── */}
      <button
        type="button"
        onClick={() => setLang(l => l === 'en' ? 'es' : 'en')}
        className="absolute top-2 right-2 z-10 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/85 hover:bg-white text-[10px] font-bold tracking-wider text-[#214487] uppercase shadow ring-1 ring-black/10"
        aria-label={`Switch to ${lang === 'en' ? 'Spanish' : 'English'}`}
      >
        <Languages className="h-3 w-3" />
        {lang === 'en' ? 'ES' : 'EN'}
      </button>

      {/* ── Yellow header band ──────────────────────────────────────────── */}
      <header className="flex items-center gap-3 px-4 py-3" style={{ backgroundColor: COLOR.yellow }}>
        <div className="w-11 h-11 bg-[#214487] rounded flex items-center justify-center text-[#FFD900] font-bold text-sm shrink-0">
          SL
        </div>
        <h1 className="flex-1 text-center text-lg sm:text-xl font-black tracking-tight text-black">
          {PLACARD_TEXT.title[lang]}
        </h1>
        <div className="text-[10px] text-black/75 font-semibold whitespace-nowrap text-right shrink-0 pr-12">
          <div className="uppercase tracking-wider">{lang === 'en' ? 'Date' : 'Fecha'}</div>
          <div className="font-bold">{dateStr}</div>
        </div>
      </header>

      {/* ── Light blue equipment bar ────────────────────────────────────── */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-1.5 border-y border-slate-200 dark:border-slate-700"
        style={{ backgroundColor: COLOR.blue }}
      >
        <p className="text-sm min-w-0 truncate">
          <span className="font-bold text-[#214487]">{PLACARD_TEXT.equipmentLabel[lang]}</span>{' '}
          <span className="font-semibold">{equipment.description}</span>
        </p>
        <p className="text-sm font-bold text-[#214487] shrink-0">{equipment.department}</p>
      </div>

      {/* ── Red warning block ───────────────────────────────────────────── */}
      <div className="px-4 py-2.5 text-white" style={{ backgroundColor: COLOR.red }}>
        <p className="text-center font-black text-sm tracking-wide">{PLACARD_TEXT.warningHeader[lang]}</p>
        <p className="text-center text-[11px] mt-1 opacity-95 leading-snug">{notes}</p>
      </div>

      {/* ── Purpose ─────────────────────────────────────────────────────── */}
      <SectionBar title={PLACARD_TEXT.purposeHeader[lang]} />
      <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-700">
        <p className="text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">
          {PLACARD_TEXT.purposeBody[lang]}
        </p>
      </div>

      {/* ── Lockout Application Process ─────────────────────────────────── */}
      <SectionBar title={PLACARD_TEXT.applicationHeader[lang]} />
      <NumberedSteps steps={PLACARD_TEXT.applicationSteps[lang]} />

      {/* ── Color Codes legend ──────────────────────────────────────────── */}
      <SectionBar title={PLACARD_TEXT.colorCodesHeader[lang]} />
      <ColorCodesGrid lang={lang} />

      {/* ── Section header for equipment + photos ───────────────────────── */}
      <div
        className="px-4 py-2 text-center text-white text-xs font-bold uppercase tracking-wider"
        style={{ backgroundColor: COLOR.navy }}
      >
        {PLACARD_TEXT.sectionHeader[lang]}
      </div>

      {/* ── Photo row ───────────────────────────────────────────────────── */}
      {/* Annotations parsed once here so the same shape array drives the
          on-placard overlay AND the editor on the equipment detail page.
          Equipment photo overlays are navy; isolation overlays are red
          to match the placard palette. */}
      <div className="grid grid-cols-2 bg-slate-200 dark:bg-slate-700">
        <div className="h-56 sm:h-64">
          <PlacardPhotoSlot
            equipmentId={equipment.equipment_id}
            type="EQUIP"
            label={PLACARD_TEXT.photoCaptions[lang].equipment}
            existingUrl={equipment.equip_photo_url}
            annotations={parseAnnotations(equipment.annotations)}
            color="#214488"
            onSuccess={() => { onPhotoSuccess?.('Equipment photo saved.'); onPhotoSaved?.('equip') }}
            onError={onPhotoError}
          />
        </div>
        <div className="h-56 sm:h-64 border-l border-slate-300 dark:border-slate-700">
          <PlacardPhotoSlot
            equipmentId={equipment.equipment_id}
            type="ISO"
            label={PLACARD_TEXT.photoCaptions[lang].isolation}
            existingUrl={equipment.iso_photo_url}
            annotations={parseAnnotations(equipment.iso_annotations)}
            color="#BF1414"
            onSuccess={() => { onPhotoSuccess?.('Isolation photo saved.'); onPhotoSaved?.('iso') }}
            onError={onPhotoError}
          />
        </div>
      </div>

      {/* ── Energy isolation table ──────────────────────────────────────── */}
      <div className="overflow-x-auto border-t border-slate-300 dark:border-slate-700">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-white text-left" style={{ backgroundColor: COLOR.navy }}>
              <th className="px-3 py-2 font-bold uppercase tracking-wider text-[10px] w-[28%]">
                {PLACARD_TEXT.tableHeaders[lang][0]}
              </th>
              <th className="px-3 py-2 font-bold uppercase tracking-wider text-[10px] w-[36%]">
                {PLACARD_TEXT.tableHeaders[lang][1]}
              </th>
              <th className="px-3 py-2 font-bold uppercase tracking-wider text-[10px] w-[36%]">
                {PLACARD_TEXT.tableHeaders[lang][2]}
              </th>
            </tr>
          </thead>
          <tbody>
            {steps.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-slate-400 dark:text-slate-500 italic">
                  {PLACARD_TEXT.noSteps[lang]}
                </td>
              </tr>
            ) : (
              steps.map((step, i) => (
                <tr key={step.id} className={i % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50 dark:bg-slate-900/40'}>
                  <td className="px-3 py-2 align-top border-t border-slate-200 dark:border-slate-700">
                    <div className="flex items-start gap-2">
                      <EnergyBadge code={step.energy_type} />
                      <div className="text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-snug min-w-0">
                        {(lang === 'es' && step.tag_description_es) ? step.tag_description_es : (step.tag_description || <span className="text-slate-300 italic">—</span>)}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top border-t border-slate-200 dark:border-slate-700 text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-snug">
                    {(lang === 'es' && step.isolation_procedure_es) ? step.isolation_procedure_es : (step.isolation_procedure || <span className="text-slate-300 italic">—</span>)}
                  </td>
                  <td className="px-3 py-2 align-top border-t border-slate-200 dark:border-slate-700 text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-snug">
                    {(lang === 'es' && step.method_of_verification_es) ? step.method_of_verification_es : (step.method_of_verification || <span className="text-slate-300 italic">—</span>)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Lockout Removal Process ─────────────────────────────────────── */}
      <SectionBar title={PLACARD_TEXT.removalHeader[lang]} />
      <NumberedSteps steps={PLACARD_TEXT.removalSteps[lang]} />

      {/* ── Signature bar ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 border-t border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 text-[10px] font-bold uppercase tracking-wider text-[#214487]">
        {PLACARD_TEXT.signature[lang].map((label, i) => (
          <div
            key={label}
            className={`px-3 py-2 ${i < 3 ? 'border-r border-slate-300 dark:border-slate-700' : ''} min-h-[38px] flex items-end`}
          >
            {label}{i < 3 ? ':' : ''}
          </div>
        ))}
      </div>
    </article>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────

// Red header strip matching Snak King's section bands (DANGER, PURPOSE,
// LOCKOUT APPLICATION PROCESS, etc.). Keeps the placard visually
// consistent across every section break.
function SectionBar({ title }: { title: string }) {
  return (
    <div
      className="px-4 py-1 text-center text-white text-[12px] font-black uppercase tracking-wider"
      style={{ backgroundColor: COLOR.red }}
    >
      {title}
    </div>
  )
}

// Numbered list shown in two columns for vertical compactness.
// Splits a 7-step list as 4 + 3 to mirror the Snak King layout.
function NumberedSteps({ steps }: { steps: readonly string[] }) {
  // Render in document order across columns (1-4 left, 5-7 right) so a
  // worker reading top-to-bottom hits steps in the correct sequence.
  const split = Math.ceil(steps.length / 2)
  const left  = steps.slice(0, split)
  const right = steps.slice(split)
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0 px-4 py-2 border-b border-slate-200 dark:border-slate-700">
      <ol className="text-[11px] text-slate-700 dark:text-slate-300 leading-snug space-y-0.5" start={1}>
        {left.map((s, i) => (
          <li key={s} className="flex gap-1.5"><span className="font-bold text-[#214487] shrink-0">{i + 1}.</span><span>{s}</span></li>
        ))}
      </ol>
      <ol className="text-[11px] text-slate-700 dark:text-slate-300 leading-snug space-y-0.5" start={split + 1}>
        {right.map((s, i) => (
          <li key={s} className="flex gap-1.5"><span className="font-bold text-[#214487] shrink-0">{split + i + 1}.</span><span>{s}</span></li>
        ))}
      </ol>
    </div>
  )
}

// 12-chip color legend in a 6-column × 2-row grid, matching the Snak
// King reference layout.
function ColorCodesGrid({ lang }: { lang: Lang }) {
  const renderable = ENERGY_CODES.filter(ec => ec.code !== 'N')
  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-px bg-slate-300 dark:bg-slate-700 border-b border-slate-300 dark:border-slate-700">
      {renderable.map(ec => (
        <div
          key={ec.code}
          className="px-2 py-1 flex items-center gap-1.5 text-[10px] font-semibold"
          style={{ backgroundColor: ec.hex, color: ec.textHex }}
        >
          <span className="font-mono font-black tracking-wider">{ec.code} =</span>
          <span className="truncate">{lang === 'en' ? ec.labelEn : ec.labelEs}</span>
        </div>
      ))}
    </div>
  )
}
