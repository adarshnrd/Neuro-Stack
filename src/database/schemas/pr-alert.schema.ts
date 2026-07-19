import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

export type PrAlertDocument = HydratedDocument<PrAlert>

export enum PrAlertType {
  NO_WORK_ITEMS = 'no_work_items',
}

@Schema({ timestamps: true })
export class PrAlert {
  @Prop({ required: true })
  declare azurePrId: string

  @Prop({ type: String, enum: PrAlertType, default: PrAlertType.NO_WORK_ITEMS })
  declare type: PrAlertType

  @Prop({ required: true })
  declare prTitle: string

  @Prop({ required: true })
  declare authorAzureId: string

  @Prop({ required: true })
  declare repositoryName: string

  @Prop({ required: true })
  declare projectName: string

  @Prop({ type: Date, default: null })
  declare resolvedAt: Date | null
}

export const PrAlertSchema = SchemaFactory.createForClass(PrAlert)

PrAlertSchema.index({ azurePrId: 1 }, { unique: true })
