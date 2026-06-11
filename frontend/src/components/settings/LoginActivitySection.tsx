'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, List } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { useDailyLogins, useLoginEvents } from '@/hooks/useLoginAnalytics'

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-4 text-sm font-semibold text-foreground">{children}</h3>
}

/**
 * Admin-only login activity: day-wise summary plus expandable per-login audit list.
 */
export function LoginActivitySection() {
  const [showDetails, setShowDetails] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const { data: summaryRes, isLoading: summaryLoading } = useDailyLogins(true)
  const rows = useMemo(() => summaryRes?.data ?? [], [summaryRes])

  const { data: eventsRes, isLoading: eventsLoading } = useLoginEvents(showDetails)
  const events = useMemo(() => eventsRes?.data ?? [], [eventsRes])

  const filteredEvents = useMemo(() => {
    if (!selectedDate) return events
    return events.filter((e) => e.date === selectedDate)
  }, [events, selectedDate])

  const maxLogins = rows.reduce((m, r) => Math.max(m, r.totalLogins), 0) || 1
  const totalLogins = rows.reduce((s, r) => s + r.totalLogins, 0)

  return (
    <Card>
      <CardContent className="pt-6">
        <SectionTitle>Login Activity</SectionTitle>
        <p className="mb-4 text-sm text-muted-foreground">
          Admin only · {totalLogins} login{totalLogins === 1 ? '' : 's'} over the last{' '}
          {rows.length} day{rows.length === 1 ? '' : 's'}
        </p>

        {summaryLoading ? (
          <Skeleton className="h-[180px] w-full rounded-md" />
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No login activity recorded
          </p>
        ) : (
          <div className="space-y-1.5">
            {rows.map((r) => (
              <button
                key={r.date}
                type="button"
                onClick={() => {
                  setShowDetails(true)
                  setSelectedDate((prev) => (prev === r.date ? null : r.date))
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-1 py-0.5 text-xs transition-colors',
                  selectedDate === r.date && 'bg-primary/10',
                  showDetails && 'hover:bg-muted/60',
                )}
              >
                <span className="w-24 shrink-0 text-left tabular-nums text-muted-foreground">
                  {r.date}
                </span>
                <div className="relative h-5 flex-1 overflow-hidden rounded bg-muted">
                  <div
                    className="h-full rounded bg-primary/70"
                    style={{ width: `${(r.totalLogins / maxLogins) * 100}%` }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right font-medium tabular-nums">
                  {r.totalLogins}
                </span>
                <span className="w-24 shrink-0 text-right tabular-nums text-muted-foreground">
                  {r.uniqueUsers} user{r.uniqueUsers === 1 ? '' : 's'}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setShowDetails((v) => !v)
              if (showDetails) setSelectedDate(null)
            }}
          >
            <List size={13} className="mr-1.5" />
            {showDetails ? 'Hide login details' : 'View login details'}
            {showDetails ? <ChevronUp size={13} className="ml-1.5" /> : <ChevronDown size={13} className="ml-1.5" />}
          </Button>
          {showDetails && selectedDate && (
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setSelectedDate(null)}>
              Clear date filter ({selectedDate})
            </Button>
          )}
        </div>

        {showDetails && (
          <div className="mt-4 rounded-md border border-border">
            {eventsLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full rounded" />
                ))}
              </div>
            ) : filteredEvents.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {selectedDate ? `No logins on ${selectedDate}` : 'No login events in this period'}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead className="text-right">IP address</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEvents.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>
                        <div className="font-medium">{e.name}</div>
                        <div className="text-xs text-muted-foreground">{e.email}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="capitalize text-[10px]">
                          {e.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular-nums text-sm">{e.date}</TableCell>
                      <TableCell className="tabular-nums text-sm text-muted-foreground">
                        {new Date(e.loggedInAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {e.ipAddress ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {showDetails && !eventsLoading && filteredEvents.length > 0 && (
              <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
                Showing {filteredEvents.length} login{filteredEvents.length === 1 ? '' : 's'}
                {selectedDate ? ` on ${selectedDate}` : ' (last 30 days)'}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
