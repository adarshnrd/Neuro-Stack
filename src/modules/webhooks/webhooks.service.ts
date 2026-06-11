import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import {
  WebhookEvent,
  WebhookEventDocument,
  WebhookEventStatus,
  WebhookEventType,
} from '@app/database/schemas/webhook-event.schema'
import {
  TriggerLog,
  TriggerLogDocument,
  TriggerProcessingStatus,
} from '@app/database/schemas/trigger-log.schema'
import { EncryptionService } from '@app/shared/encryption/encryption.service'

export interface TriggerLogMeta {
  developerAzureId?: string
  developerName?: string
  repositoryName?: string
  projectName?: string
  ipAddress?: string
  errorDetails?: string
}

// Map from Azure DevOps eventType string to our internal enum
const AZURE_EVENT_MAP: Record<string, WebhookEventType> = {
  'git.push': WebhookEventType.PUSH,
  'git.pullrequest.created': WebhookEventType.PR_CREATED,
  'git.pullrequest.updated': WebhookEventType.PR_UPDATED,
  'git.pullrequest.merged': WebhookEventType.PR_MERGED,
  'git.pullrequest.abandoned': WebhookEventType.PR_ABANDONED,
  'workitem.created': WebhookEventType.WORKITEM_CREATED,
  'workitem.updated': WebhookEventType.WORKITEM_UPDATED,
}

@Injectable()
export class WebhooksService {
  constructor(
    @InjectModel(WebhookEvent.name)
    private readonly webhookModel: Model<WebhookEventDocument>,
    @InjectModel(TriggerLog.name)
    private readonly triggerLogModel: Model<TriggerLogDocument>,
    private readonly encryptionService: EncryptionService,
  ) {}

  async saveRawEvent(
    payload: Record<string, unknown>,
    eventType: WebhookEventType,
    deliveryId: string,
  ): Promise<WebhookEventDocument> {
    const rawPayload = this.encryptionService.encrypt(JSON.stringify(payload))
    const event = new this.webhookModel({
      azureDeliveryId: deliveryId,
      eventType,
      rawPayload,
      status: WebhookEventStatus.PENDING,
    })
    return event.save()
  }

  async isDuplicate(deliveryId: string): Promise<boolean> {
    const exists = await this.webhookModel.exists({ azureDeliveryId: deliveryId }).exec()
    return !!exists
  }

  detectEventType(azureEventType: string): WebhookEventType | null {
    return AZURE_EVENT_MAP[azureEventType] ?? null
  }

  async updateStatus(id: string, status: WebhookEventStatus, errorMessage?: string): Promise<void> {
    const patch: Partial<{
      status: WebhookEventStatus
      errorMessage: string
      processedAt: Date
      retryCount: number
    }> = { status }

    const update: Record<string, unknown> = { $set: patch }

    if (status === WebhookEventStatus.PROCESSED) {
      patch.processedAt = new Date()
      // Clear any back-off marker once the event is done
      update.$unset = { nextRetryAt: 1 }
    }
    if (errorMessage) {
      patch.errorMessage = errorMessage
    }

    await this.webhookModel.findByIdAndUpdate(id, update).exec()
  }

  async incrementRetryCount(id: string): Promise<void> {
    await this.webhookModel.findByIdAndUpdate(id, { $inc: { retryCount: 1 } }).exec()
  }

  /**
   * Park a rate-limited event for later without consuming its retry budget.
   * Returns it to PENDING and schedules the earliest re-attempt past the
   * Azure-provided back-off window, so the retry cron picks it up when capacity
   * is restored. Crucially does NOT increment retryCount — a 429 is not a
   * failure of the event, just temporary unavailability of the API.
   */
  async markRateLimited(id: string, retryAfterMs: number): Promise<void> {
    const nextRetryAt = new Date(Date.now() + Math.max(0, retryAfterMs))
    await this.webhookModel
      .findByIdAndUpdate(id, {
        $set: {
          status: WebhookEventStatus.PENDING,
          nextRetryAt,
          errorMessage: 'Azure API rate limited — deferred',
        },
      })
      .exec()
  }

  async loadAndDecryptPayload(id: string): Promise<{
    event: WebhookEventDocument
    payload: Record<string, unknown>
  }> {
    const event = await this.webhookModel.findById(id).select('+rawPayload').exec()
    if (!event) throw new Error(`WebhookEvent not found: ${id}`)
    const payload = JSON.parse(this.encryptionService.decrypt(event.rawPayload)) as Record<
      string,
      unknown
    >
    return { event, payload }
  }

  async getRecentEvents(limit = 20): Promise<
    Array<{
      id: string
      deliveryId: string
      eventType: string
      status: string
      retryCount: number
      errorMessage?: string
      processedAt?: Date
      createdAt?: Date
    }>
  > {
    const events = await this.webhookModel
      .find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('-rawPayload')
      .lean()
      .exec()

    return events.map((e) => ({
      id: (e._id as Types.ObjectId).toString(),
      deliveryId: e.azureDeliveryId,
      eventType: e.eventType,
      status: e.status,
      retryCount: e.retryCount,
      errorMessage: e.errorMessage,
      processedAt: e.processedAt,
      createdAt: (e as Record<string, unknown>)['createdAt'] as Date | undefined,
    }))
  }

  async saveTriggerLog(
    deliveryId: string,
    azureEventType: string,
    webhookEventId: string | null,
    processingStatus: TriggerProcessingStatus,
    meta: TriggerLogMeta = {},
  ): Promise<TriggerLogDocument> {
    return this.triggerLogModel.create({
      azureDeliveryId: deliveryId,
      eventType: azureEventType,
      webhookEventId: webhookEventId ? new Types.ObjectId(webhookEventId) : undefined,
      processingStatus,
      ...meta,
    })
  }
}
