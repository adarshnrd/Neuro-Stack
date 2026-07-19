import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

export type PullRequestDocument = HydratedDocument<PullRequest>

export enum PullRequestStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  ABANDONED = 'abandoned',
  DRAFT = 'draft',
}

@Schema({ _id: false })
export class PrReviewer {
  @Prop({ required: true })
  declare azureId: string

  @Prop({ required: true })
  declare displayName: string

  // Azure vote values: -10 rejected, -5 waiting, 0 no vote, 5 approved with suggestions, 10 approved
  @Prop({ default: 0 })
  declare vote: number
}

const PrReviewerSchema = SchemaFactory.createForClass(PrReviewer)

@Schema({ timestamps: true })
export class PullRequest {
  @Prop({ required: true, unique: true })
  declare azurePrId: string

  @Prop({ required: true })
  declare repositoryId: string

  @Prop({ required: true })
  declare repositoryName: string

  @Prop({ required: true })
  declare projectId: string

  @Prop({ required: true })
  declare projectName: string

  @Prop({ required: true, index: true })
  declare authorAzureId: string

  @Prop({ required: true })
  declare title: string

  @Prop({ type: String, default: '' })
  declare description: string

  @Prop({
    type: String,
    enum: PullRequestStatus,
    default: PullRequestStatus.ACTIVE,
    index: true,
  })
  declare status: PullRequestStatus

  @Prop({ required: true })
  declare sourceBranch: string

  @Prop({ required: true })
  declare targetBranch: string

  @Prop({ type: [String], default: [] })
  declare commitIds: string[]

  @Prop({ type: [Number], default: [] })
  declare workItemIds: number[]

  @Prop({ type: [PrReviewerSchema], default: [] })
  declare reviewers: PrReviewer[]

  @Prop({ default: false })
  declare isDraft: boolean

  @Prop({ type: Date })
  completedAt?: Date

  @Prop({ type: Date })
  mergedAt?: Date
}

export const PullRequestSchema = SchemaFactory.createForClass(PullRequest)

PullRequestSchema.index({ status: 1, workItemIds: 1 })
