'use client'

import type { Equipment, LotoEnergyStep } from '@/lib/types'
import { ENERGY_CODES, energyCodeFor } from '@/lib/energyCodes'
import { PLACARD_TEXT } from '@/lib/placardText'
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
  const lang: 'en' = 'en'
  const notes = equipment.notes?.trim() ? equipment.notes : PLACARD_TEXT.warningFallback.en

  return (
    <article className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 shadow-md rounded-lg overflow-hidden font-sans">
      {/* ── Yellow header band ──────────────────────────────────────────── */}
      <header className="flex items-center gap-3 px-4 py-3" style={{ backgroundColor: COLOR.yellow }}>
        <div className="w-11 h-11 bg-[#214487] rounded flex items-center justify-center text-[#FFD900] font-bold text-sm shrink-0">
          SL
        </div>
        <h1 className="flex-1 text-center text-lg sm:text-xl font-black tracking-tight text-black">
          {PLACARD_TEXT.title[lang]}
        </h1>
        <div className="text-[10px] text-black/75 font-semibold whitespace-nowrap text-right shrink-0">
          <div className="uppercase tracking-wider">Date</div>
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

      {/* ── Purpose + Steps (2 columns) ─────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-[55fr_45fr] gap-4 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#214487] mb-1.5">
            {PLACARD_TEXT.purposeHeader[lang]}
          </h3>
          <p className="text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">{PLACARD_TEXT.purposeBody[lang]}</p>
        </div>
        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#214487] mb-1.5">
            {PLACARD_TEXT.stepsHeader[lang]}
          </h3>
          <ol className="list-decimal list-inside space-y-0.5 text-[11px] text-slate-700 dark:text-slate-300 marker:font-bold marker:text-[#214487]">
            {PLACARD_TEXT.steps[lang].map(s => <li key={s}>{s}</li>)}
          </ol>
        </div>
      </div>

      {/* ── Color legend bar ────────────────────────────────────────────── */}
      <div className="bg-slate-100 dark:bg-slate-800 px-4 py-1.5 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
          {ENERGY_CODES.map(ec => (
            <span key={ec.code} className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-700 dark:text-slate-300">
              <span
                className="inline-block w-4 h-4 rounded font-mono font-bold text-[9px] flex items-center justify-center shadow-sm"
                style={{ backgroundColor: ec.hex, color: ec.textHex }}
              >
                {ec.code}
              </span>
              {ec.labelEn}
            </span>
          ))}
        </div>
      </div>

      {/* ── Navy section header ─────────────────────────────────────────── */}
      <div
        className="px-4 py-2 text-center text-white text-xs font-bold uppercase tracking-wider"
        style={{ backgroundColor: COLOR.navy }}
      >
        {PLACARD_TEXT.sectionHeader[lang]}
      </div>

      {/* ── Photo row ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 bg-slate-200 dark:bg-slate-700">
        <div className="h-56 sm:h-64">
          <PlacardPhotoSlot
            equipmentId={equipment.equipment_id}
            type="EQUIP"
            label={PLACARD_TEXT.photoCaptions[lang].equipment}
            existingUrl={equipment.equip_photo_url}
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
                        {step.tag_description || <span className="text-slate-300 italic">—</span>}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top border-t border-slate-200 dark:border-slate-700 text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-snug">
                    {step.isolation_procedure || <span className="text-slate-300 italic">—</span>}
                  </td>
                  <td className="px-3 py-2 align-top border-t border-slate-200 dark:border-slate-700 text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-snug">
                    {step.method_of_verification || <span className="text-slate-300 italic">—</span>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

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
