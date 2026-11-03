import { describe, it, expect } from 'vitest'
import { REPORTER_EMERGENCY_NOTICE, SEVERITY_POTENTIAL_HELP } from '@soteria/core/reporterGuidance'
import { INCIDENT_SEVERITY_POTENTIAL } from '@soteria/core/incident'
import { t, SUPPORTED_LOCALES } from '@/lib/anonReport/i18n'

// The words a worker reads while filing a report. These tests pin the
// properties that matter on a plant floor, not the exact phrasing, so
// wording can be improved without a test edit.

describe('REPORTER_EMERGENCY_NOTICE', () => {
  it.each(SUPPORTED_LOCALES)('has a heading and a body in %s', locale => {
    const { heading, body } = REPORTER_EMERGENCY_NOTICE[locale]
    expect(heading.trim().length).toBeGreaterThan(0)
    expect(body.trim().length).toBeGreaterThan(0)
  })

  it.each(SUPPORTED_LOCALES)('never ships a placeholder to a worker (%s)', locale => {
    const { heading, body } = REPORTER_EMERGENCY_NOTICE[locale]
    expect(`${heading} ${body}`).not.toMatch(/[[\]{}]/)
  })

  it('tells a reader in English to stop, get help, and tell a supervisor', () => {
    const { body } = REPORTER_EMERGENCY_NOTICE.en
    expect(body).toMatch(/stop the job/i)
    expect(body).toMatch(/get help first/i)
    expect(body).toMatch(/supervisor/i)
  })

  it('tells a reader in Spanish to stop, get help, and tell a supervisor', () => {
    const { body } = REPORTER_EMERGENCY_NOTICE.es
    expect(body).toMatch(/pare el trabajo/i)
    expect(body).toMatch(/pida ayuda primero/i)
    expect(body).toMatch(/supervisor/i)
  })

  it('says to leave equipment alone, so the first reaction is not to restart it', () => {
    expect(REPORTER_EMERGENCY_NOTICE.en.body).toMatch(/don’t restart equipment/i)
  })
})

describe('SEVERITY_POTENTIAL_HELP', () => {
  it('describes every band the incident form offers', () => {
    for (const band of INCIDENT_SEVERITY_POTENTIAL) {
      expect(SEVERITY_POTENTIAL_HELP[band]?.trim().length).toBeGreaterThan(0)
    }
  })

  it('names life-changing injury, not only death, at the top band', () => {
    // A scale that stops at "fatal" teaches people to under-call an amputation.
    expect(SEVERITY_POTENTIAL_HELP.extreme).toMatch(/amputation/i)
    expect(SEVERITY_POTENTIAL_HELP.extreme).toMatch(/changed their life/i)
  })

  it('does not call a reportable near miss harmless at the bottom band in the future tense', () => {
    // "No injury possible" is false of anything worth reporting.
    expect(SEVERITY_POTENTIAL_HELP.low).not.toMatch(/no injury possible/i)
  })
})

describe('anonymous report catalog', () => {
  const en = t('en')
  const es = t('es')

  it('defines the same keys in both languages, none of them empty', () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort())
    for (const catalog of [en, es]) {
      for (const [key, value] of Object.entries(catalog)) {
        expect(value.trim().length, key).toBeGreaterThan(0)
      }
    }
  })

  it.each(SUPPORTED_LOCALES)('cites no regulation section in the retaliation line (%s)', locale => {
    // 1904.35(b)(1)(iv) concerns reporting a work-related injury or illness;
    // it is not a promise about anonymous reports. A poster must not
    // attribute to a rule something the rule does not say.
    expect(t(locale).retaliationDefault).not.toMatch(/\b\d{3,4}\.\d+/)
  })

  it.each(SUPPORTED_LOCALES)('does not claim the worker\'s name is never held (%s)', locale => {
    const c = t(locale)
    expect(c.shieldNote).not.toMatch(/never|nunca/i)
  })

  it.each(SUPPORTED_LOCALES)('never tells an emergency reporter to simply close the page (%s)', locale => {
    expect(t(locale).thankYouTeam).not.toMatch(/close this page|cerrar esta página/i)
  })

  it.each(SUPPORTED_LOCALES)('points the worker at a screen, not a raw URL path (%s)', locale => {
    expect(t(locale).receiptHint).not.toContain('/report/status')
  })

  it.each(SUPPORTED_LOCALES)('does not promise that reloading adds to a report (%s)', locale => {
    expect(t(locale).privacyFooter).not.toMatch(/reloading|recargando/i)
  })

  it.each(SUPPORTED_LOCALES)('warns that a voice note can identify the speaker (%s)', locale => {
    expect(t(locale).attachmentsHint).toMatch(locale === 'en' ? /voice recording can identify you/i : /voz grabada puede revelar/i)
  })
})
