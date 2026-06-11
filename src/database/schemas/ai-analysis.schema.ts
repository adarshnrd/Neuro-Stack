import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument, Types } from 'mongoose'

export type AIAnalysisDocument = HydratedDocument<AIAnalysis>

export enum ComplexityLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  VERY_HIGH = 'very-high',
}

@Schema({ _id: false })
export class CodeQualitySignals {
  @Prop({ default: false })
  declare hasTests: boolean

  @Prop({ default: false })
  declare hasDocumentation: boolean

  @Prop({ default: false })
  declare hasRefactoring: boolean

  @Prop({ default: false })
  declare hasBugFix: boolean

  @Prop({ default: false })
  declare isSecurityRelated: boolean
}

const CodeQualitySignalsSchema = SchemaFactory.createForClass(CodeQualitySignals)

@Schema({ timestamps: true })
export class AIAnalysis {
  // One analysis per commit — enforced by unique index
  @Prop({ type: Types.ObjectId, ref: 'Commit', required: true, unique: true })
  declare commitId: Types.ObjectId

  // Set when the analysis is tied to a specific Azure work item
  @Prop({ type: Number, default: null })
  declare workItemId: number | null

  @Prop({ required: true, min: 0 })
  declare estimatedEffortHours: number

  @Prop({ type: Number, default: null })
  declare actualEffortHours: number | null

  // ((actual - estimated) / estimated) * 100; null until actual is known
  @Prop({ type: Number, default: null })
  declare effortDeltaPercent: number | null

  @Prop({ required: true, min: 0, max: 100 })
  declare efficiencyScore: number

  @Prop({ required: true, type: String, enum: ComplexityLevel })
  declare complexityLevel: ComplexityLevel

  @Prop({ type: CodeQualitySignalsSchema, required: true })
  declare codeQualitySignals: CodeQualitySignals

  @Prop({ required: true, maxlength: 300 })
  declare technicalSummary: string

  @Prop({ required: true })
  declare modelUsed: string
}

export const AIAnalysisSchema = SchemaFactory.createForClass(AIAnalysis)
