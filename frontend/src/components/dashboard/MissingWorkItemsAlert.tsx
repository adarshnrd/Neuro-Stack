'use client'

import { AlertTriangle, ExternalLink } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import type { PrAlert } from '@/types/analytics.types'

// Build an Azure DevOps deep-link if the org name is configured.
function buildPrUrl(pr: PrAlert): string {
  const org = process.env.NEXT_PUBLIC_AZURE_ORG
  if (!org) return '#'
  return `https://dev.azure.com/${org}/${pr.projectName}/_git/${pr.repositoryName}/pullrequest/${pr.azurePrId}`
}

interface MissingWorkItemsAlertProps {
  count: number
  prs?: PrAlert[]
  isLoading?: boolean
}

export function MissingWorkItemsAlert({ count, prs, isLoading }: MissingWorkItemsAlertProps) {
  if (!isLoading && count === 0) return null

  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>
        {count} PR{count !== 1 ? 's' : ''} missing work item links
      </AlertTitle>
      <AlertDescription>
        {isLoading || !prs ? (
          <p className="mt-1 text-xs">Loading PR details…</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {prs.slice(0, 5).map((pr) => (
              <li key={pr.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-xs">
                  <span className="font-medium">{pr.authorName ?? pr.authorAzureId}</span>
                  <span className="opacity-75"> — {pr.title}</span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 shrink-0 px-2 text-[10px]"
                  asChild
                >
                  <a href={buildPrUrl(pr)} target="_blank" rel="noopener noreferrer">
                    <ExternalLink size={9} className="mr-1" />
                    Link items
                  </a>
                </Button>
              </li>
            ))}
            {prs.length > 5 && (
              <li className="text-xs opacity-75">
                +{prs.length - 5} more PRs need work item links
              </li>
            )}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  )
}
