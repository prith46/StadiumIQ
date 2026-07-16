import * as React from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

interface ErrorStateProps {
  title: string
  description?: string
  onRetry?: () => void
}

export function ErrorState({ title, description, onRetry }: ErrorStateProps) {
  return (
    <Card className="p-8 bg-surface border border-border shadow-card rounded-card flex flex-col items-center justify-center text-center max-w-md mx-auto">
      <div className="text-danger mb-4">
        <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <h3 className="text-lg font-display font-semibold text-text-primary mb-2">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-text-secondary mb-6">
          {description}
        </p>
      )}
      {onRetry && (
        <Button onClick={onRetry} variant="outline" className="border-border hover:bg-surface-hover cursor-pointer">
          Retry
        </Button>
      )}
    </Card>
  )
}
