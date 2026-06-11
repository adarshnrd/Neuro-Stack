import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { InjectConnection, InjectModel } from '@nestjs/mongoose'
import { Connection, Model } from 'mongoose'
import {
  TriggerLog,
  TriggerLogDocument,
  TriggerProcessingStatus,
} from '@app/database/schemas/trigger-log.schema'

// Name of the raw MongoDB collection used for archiving.
// Not a Mongoose model — written directly via the MongoDB driver.
const ARCHIVE_COLLECTION = 'trigger_log_archive'

// Days before the 30-day TTL at which we copy failed logs.
const ARCHIVE_BEFORE_DAYS = 25

@Injectable()
export class RotateLogsCron {
  private readonly logger = new Logger(RotateLogsCron.name)

  constructor(
    @InjectModel(TriggerLog.name)
    private readonly triggerLogModel: Model<TriggerLogDocument>,
    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  /**
   * 02:00 UTC on the 1st of each month.
   *
   * The TTL index on trigger_logs removes documents older than 30 days.
   * This cron copies failed logs that are >= 25 days old to a separate
   * archive collection BEFORE TTL can delete them, preserving them for
   * post-mortems.
   *
   * The archive collection has no TTL — manual or policy-based retention applies.
   */
  @Cron('0 2 1 * *')
  async archiveFailedLogs(): Promise<void> {
    const cutoff = new Date(Date.now() - ARCHIVE_BEFORE_DAYS * 24 * 60 * 60 * 1_000)

    this.logger.log(
      `Archiving failed trigger logs older than ${ARCHIVE_BEFORE_DAYS} days (cutoff: ${cutoff.toISOString()})`,
    )

    let failedLogs: TriggerLogDocument[]
    try {
      failedLogs = (await this.triggerLogModel
        .find({
          processingStatus: TriggerProcessingStatus.FAILED,
          createdAt: { $lt: cutoff },
        })
        .lean()
        .exec()) as unknown as TriggerLogDocument[]
    } catch (err) {
      this.logger.error(
        'Failed to query trigger logs for archiving',
        err instanceof Error ? err.stack : String(err),
      )
      return
    }

    if (!failedLogs.length) {
      this.logger.log('No failed trigger logs to archive')
      return
    }

    const archiveCollection = this.connection.db!.collection(ARCHIVE_COLLECTION)

    // Stamp each document with the archive timestamp
    const archiveDocs = failedLogs.map((log) => ({
      ...(log as object),
      archivedAt: new Date(),
    }))

    try {
      // ordered:false lets the batch complete even if some _ids are duplicates
      // (e.g. the cron ran twice in the same window)
      const insertResult = await archiveCollection.insertMany(archiveDocs, {
        ordered: false,
      })
      this.logger.log(
        `Archived ${insertResult.insertedCount} failed trigger log(s) ` +
          `to '${ARCHIVE_COLLECTION}'`,
      )
    } catch (err: unknown) {
      // BulkWriteError with code 11000 means some duplicates — not fatal
      const isDuplicateKeyError =
        err instanceof Error && 'code' in err && (err as Error & { code: number }).code === 11_000

      if (isDuplicateKeyError) {
        this.logger.warn(
          'Some trigger logs were already archived (duplicate key) — skipping duplicates',
        )
      } else {
        this.logger.error(
          'Failed to insert trigger logs into archive',
          err instanceof Error ? (err as Error).stack : String(err),
        )
      }
    }
  }
}
