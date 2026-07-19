import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

export default function MonthlyAnalyticsLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-8 w-28 rounded-md" />
      </div>

      {/* Daily trends bar chart */}
      <Card>
        <CardHeader className="px-5 pb-2 pt-4">
          <Skeleton className="h-4 w-52" />
          <Skeleton className="mt-1 h-3 w-64" />
        </CardHeader>
        <CardContent className="px-5 pb-5">
          <Skeleton className="h-[360px] w-full rounded-md" />
        </CardContent>
      </Card>

      {/* Commit calendar */}
      <Card>
        <CardHeader className="px-5 pb-2 pt-4">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="mt-1 h-3 w-56" />
        </CardHeader>
        <CardContent className="px-5 pb-5">
          <Skeleton className="h-[160px] w-full rounded-md" />
        </CardContent>
      </Card>

      {/* Monthly summary table */}
      <Card>
        <CardHeader className="px-5 pb-2 pt-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-1 h-3 w-60" />
        </CardHeader>
        <CardContent className="p-0 pb-2">
          <div className="space-y-2 px-5 py-4">
            <Skeleton className="h-10 w-full" />
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
