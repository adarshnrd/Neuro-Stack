import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

export type WebhookEventDocument = HydratedDocument<WebhookEvent>

export enum WebhookEventType {
  PUSH = 'push',
  PR_CREATED = 'pr.created',
  PR_UPDATED = 'pr.updated',
  PR_MERGED = 'pr.merged',
  PR_ABANDONED = 'pr.abandoned',
  WORKITEM_CREATED = 'workitem.created',
  WORKITEM_UPDATED = 'workitem.updated',
}

export enum WebhookEventStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  PROCESSED = 'processed',
  FAILED = 'failed',
}

@Schema({ timestamps: true })
export class WebhookEvent {
  // Azure-assigned delivery GUID — used for idempotent ingestion
  @Prop({ required: true, unique: true })
  declare azureDeliveryId: string

  @Prop({ required: true, type: String, enum: WebhookEventType })
  declare eventType: WebhookEventType

  // AES-256-GCM encrypted JSON blob — never queried, only decrypted at processing time
  @Prop({ required: true, select: false })
  declare rawPayload: string

  @Prop({
    type: String,
    enum: WebhookEventStatus,
    default: WebhookEventStatus.PENDING,
    index: true,
  })
  declare status: WebhookEventStatus

  @Prop({ default: 0 })
  declare retryCount: number

  @Prop({ type: String })
  errorMessage?: string

  @Prop({ type: Date })
  processedAt?: Date

  // Earliest time this event may be re-attempted. Set when Azure rate-limits a
  // call so the retry cron honours the back-off window instead of hammering the
  // API. Absent/past = eligible immediately.
  @Prop({ type: Date, index: true })
  nextRetryAt?: Date
}

export const WebhookEventSchema = SchemaFactory.createForClass(WebhookEvent)

// createdAt is auto-added by timestamps:true; index it for time-range sweeps
WebhookEventSchema.index({ createdAt: 1 })
