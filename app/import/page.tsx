'use client'

import { useState, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table'
import { Progress } from '@/components/ui/progress'
import {
  parseCsv, buildHeaderMap, processRows, decodeFile, toInsertRow,
  type ParsedRow,
} from '@/lib/csvImport'

type Step = 'upload' | 'preview' | 'result'

const BATCH_SIZE = 100

export default function ImportPage() {
  const [step, setStep]                     = useState<Step>('upload')
  const [rows, setRows]                     = useState<ParsedRow[]>([])
  const [fileName, setFileName]             = useState('')
  const [parseError, setParseError]         = useState<string | null>(null)
  const [importing, setImporting]           = useState(false)
  const [importProgress, setImportProgress] = useState(0)
  const [importError, setImportError]       = useState<string | null>(null)
  const [result, setResult]                 = useState<{ inserted: number; skipped: number } | null>(null)
  const [dragOver, setDragOver]             = useState(false)
  const [loadingFile, setLoadingFile]       = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const counts = useMemo(() => ({
    new:      rows.filter(r => r.status === 'new').length,
    existing: rows.filter(r => r.status === 'existing').length,
    invalid:  rows.filter(r => r.status === 'invalid').length,
  }), [rows])

  const handleFile = useCallback(async (file: File) => {
    setParseError(null)
    setFileName(file.name)
    setLoadingFile(true)

    try {
      const text = await decodeFile(file)
      const allRows = parseCsv(text)

      if (allRows.length === 0) {
        setParseError('The file is empty.')
        return
      }

      const headerMap = buildHeaderMap(allRows[0])
      if ('error' in headerMap) {
        setParseError(headerMap.error)
        return
      }

      const dataRows = allRows.slice(1)
      if (dataRows.length === 0) {
        setParseError('No data rows found — only a header.')
        return
      }

      const { data, error } = await supabase
        .from('loto_equipment')
        .select('equipment_id')

      if (error) {
        setParseError(`Could not load existing equipment: ${error.message}`)
        return
      }

      const existingIds = new Set<string>((data ?? []).map(d => d.equipment_id as string))
      setRows(processRows(dataRows, headerMap, existingIds))
      setStep('preview')
    } catch (e) {
      setParseError(`Could not read file: ${(e as Error).message}`)
    } finally {
      setLoadingFile(false)
    }
  }, [])

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const reset = () => {
    setStep('upload')
    setRows([])
    setFileName('')
    setParseError(null)
    setImportError(null)
    setResult(null)
    setImportProgress(0)
  }

  const doImport = async () => {
    setImporting(true)
    setImportError(null)
    setImportProgress(0)

    const newRows = rows.filter(r => r.status === 'new').map(toInsertRow)
    const total   = newRows.length
    let inserted  = 0

    for (let i = 0; i < total; i += BATCH_SIZE) {
      const batch = newRows.slice(i, i + BATCH_SIZE)
      const { error } = await supabase.from('loto_equipment').insert(batch)
      if (error) {
        setImportError(`Supabase error: ${error.message}. Imported ${inserted} of ${total} before failure.`)
        setImporting(false)
        return
      }
      inserted += batch.length
      setImportProgress(inserted / total)
    }

    setImporting(false)
    setResult({ inserted, skipped: counts.existing })
    setStep('result')
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Bulk Equipment Import</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Upload a CSV to add new equipment records. Existing IDs are skipped automatically.
        </p>
      </header>

      <StepIndicator current={step} />

      {step === 'upload' && (
        <UploadStep
          loading={loadingFile}
          dragOver={dragOver}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onChoose={() => inputRef.current?.click()}
          parseError={parseError}
        />
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".csv,.txt,text/csv,text/plain"
        onChange={onFileInput}
        className="hidden"
      />

      {step === 'preview' && (
        <PreviewStep
          fileName={fileName}
          counts={counts}
          rows={rows}
          importing={importing}
          importProgress={importProgress}
          importError={importError}
          onCancel={reset}
          onImport={doImport}
        />
      )}

      {step === 'result' && result && (
        <ResultStep
          inserted={result.inserted}
          skipped={result.skipped}
          onImportMore={reset}
        />
      )}
    </div>
  )
}

function StepIndicator({ current }: { current: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: 'upload',  label: '1. Upload'  },
    { key: 'preview', label: '2. Preview' },
    { key: 'result',  label: '3. Result'  },
  ]
  const currentIndex = steps.findIndex(s => s.key === current)
  return (
    <div className="flex items-center gap-3 text-sm">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-3">
          <span className={i <= currentIndex ? 'text-primary font-medium' : 'text-muted-foreground'}>
            {s.label}
          </span>
          {i < steps.length - 1 && <span className="text-muted-foreground">→</span>}
        </div>
      ))}
    </div>
  )
}

interface UploadStepProps {
  loading:     boolean
  dragOver:    boolean
  onDragOver:  (e: React.DragEvent<HTMLDivElement>) => void
  onDragLeave: () => void
  onDrop:      (e: React.DragEvent<HTMLDivElement>) => void
  onChoose:    () => void
  parseError:  string | null
}

function UploadStep({ loading, dragOver, onDragOver, onDragLeave, onDrop, onChoose, parseError }: UploadStepProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose a CSV file</CardTitle>
        <CardDescription>
          Required columns: <CodeTag>equipment_id</CodeTag>, <CodeTag>description</CodeTag>, <CodeTag>department</CodeTag>.
          Optional: <CodeTag>prefix</CodeTag>, <CodeTag>needs_equip_photo</CodeTag>, <CodeTag>needs_iso_photo</CodeTag>, <CodeTag>notes</CodeTag>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={cn(
            'border-2 border-dashed rounded-xl p-10 text-center transition-colors',
            dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 bg-muted/30',
          )}
        >
          <Upload className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground mb-1">Drag and drop a CSV file here</p>
          <p className="text-xs text-muted-foreground mb-4">Or click to choose a file. Accepts .csv and .txt</p>
          <Button onClick={onChoose} disabled={loading}>
            <FileSpreadsheet /> {loading ? 'Reading…' : 'Choose file'}
          </Button>
        </div>

        {parseError && <ErrorBanner message={parseError} />}
      </CardContent>
    </Card>
  )
}

interface PreviewStepProps {
  fileName:       string
  counts:         { new: number; existing: number; invalid: number }
  rows:           ParsedRow[]
  importing:      boolean
  importProgress: number
  importError:    string | null
  onCancel:       () => void
  onImport:       () => void
}

function PreviewStep({
  fileName, counts, rows, importing, importProgress, importError, onCancel, onImport,
}: PreviewStepProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4" /> {fileName}
          </CardTitle>
          <CardDescription>
            {rows.length} row{rows.length === 1 ? '' : 's'} parsed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-emerald-500 text-white border-transparent">{counts.new} new</Badge>
            <Badge variant="secondary">{counts.existing} existing (skipped)</Badge>
            <Badge variant="destructive">{counts.invalid} invalid</Badge>
          </div>

          {importing && (
            <div className="mt-4">
              <Progress value={importProgress * 100} />
              <p className="text-xs text-muted-foreground mt-2">
                Importing… {Math.round(importProgress * 100)}%
              </p>
            </div>
          )}

          {importError && <ErrorBanner message={importError} />}

          <div className="mt-5 flex items-center gap-2">
            <Button variant="outline" onClick={onCancel} disabled={importing}>Start over</Button>
            <Button onClick={onImport} disabled={importing || counts.new === 0}>
              {importing ? 'Importing…' : `Import ${counts.new} ${counts.new === 1 ? 'row' : 'rows'}`}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardContent className="p-0">
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead className="w-24">Status</TableHead>
                  <TableHead>Equipment ID</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead className="text-center">Equip</TableHead>
                  <TableHead className="text-center">ISO</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow
                    key={i}
                    className={cn(
                      r.status === 'invalid'  && 'bg-destructive/5',
                      r.status === 'existing' && 'opacity-60',
                    )}
                  >
                    <TableCell>
                      {r.status === 'new'      && <Badge className="bg-emerald-500 text-white border-transparent">New</Badge>}
                      {r.status === 'existing' && <Badge variant="secondary">Existing</Badge>}
                      {r.status === 'invalid'  && <Badge variant="destructive">Invalid</Badge>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.equipmentId || '—'}</TableCell>
                    <TableCell className="whitespace-normal">
                      {r.description || '—'}
                      {r.error && <div className="text-xs text-destructive mt-0.5">{r.error}</div>}
                    </TableCell>
                    <TableCell>{r.department || '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{r.prefix || '—'}</TableCell>
                    <TableCell className="text-center">{r.needsEquipPhoto ? 'Y' : 'N'}</TableCell>
                    <TableCell className="text-center">{r.needsIsoPhoto ? 'Y' : 'N'}</TableCell>
                    <TableCell className="max-w-xs whitespace-normal text-muted-foreground">
                      {r.notes ?? ''}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function ResultStep({
  inserted, skipped, onImportMore,
}: {
  inserted:     number
  skipped:      number
  onImportMore: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-5 w-5" /> Import complete
        </CardTitle>
        <CardDescription>
          Imported {inserted} new item{inserted === 1 ? '' : 's'}, skipped {skipped} existing.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onImportMore}>
          <RefreshCw /> Import more
        </Button>
        <Link href="/departments" className={cn(buttonVariants())}>
          View equipment list
        </Link>
      </CardContent>
    </Card>
  )
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

function CodeTag({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{children}</code>
}
