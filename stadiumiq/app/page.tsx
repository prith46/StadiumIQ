import * as React from "react"

export default function HomePage() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <span className="inline-flex items-center gap-2 rounded-pill border border-border bg-surface px-3 py-1 text-xs font-semibold uppercase tracking-widest text-text-secondary shadow-card">
        FIFA World Cup 2026
      </span>
      <h1 className="font-display text-5xl font-extrabold text-text-primary tracking-tight mt-6">
        Stadium Operations Center
      </h1>
      <p className="text-text-secondary mt-4 text-base max-w-md">
        Real-time crowd, safety, and matchday intelligence for every host venue. Switch
        between the Fan and Organizer views in the header, and use the accessibility
        controls to tune contrast, text size, and audio.
      </p>
    </div>
  )
}
