import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

// The CSV import sends one row at a time. A row whose aspect was created but
// whose score was refused is in the register; reporting it as failed would
// invite importing it a second time.

const api = vi.hoisted(() => ({ createAspect: vi.fn(), scoreAspect: vi.fn() }))

vi.mock('@/lib/environmental/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/environmental/client')>()),
  ...api,
}))

import { AspectImport } from '@/app/environmental/aspects/_components/AspectImport'

const CSV = 'activity,aspect,impact,process_area,operating_condition,severity,likelihood,rationale\n'
  + 'Paint mixing,Solvent spill,Soil contamination,Finishing,normal,2,2,Drums on containment\n'

function chooseCsv(text: string): void {
  fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [new File([text], 'aspects.csv', { type: 'text/csv' })] } })
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  api.createAspect.mockResolvedValue({ aspect: { id: 'new-aspect' } })
})

describe('AspectImport', () => {
  it('counts an aspect whose score was refused as imported, and says only the score is missing', async () => {
    api.scoreAspect.mockRejectedValue(new Error('severity must be at most 5'))
    const onImported = vi.fn()
    render(<AspectImport tenantId="t1" onImported={onImported} onClose={vi.fn()} />)
    chooseCsv(CSV)
    fireEvent.click(await screen.findByRole('button', { name: 'Import 1 rows' }))
    await waitFor(() => expect(onImported).toHaveBeenCalled())

    expect(screen.getByText('1 imported, 1 without their score')).toBeInTheDocument()
    expect(screen.getByText(/imported without its score: severity must be at most 5/)).toBeInTheDocument()
    expect(screen.getByText(/import a file with only those rows/)).toBeInTheDocument()
  })
})
