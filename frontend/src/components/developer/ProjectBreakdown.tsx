'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn, formatNumber, scoreBadgeVariant } from '@/lib/utils'
import type { ProjectStats } from '@/types/analytics.types'
import type { CommitRecord, PRStatus } from '@/types/commit.types'

// ── PR badge ──────────────────────────────────────────────────────────────────

const PR_LABELS: Record<PRStatus, string> = {
  active: 'PR Open',
  completed: 'PR Merged',
  abandoned: 'PR Abandoned',
  draft: 'Draft PR',
}

const PR_CLASSES: Record<PRStatus, string> = {
  active: 'border-blue-500 text-blue-500',
  completed: 'border-green-600 text-green-600',
  abandoned: 'border-red-500 text-red-500',
  draft: 'border-muted-foreground text-muted-foreground',
}

// ── Repo row ──────────────────────────────────────────────────────────────────

interface RepoRowProps {
  project: ProjectStats
  commits: CommitRecord[]
}

function RepoRow({ project, commits }: RepoRowProps) {
  const [open, setOpen] = useState(false)
  const Icon = open ? ChevronDown : ChevronRight

  return (
    <div className="border-b border-border last:border-0">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <button
        type="button"
        className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-muted/40"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon size={15} className="shrink-0 text-muted-foreground" />

        {/* Repo name */}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {project.repositoryName}
        </span>

        {/* Stats inline */}
        <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
          {project.commitCount} commit{project.commitCount !== 1 ? 's' : ''}
        </span>
        <span className="whitespace-nowrap text-xs font-medium text-green-600 dark:text-green-400 tabular-nums">
          +{formatNumber(project.totalLinesAdded)}
        </span>
        <span className="whitespace-nowrap text-xs font-medium text-red-600 dark:text-red-400 tabular-nums">
          −{formatNumber(project.totalLinesRemoved)}
        </span>

        {/* Language badges (max 3) */}
        <div className="flex gap-1">
          {project.languagesUsed.slice(0, 3).map((lang) => (
            <Badge key={lang} variant="secondary" className="px-1.5 py-0 text-[10px] h-4">
              {lang}
            </Badge>
          ))}
          {project.languagesUsed.length > 3 && (
            <Badge variant="outline" className="px-1.5 py-0 text-[10px] h-4">
              +{project.languagesUsed.length - 3}
            </Badge>
          )}
        </div>
      </button>

      {/* ── Expanded commits ─────────────────────────────────────────── */}
      {open && (
        <div className="bg-muted/30 px-5 pb-3">
          {commits.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              No commits available for this repository
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-1.5 text-left font-medium w-1/2">Message</th>
                  <th className="py-1.5 text-right font-medium">Time</th>
                  <th className="py-1.5 text-right font-medium">Lines</th>
                  <th className="py-1.5 text-right font-medium">PR</th>
                  <th className="py-1.5 text-right font-medium">Efficiency</th>
                </tr>
              </thead>
              <tbody>
                {commits.map((c) => {
                  const ago = (() => {
                    try {
                      return formatDistanceToNow(parseISO(c.pushedAt), { addSuffix: true })
                    } catch {
                      return '—'
                    }
                  })()
                  const msg = c.message.length > 60 ? `${c.message.slice(0, 60)}…` : c.message
                  return (
                    <tr key={c.id} className="border-b border-border/50 last:border-0">
                      <td className="py-2 pr-3 font-mono text-foreground">{msg}</td>
                      <td className="py-2 text-right text-muted-foreground whitespace-nowrap">
                        {ago}
                      </td>
                      <td className="py-2 text-right whitespace-nowrap">
                        <span className="text-green-600 dark:text-green-400">
                          +{c.totalLinesAdded}
                        </span>{' '}
                        <span className="text-red-600 dark:text-red-400">
                          −{c.totalLinesRemoved}
                        </span>
                      </td>
                      <td className="py-2 text-right">
                        {c.prStatus ? (
                          <span
                            className={cn(
                              'inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium',
                              PR_CLASSES[c.prStatus],
                            )}
                          >
                            {PR_LABELS[c.prStatus]}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">No PR</span>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {c.analysis ? (
                          <Badge
                            variant={scoreBadgeVariant(c.analysis.efficiencyScore)}
                            className="tabular-nums"
                          >
                            {c.analysis.efficiencyScore}%
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ProjectBreakdownProps {
  projects: ProjectStats[]
  commits: CommitRecord[]
  isLoading?: boolean
}

export function ProjectBreakdown({ projects: projectsProp, commits: commitsProp, isLoading }: ProjectBreakdownProps) {
  const projects = Array.isArray(projectsProp) ? projectsProp : []
  const commits = Array.isArray(commitsProp) ? commitsProp : []

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="px-5 pb-2 pt-4">
          <p className="text-sm font-semibold">Project Breakdown</p>
        </CardHeader>
        <CardContent className="p-0">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-12 animate-pulse border-b border-border bg-muted/30 last:border-0"
            />
          ))}
        </CardContent>
      </Card>
    )
  }

  if (projects.length === 0) {
    return (
      <Card>
        <CardHeader className="px-5 pb-2 pt-4">
          <p className="text-sm font-semibold">Project Breakdown</p>
        </CardHeader>
        <CardContent>
          <p className="py-6 text-center text-sm text-muted-foreground">
            No repository activity found
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="px-5 pb-0 pt-4">
        <p className="text-sm font-semibold text-foreground">Project Breakdown</p>
        <p className="text-xs text-muted-foreground">
          {projects.length} repositor{projects.length === 1 ? 'y' : 'ies'} · click to expand commits
        </p>
      </CardHeader>
      <CardContent className="p-0 pt-3">
        {projects.map((p) => {
          const repoCommits = commits.filter((c) => c.repositoryId === p.repositoryId)
          return <RepoRow key={p.repositoryId} project={p} commits={repoCommits} />
        })}
      </CardContent>
    </Card>
  )
}

export default ProjectBreakdown
