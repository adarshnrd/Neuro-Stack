import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { InjectModel } from '@nestjs/mongoose'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { FilterQuery, Model } from 'mongoose'
import {
  WebhookEvent,
  WebhookEventDocument,
  WebhookEventStatus,
} from '@app/database/schemas/webhook-event.schema'

// Timestamps fields added by Mongoose are not in the TypeScript class —
// extend the filter type so the query compiles without casting.
type WebhookEventFilter = FilterQuery<WebhookEventDocument & { createdAt: Date }>

// Genuine processing failures (not rate-limit deferrals) get this many retries.
const MAX_RETRY_BUDGET = 3

@Injectable()
export class RetryEventsCron {
  private readonly logger = new Logger(RetryEventsCron.name)

  constructor(
    @InjectModel(WebhookEvent.name)
    private readonly webhookEventModel: Model<WebhookEventDocument>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Every 5 minutes: re-queue webhook events that are stuck pending (not
   * processed within 2 minutes of arrival) or that failed but still have
   * retry budget (retryCount < 3).
   *
   * Uses a conditional findOneAndUpdate to claim each event atomically —
   * prevents double-processing if a processor is already mid-flight.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async retryStuckEvents(): Promise<void> {
    const now = new Date()
    const staleCutoff = new Date(now.getTime() - 2 * 60 * 1_000)

    // Eligible to re-queue …
    const eligible = {
      $or: [
        // Pending events that lingered more than 2 minutes (processor crash/skip)
        { status: WebhookEventStatus.PENDING, createdAt: { $lt: staleCutoff } },
        // Rate-limit-deferred events whose back-off window has elapsed
        { status: WebhookEventStatus.PENDING, nextRetryAt: { $lte: now } },
        // Failed events that haven't exhausted the retry budget
        { status: WebhookEventStatus.FAILED, retryCount: { $lt: MAX_RETRY_BUDGET } },
      ],
    }

    // … but never before a scheduled back-off (nextRetryAt) has passed
    const backoffReady = {
      $or: [{ nextRetryAt: { $exists: false } }, { nextRetryAt: { $lte: now } }],
    }

    const candidates = await this.webhookEventModel
      .find({ $and: [eligible, backoffReady] } as WebhookEventFilter)
      .select('_id eventType')
      .lean()
      .exec()

    if (!candidates.length) return

    this.logger.log(`Retrying ${candidates.length} stuck webhook event(s)`)

    for (const candidate of candidates) {
      try {
        // Claim atomically — skip if another worker already transitioned it
        const claimed = await this.webhookEventModel
          .findOneAndUpdate(
            {
              _id: candidate._id,
              status: { $in: [WebhookEventStatus.PENDING, WebhookEventStatus.FAILED] },
            } as WebhookEventFilter,
            { $set: { status: WebhookEventStatus.PROCESSING } },
            { new: false },
          )
          .exec()

        if (!claimed) continue // already claimed by another process

        this.eventEmitter.emit(`webhook.${candidate.eventType as string}`, {
          webhookEventId: String(candidate._id),
        })
      } catch (err) {
        this.logger.error(`Failed to re-queue event ${String(candidate._id)}: ${String(err)}`)
      }
    }
  }
}
