import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

export type DailySummaryDocument = HydratedDocument<DailySummary>

@Schema({ timestamps: true })
export class DailySummary {
  @Prop({ required: true, index: true })
  declare developerAzureId: string

  // YYYY-MM-DD — stored as string to avoid timezone ambiguity
  @Prop({ required: true, index: true })
  declare date: string

  @Prop({ default: 0 })
  declare totalCommits: number

  @Prop({ default: 0 })
  declare totalLinesAdded: number

  @Prop({ default: 0 })
  declare totalLinesRemoved: number

  @Prop({ default: 0 })
  declare totalFilesChanged: number

  @Prop({ type: [String], default: [] })
  declare repositoriesWorkedOn: string[]

  @Prop({ type: Number })
  avgEfficiencyScore?: number

  @Prop({ default: 0 })
  declare totalEstimatedHours: number

  @Prop({ default: 0 })
  declare totalActualHours: number

  @Prop({ default: 0 })
  declare prCreated: number

  @Prop({ default: 0 })
  declare prMerged: number

  @Prop({ default: 0 })
  declare workItemsCompleted: number
}

export const DailySummarySchema = SchemaFactory.createForClass(DailySummary)

DailySummarySchema.index({ developerAzureId: 1, date: 1 }, { unique: true })
