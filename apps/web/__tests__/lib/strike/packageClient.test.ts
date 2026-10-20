import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { collectDroppedEntries, loadPackage, type PackageEntry } from '@/lib/strike/packageClient'

const MODULE = {
  slug: 'loto-102-verify', title: 'LOTO 102', media_prefix: 'global/loto-102/v1', estimated_minutes: 3, locale: 'en',
  content: { blocks: [{ key: 's1', kind: 'callout', title: 'Verify', body: 'Try the start button.' }] },
  questions: [{ question_type: 'true_false', prompt: 'Verify before work?', answers: [{ text: 'Yes', correct: true }, { text: 'No', correct: false }] }],
}

function fileList(files: File[]): FileList {
  const list = { length: files.length, item: (i: number) => files[i] ?? null, [Symbol.iterator]: () => files[Symbol.iterator]() }
  return list as unknown as FileList
}

describe('collectDroppedEntries', () => {
  it('expands a zipped seed folder, skipping macOS resource forks and dotfiles', async () => {
    const zip = new JSZip()
    zip.file('loto-102/module.json', JSON.stringify(MODULE))
    zip.file('loto-102/scene-01.jpg', new Uint8Array([1, 2, 3]))
    zip.file('loto-102/.DS_Store', 'x')
    zip.file('__MACOSX/loto-102/._module.json', 'x')
    const blob = await zip.generateAsync({ type: 'blob' })
    const zipFile = new File([blob], 'loto-102.zip')

    const entries = await collectDroppedEntries(null, fileList([zipFile]))
    expect(entries.map(e => e.name).sort()).toEqual(['module.json', 'scene-01.jpg'])
    expect(entries.find(e => e.name === 'scene-01.jpg')!.blob.size).toBe(3)
  })

  it('takes loose files by basename', async () => {
    const entries = await collectDroppedEntries(null, fileList([new File(['{}'], 'module.json'), new File(['x'], 'Thumbs.db')]))
    expect(entries.map(e => e.name)).toEqual(['module.json'])
  })
})

describe('loadPackage', () => {
  it('reads documents and lists media for the plan', async () => {
    const entries: PackageEntry[] = [
      { name: 'module.json', blob: new Blob([JSON.stringify(MODULE)]) },
      { name: 'scene-01.jpg', blob: new Blob([new Uint8Array(5)]) },
    ]
    const loaded = await loadPackage(entries)
    expect(loaded.input.files).toEqual([{ name: 'scene-01.jpg', size: 5 }])
    expect(loaded.read.ok).toBe(true)
    expect(loaded.blobs.has('scene-01.jpg')).toBe(true)
  })

  it('refuses duplicate basenames instead of letting one shadow the other', async () => {
    const entries: PackageEntry[] = [
      { name: 'scene-01.jpg', blob: new Blob(['a']) },
      { name: 'scene-01.jpg', blob: new Blob(['b']) },
    ]
    await expect(loadPackage(entries)).rejects.toThrow(/appears more than once/)
  })

  it('names a document that is not JSON', async () => {
    await expect(loadPackage([{ name: 'module.json', blob: new Blob(['{nope']) }])).rejects.toThrow(/module.json is not valid JSON/)
  })
})
