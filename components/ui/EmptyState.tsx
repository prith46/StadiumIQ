import * as React from "react"
import { Card } from "@/components/ui/card"

interface EmptyStateProps {
  title: string
  description?: string
  icon?: React.ReactNode
}

export function EmptyState({ title, description, icon }: EmptyStateProps) {
  return (
    <Card className="p-8 bg-surface border border-border shadow-card rounded-card flex flex-col items-center justify-center text-center max-w-md mx-auto">
      {icon && <div className="text-text-secondary mb-4">{icon}</div>}
      <h3 className="text-lg font-display font-semibold text-text-primary mb-2">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-text-secondary">
          {description}
        </p>
      )}
    </Card>
  )
}
