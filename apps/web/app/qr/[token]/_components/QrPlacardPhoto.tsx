'use client'

import Image from 'next/image'
import { AnnotationLayer } from '@/components/AnnotatedPhoto'
import type { Annotation } from '@/lib/photoAnnotations'

// Mobile-first placard photos for the public QR view. The isolation photo
// leads (it's the safety-critical one) and carries the iso_annotations
// marker overlay; the equipment photo follows as a smaller reference tile.
// Read-only — the overlay uses pointer-events-none and there are no upload
// controls. ISO marker color matches the placard convention (#BF1414).

export default function QrPlacardPhoto({
  isoUrl, equipUrl, isoAnnotations,
}: {
  isoUrl:         string | null
  equipUrl:       string | null
  isoAnnotations: Annotation[]
}) {
  if (!isoUrl && !equipUrl) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-400">
        No placard photos on file for this equipment yet.
      </div>
    )
  }

  return (
    <section className="space-y-3">
      {isoUrl ? (
        <figure className="rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-900">
          <div className="relative aspect-[4/3]">
            <Image
              src={isoUrl}
              alt="Isolation point"
              fill
              sizes="(max-width: 640px) 100vw, 576px"
              className="object-cover"
              priority
            />
            {isoAnnotations.length > 0 && (
              <AnnotationLayer annotations={isoAnnotations} color="#BF1414" />
            )}
          </div>
          <figcaption className="px-3 py-2 text-xs font-semibold text-white bg-black/70">
            Isolation point{isoAnnotations.length > 0 ? ' · markers show isolation devices' : ''}
          </figcaption>
        </figure>
      ) : null}

      {equipUrl ? (
        <figure className="rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-900">
          <div className="relative aspect-[4/3]">
            <Image
              src={equipUrl}
              alt="Equipment"
              fill
              sizes="(max-width: 640px) 100vw, 576px"
              className="object-cover"
            />
          </div>
          <figcaption className="px-3 py-2 text-xs font-semibold text-white bg-black/70">
            Equipment
          </figcaption>
        </figure>
      ) : null}
    </section>
  )
}
