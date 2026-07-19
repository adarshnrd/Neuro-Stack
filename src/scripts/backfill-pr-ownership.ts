/**
 * One-off migration — re-attribute PR ownership to the developer who did the
 * work (the dominant commit author) instead of whoever opened the PR.
 *
 * Historically PullRequest.authorAzureId was set to Azure's `createdBy`. The
 * webhook processor now derives it from the PR's commits; this script applies
 * the same rule to PRs already stored, then rebuilds the affected daily and
 * monthly summaries so prCreated / prMerged / effort move to the right person.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/scripts/backfill-pr-ownership.ts
 *
 * Safe to re-run: PRs already pointing at their dominant commit author are
 * skipped, and the summary rebuild is idempotent.
 */

import 'dotenv/config'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { getModelToken } from '@nestjs/mongoose'
import { Model } from 'mongoose'

import { AppModule } from '../app.module'
import { PullRequest, PullRequestDocument } from '@app/database/schemas/pull-request.schema'
import {
  PrEffortAnalysis,
  PrEffortAnalysisDocument,
} from '@app/database/schemas/pr-effort-analysis.schema'
import { PrAlert, PrAlertDocument } from '@app/database/schemas/pr-alert.schema'
import { CommitsService } from '@app/modules/webhooks/services/commits.service'
import { DailySummaryCron } from '@app/modules/analytics/crons/daily-summary.cron'
import { MonthlySummaryCron } from '@app/modules/analytics/crons/monthly-summary.cron'
import { dayKey } from '@app/shared/helpers/timezone.helper'

async function main(): Promise<void> {
  const logger = new Logger('BackfillPrOwnership')
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  })

  try {
    const prModel = app.get<Model<PullRequestDocument>>(getModelToken(PullRequest.name), {
      strict: false,
    })
    const effortModel = app.get<Model<PrEffortAnalysisDocument>>(
      getModelToken(PrEffortAnalysis.name),
      { strict: false },
    )
    const alertModel = app.get<Model<PrAlertDocument>>(getModelToken(PrAlert.name), {
      strict: false,
    })
    const commitsService = app.get(CommitsService, { strict: false })
    const dailyCron = app.get(DailySummaryCron, { strict: false })
    const monthlyCron = app.get(MonthlySummaryCron, { strict: false })

    const prs = await prModel.find({}).lean().exec()
    logger.log(`Scanning ${prs.length} pull request(s)…`)

    // (developer|date) pairs whose daily summary must be recomputed — both the
    // previous owner (loses the PR) and the new owner (gains it).
    const dirtyPairs = new Set<string>()
    let changed = 0

    for (const pr of prs) {
      const dominant = await commitsService.getDominantAuthor(pr._id.toString())
      if (!dominant || dominant === pr.authorAzureId) continue

      const previousOwner = pr.authorAzureId
      const createdAt = (pr as unknown as { createdAt?: Date }).createdAt
      const dates = [createdAt, pr.mergedAt]
        .filter((d): d is Date => !!d)
        .map((d) => dayKey(new Date(d)))

      for (const date of dates) {
        dirtyPairs.add(`${previousOwner}|${date}`)
        dirtyPairs.add(`${dominant}|${date}`)
      }

      await Promise.all([
        prModel.updateOne({ azurePrId: pr.azurePrId }, { $set: { authorAzureId: dominant } }).exec(),
        effortModel
          .updateOne({ azurePrId: pr.azurePrId }, { $set: { authorAzureId: dominant } })
          .exec(),
        alertModel
          .updateOne({ azurePrId: pr.azurePrId }, { $set: { authorAzureId: dominant } })
          .exec(),
      ])
      logger.log(`PR #${pr.azurePrId} "${pr.title}": ${previousOwner} → ${dominant}`)
      changed++
    }

    if (changed === 0) {
      logger.log('No PRs needed re-attribution. Nothing to rebuild.')
      return
    }

    logger.log(`Re-attributed ${changed} PR(s). Rebuilding ${dirtyPairs.size} daily summary cell(s)…`)
    const months = new Set<string>()
    for (const pair of dirtyPairs) {
      const [dev, date] = pair.split('|')
      await dailyCron.recalculateFor(dev, date)
      months.add(date.slice(0, 7))
    }

    for (const month of [...months].sort()) {
      const res = await monthlyCron.buildForMonth(month)
      logger.log(`  monthly ${month}: ${res.upserted} inserted, ${res.updated} updated`)
    }

    logger.log('Backfill complete.')
  } finally {
    await app.close()
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})
