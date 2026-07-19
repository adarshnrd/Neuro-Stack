import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-7 w-7 rounded-md" />
              </div>
              <Skeleton className="mt-3 h-8 w-20" />
              <Skeleton className="mt-2 h-3 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Team chart */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-5">
          <Skeleton className="h-4 w-52" />
          <Skeleton className="mt-1 h-3 w-64" />
        </CardHeader>
        <CardContent className="px-5 pb-5">
          <Skeleton className="h-[320px] w-full rounded-md" />
        </CardContent>
      </Card>

      {/* Bottom row */}
      <div className="grid grid-cols-5 gap-4">
        <div className="col-span-3">
          <Skeleton className="mb-3 h-5 w-36" />
          <Card>
            <CardContent className="px-4 py-3 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3 py-1">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="col-span-2 space-y-4">
          <Card>
            <CardHeader className="px-4 pb-2 pt-4">
              <Skeleton className="h-4 w-32" />
            </CardHeader>
            <CardContent className="space-y-3 px-4 pb-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Skeleton className="h-5 w-4 shrink-0" />
                  <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-1.5 w-full rounded-full" />
                  </div>
                  <Skeleton className="h-5 w-12 shrink-0 rounded-full" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
