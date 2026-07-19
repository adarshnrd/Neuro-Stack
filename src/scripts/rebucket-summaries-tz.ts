/**
 * One-off migration — re-bucket daily/monthly summaries into the reporting
 * timezone (IST by default) after switching bucketing away from UTC.
 *
 * Existing summaries were keyed by UTC calendar day; an instant like
 * 2026-06-10T21:57Z belongs to UTC June 10 but IST June 11. This recomputes
 * every (developer, day) cell that any raw commit / PR / work item maps to
 * under the new timezone rules, and also re-runs every pre-existing summary day
 * so now-empty UTC buckets are deleted.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/scripts/rebucket-summaries-tz.ts
 *
 * Safe to re-run (recalculateFor + buildForMonth are idempotent).
 */

import 'dotenv/config'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { getModelToken } from '@nestjs/mongoose'
import { Model } from 'mongoose'

import { AppModule } from '../app.module'
import { Commit, CommitDocument } from '@app/database/schemas/commit.schema'
import { PullRequest, PullRequestDocument } from '@app/database/schemas/pull-request.schema'
import { WorkItem, WorkItemDocument } from '@app/database/schemas/work-item.schema'
import { DailySummary, DailySummaryDocument } from '@app/database/schemas/daily-summary.schema'
import { DailySummaryCron } from '@app/modules/analytics/crons/daily-summary.cron'
import { MonthlySummaryCron } from '@app/modules/analytics/crons/monthly-summary.cron'
import { dayKey } from '@app/shared/helpers/timezone.helper'

async function main(): Promise<void> {
  const logger = new Logger('RebucketSummariesTz')
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] })

  try {
    const commitModel = app.get<Model<CommitDocument>>(getModelToken(Commit.name), { strict: false })
    const prModel = app.get<Model<PullRequestDocument>>(getModelToken(PullRequest.name), { strict: false })
    const wiModel = app.get<Model<WorkItemDocument>>(getModelToken(WorkItem.name), { strict: false })
    const dailyModel = app.get<Model<DailySummaryDocument>>(getModelToken(DailySummary.name), { strict: false })
    const dailyCron = app.get(DailySummaryCron, { strict: false })
    const monthlyCron = app.get(MonthlySummaryCron, { strict: false })

    const pairs = new Set<string>() // developerAzureId|YYYY-MM-DD (reporting tz)

    for (const c of await commitModel.find({}, { authorAzureId: 1, pushedAt: 1 }).lean()) {
      if (c.authorAzureId && c.pushedAt) pairs.add(`${c.authorAzureId}|${dayKey(new Date(c.pushedAt))}`)
    }
    for (const pr of await prModel.find({}, { authorAzureId: 1, createdAt: 1, mergedAt: 1 }).lean()) {
      const created = (pr as unknown as { createdAt?: Date }).createdAt
      if (pr.authorAzureId && created) pairs.add(`${pr.authorAzureId}|${dayKey(new Date(created))}`)
      if (pr.authorAzureId && pr.mergedAt) pairs.add(`${pr.authorAzureId}|${dayKey(new Date(pr.mergedAt))}`)
    }
    for (const wi of await wiModel.find({ closedAt: { $ne: null } }, { assignedToAzureId: 1, closedAt: 1 }).lean()) {
      if (wi.assignedToAzureId && wi.closedAt) {
        pairs.add(`${wi.assignedToAzureId}|${dayKey(new Date(wi.closedAt))}`)
      }
    }
    // Existing summary days — re-run them so stale UTC buckets that no longer
    // hold any activity get deleted by recalculateFor.
    for (const d of await dailyModel.find({}, { developerAzureId: 1, date: 1 }).lean()) {
      pairs.add(`${d.developerAzureId}|${d.date}`)
    }

    logger.log(`Recomputing ${pairs.size} (developer, day) cell(s) in reporting timezone…`)
    const months = new Set<string>()
    for (const pair of pairs) {
      const [dev, date] = pair.split('|')
      await dailyCron.recalculateFor(dev, date)
      months.add(date.slice(0, 7))
    }
    for (const month of [...months].sort()) {
      const res = await monthlyCron.buildForMonth(month)
      logger.log(`  monthly ${month}: ${res.upserted} inserted, ${res.updated} updated`)
    }

    logger.log('Re-bucket complete.')
  } finally {
    await app.close()
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})
