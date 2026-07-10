import * as React from "react"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

interface LoadingStateProps {
  label?: string
}

export function LoadingState({ label = "Loading..." }: LoadingStateProps) {
  return (
    <Card className="p-6 bg-surface border border-border shadow-card rounded-card flex flex-col gap-4">
      <div className="flex items-center space-x-4">
        <Skeleton className="h-12 w-12 rounded-full" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
      <div className="space-y-2 mt-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
      <div className="text-sm text-text-secondary animate-pulse mt-1 text-center">
        {label}
      </div>
    </Card>
  )
}
