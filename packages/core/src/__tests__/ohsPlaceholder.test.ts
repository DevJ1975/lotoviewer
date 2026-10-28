import { describe, it, expect } from 'vitest'
import { NotImplementedError } from '../ohsPlaceholder'

describe('NotImplementedError', () => {
  it('names the capability that is not built yet', () => {
    const error = new NotImplementedError('MOC fan-out for discipline ohs')
    expect(error.message).toBe('MOC fan-out for discipline ohs is not implemented yet')
  })

  it('is a real Error with its own name, so callers can catch it specifically', () => {
    const error = new NotImplementedError('anything')
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(NotImplementedError)
    expect(error.name).toBe('NotImplementedError')
  })
})
