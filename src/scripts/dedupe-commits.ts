/**
 * One-off migration — remove duplicate commit documents and enforce uniqueness.
 *
 * The Commit schema declares `azureCommitId` unique, but the index was never
 * built because duplicates already existed (two ingestion paths racing past
 * each other's existence check). This script keeps the earliest doc per
 * azureCommitId, deletes the rest, builds the unique index so duplicates can
 * never recur, then rebuilds the affected daily + monthly summaries.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/scripts/dedupe-commits.ts
 *
 * Safe to re-run.
 */

import 'dotenv/config'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { getModelToken } from '@nestjs/mongoose'
import { Model } from 'mongoose'

import { AppModule } from '../app.module'
import { Commit, CommitDocument } from '@app/database/schemas/commit.schema'
import { DailySummaryCron } from '@app/modules/analytics/crons/daily-summary.cron'
import { MonthlySummaryCron } from '@app/modules/analytics/crons/monthly-summary.cron'
import { dayKey } from '@app/shared/helpers/timezone.helper'

async function main(): Promise<void> {
  const logger = new Logger('DedupeCommits')
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  })

  try {
    const commitModel = app.get<Model<CommitDocument>>(getModelToken(Commit.name), {
      strict: false,
    })
    const dailyCron = app.get(DailySummaryCron, { strict: false })
    const monthlyCron = app.get(MonthlySummaryCron, { strict: false })

    // ── 1. Find azureCommitIds with more than one document ───────────────────
    const dupes = await commitModel.aggregate<{ _id: string; count: number }>([
      { $group: { _id: '$azureCommitId', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ])
    logger.log(`Found ${dupes.length} duplicated commit id(s).`)

    const dirtyPairs = new Set<string>() // developerAzureId|date
    let deleted = 0

    for (const { _id: azureCommitId } of dupes) {
      const docs = await commitModel
        .find({ azureCommitId })
        .sort({ createdAt: 1, _id: 1 })
        .lean()
        .exec()

      const [keeper, ...rest] = docs
      // Preserve a PR link if the keeper lacks one but a duplicate has it.
      if (!keeper.pullRequestId) {
        const linked = rest.find((d) => d.pullRequestId)
        if (linked) {
          await commitModel
            .updateOne({ _id: keeper._id }, { $set: { pullRequestId: linked.pullRequestId } })
            .exec()
        }
      }

      for (const d of rest) {
        if (d.authorAzureId && d.pushedAt) {
          dirtyPairs.add(`${d.authorAzureId}|${dayKey(new Date(d.pushedAt))}`)
        }
        await commitModel.deleteOne({ _id: d._id }).exec()
        deleted++
      }
    }
    logger.log(`Deleted ${deleted} duplicate commit document(s).`)

    // ── 2. Build the unique index so duplicates can never recur ──────────────
    await commitModel.collection.createIndex({ azureCommitId: 1 }, { unique: true })
    logger.log('Ensured unique index on azureCommitId.')

    // ── 3. Rebuild affected daily + monthly summaries ────────────────────────
    if (dirtyPairs.size > 0) {
      logger.log(`Recomputing ${dirtyPairs.size} daily summary cell(s)…`)
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
    }

    logger.log('Dedupe complete.')
  } finally {
    await app.close()
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})
