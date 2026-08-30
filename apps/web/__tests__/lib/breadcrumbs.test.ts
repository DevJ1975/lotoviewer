import { describe, it, expect } from 'vitest'
import { breadcrumbsFor } from '@/lib/breadcrumbs'

// Nothing in the product told you where you were. A page five levels deep
// under /admin rendered a title and nothing else.

describe('breadcrumbsFor — when it stays quiet', () => {
  it('renders no trail on a module home', () => {
    expect(breadcrumbsFor('/incidents')).toEqual([])
  })

  it('renders no trail at the root', () => {
    expect(breadcrumbsFor('/')).toEqual([])
  })

  it('drops a path whose ancestors are in no catalog', () => {
    expect(breadcrumbsFor('/definitely-not-a-module/xyz')).toEqual([])
  })
})

describe('breadcrumbsFor — feature routes', () => {
  it('names the parent module of a child page', () => {
    const crumbs = breadcrumbsFor('/incidents/new')
    expect(crumbs).toEqual([{ label: 'Incident Reporting', href: '/incidents' }])
  })

  it('stops short of the current page so the h1 is not repeated', () => {
    const crumbs = breadcrumbsFor('/incidents/new')
    expect(crumbs.map(c => c.href)).not.toContain('/incidents/new')
  })

  it('skips an id segment rather than showing a raw UUID as a crumb', () => {
    const crumbs = breadcrumbsFor('/incidents/8f14e45f-ceea-467a-9f1e-1f1f1f1f1f1f/actions')
    expect(crumbs.map(c => c.label)).toEqual(['Incident Reporting'])
  })
})

describe('breadcrumbsFor — admin routes', () => {
  it('builds the full trail through the admin catalog', () => {
    const crumbs = breadcrumbsFor('/admin/people/contractors/abc123')
    expect(crumbs.map(c => c.label)).toEqual([
      'Administration',
      'People & Access',
      'Contractors',
    ])
  })

  // /admin/<section> 301-redirects to /admin (getAdminRedirects). A linked
  // section crumb would silently send the user two levels up.
  it('leaves the section crumb unlinked because the section is not a page', () => {
    const crumbs = breadcrumbsFor('/admin/people/contractors/abc123')
    const section = crumbs.find(c => c.label === 'People & Access')
    expect(section?.href).toBeNull()
  })

  it('links the crumbs that are real pages', () => {
    const crumbs = breadcrumbsFor('/admin/people/contractors/abc123')
    expect(crumbs.find(c => c.label === 'Administration')?.href).toBe('/admin')
    expect(crumbs.find(c => c.label === 'Contractors')?.href).toBe('/admin/people/contractors')
  })

  it('renders no trail on the admin landing itself', () => {
    expect(breadcrumbsFor('/admin')).toEqual([])
  })

  it('names only the root above a section landing', () => {
    expect(breadcrumbsFor('/admin/people')).toEqual([
      { label: 'Administration', href: '/admin' },
    ])
  })
})

describe('breadcrumbsFor — every crumb is a real destination', () => {
  it('never emits a linked crumb pointing at an admin section', () => {
    const deep = [
      '/admin/people/contractors/abc/prequalification',
      '/admin/loto/review-queue/xyz',
      '/admin/compliance/calendar/2026',
    ]
    for (const path of deep) {
      for (const crumb of breadcrumbsFor(path)) {
        if (crumb.href === null) continue
        expect(crumb.href.split('/').filter(Boolean).length).not.toBe(2)
      }
    }
  })
})
