import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument, Types } from 'mongoose'

export type TriggerLogDocument = HydratedDocument<TriggerLog>

export enum TriggerProcessingStatus {
  RECEIVED = 'received',
  SAVED = 'saved',
  PROCESSED = 'processed',
  FAILED = 'failed',
}

@Schema({ timestamps: true })
export class TriggerLog {
  // Azure delivery ID for correlation with WebhookEvent
  @Prop({ required: true, index: true })
  declare azureDeliveryId: string

  @Prop({ required: true })
  declare eventType: string

  @Prop({ type: Types.ObjectId, ref: 'WebhookEvent' })
  webhookEventId?: Types.ObjectId

  @Prop({ required: true, type: String, enum: TriggerProcessingStatus })
  declare processingStatus: TriggerProcessingStatus

  @Prop({ type: String })
  developerAzureId?: string

  @Prop({ type: String })
  developerName?: string

  @Prop({ type: String })
  repositoryName?: string

  @Prop({ type: String })
  projectName?: string

  @Prop({ type: String })
  ipAddress?: string

  @Prop({ type: String })
  errorDetails?: string
}

export const TriggerLogSchema = SchemaFactory.createForClass(TriggerLog)

TriggerLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2_592_000 }) // 30-day TTL
