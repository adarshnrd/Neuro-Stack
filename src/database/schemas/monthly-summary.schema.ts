import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

export type MonthlySummaryDocument = HydratedDocument<MonthlySummary>

@Schema({ timestamps: true })
export class MonthlySummary {
  @Prop({ required: true, index: true })
  declare developerAzureId: string

  // YYYY-MM — stored as string for the same reason as DailySummary.date
  @Prop({ required: true, index: true })
  declare month: string

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

export const MonthlySummarySchema = SchemaFactory.createForClass(MonthlySummary)

MonthlySummarySchema.index({ developerAzureId: 1, month: 1 }, { unique: true })
