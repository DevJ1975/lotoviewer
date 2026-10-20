import { describe, it, expect } from 'vitest'

import { mobileRouteForWebPath } from '../mobileRoutes'

const ID = '3f2b8c1e-9a4d-4e7f-8b1a-2c3d4e5f6a7b'

describe('mobileRouteForWebPath', () => {
  it('maps a confined-space permit path to the permit screen', () => {
    expect(mobileRouteForWebPath(`/confined-spaces/TANK-4/permits/${ID}`)).toEqual({
      pathname: '/confined-spaces/[permitId]',
      params: { permitId: ID },
    })
  })

  it('maps hot work and near-miss detail paths', () => {
    expect(mobileRouteForWebPath(`/hot-work/${ID}`)).toEqual({ pathname: '/hot-work/[permitId]', params: { permitId: ID } })
    expect(mobileRouteForWebPath(`/near-miss/${ID}`)).toEqual({ pathname: '/near-miss/[id]', params: { id: ID } })
  })

  it('collapses incident sub-pages onto the incident', () => {
    expect(mobileRouteForWebPath(`/incidents/${ID}/actions`)).toEqual({ pathname: '/incidents/[id]', params: { id: ID } })
    expect(mobileRouteForWebPath(`/incidents/${ID}`)).toEqual({ pathname: '/incidents/[id]', params: { id: ID } })
  })

  it('resolves absolute URLs, query strings, fragments and trailing slashes', () => {
    expect(mobileRouteForWebPath(`https://soteriafield.app/hot-work/${ID}/?tab=x#top`)).toEqual({
      pathname: '/hot-work/[permitId]',
      params: { permitId: ID },
    })
  })

  it.each([null, undefined, '', '/', '/chat/abc', '/admin/platform/configuration', '/incidents', 'https://', '/hot-work/'])(
    'returns null for %j',
    value => expect(mobileRouteForWebPath(value)).toBeNull(),
  )

  it('does not match a permit path with an extra segment', () => {
    expect(mobileRouteForWebPath(`/hot-work/${ID}/print`)).toBeNull()
  })
})
