import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

export default function DeveloperDetailLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1.5">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-4 w-36" />
        </div>
        <Skeleton className="h-8 w-36 rounded-md" />
      </div>

      {/* Developer card */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-4">
            <Skeleton className="h-14 w-14 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
            <Skeleton className="h-8 w-36 rounded-md" />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[52px] w-[72px] rounded-md" />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-7 w-7 rounded-md" />
              </div>
              <Skeleton className="mt-3 h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="px-5 pb-0 pt-4">
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardContent className="px-5 pb-4">
            <Skeleton className="h-[220px] w-full rounded-md" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="px-5 pb-0 pt-4">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-1 h-3 w-44" />
          </CardHeader>
          <CardContent className="px-5 pb-4">
            <Skeleton className="h-[240px] w-full rounded-md" />
          </CardContent>
        </Card>
      </div>

      {/* Project breakdown */}
      <Card>
        <CardHeader className="px-5 pb-2 pt-4">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-1 h-3 w-48" />
        </CardHeader>
        <CardContent className="p-0 pt-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 border-b border-border animate-pulse bg-muted/30 last:border-0" />
          ))}
        </CardContent>
      </Card>

      {/* Commit timeline */}
      <Card>
        <CardHeader className="px-5 pb-0 pt-4">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-1 h-3 w-40" />
        </CardHeader>
        <CardContent className="p-0 pt-3">
          <div className="space-y-2 px-5 py-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Time analysis */}
      <Card>
        <CardHeader className="px-5 pb-0 pt-4">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-1 h-3 w-52" />
        </CardHeader>
        <CardContent className="p-0 pb-2 pt-3">
          <div className="space-y-2 px-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
