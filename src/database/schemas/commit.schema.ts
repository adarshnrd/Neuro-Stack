import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

export type CommitDocument = HydratedDocument<Commit>

export enum CommitAnalysisStatus {
  PENDING = 'pending',
  COMPLETE = 'complete',
  FAILED = 'failed',
}

export enum FileChangeType {
  ADD = 'add',
  MODIFY = 'modify',
  DELETE = 'delete',
  RENAME = 'rename',
}

@Schema({ _id: false })
export class CommitFile {
  @Prop({ required: true })
  declare filePath: string

  @Prop({ default: 0 })
  declare linesAdded: number

  @Prop({ default: 0 })
  declare linesRemoved: number

  @Prop({ type: String, enum: FileChangeType })
  declare changeType: FileChangeType

  @Prop({ type: String, default: 'unknown' })
  declare language: string
}

const CommitFileSchema = SchemaFactory.createForClass(CommitFile)

@Schema({ timestamps: true })
export class Commit {
  @Prop({ required: true, unique: true })
  declare azureCommitId: string

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
  declare authorName: string

  @Prop({ required: true })
  declare authorEmail: string

  @Prop({ type: String, default: '' })
  declare branchName: string

  @Prop({ type: String, default: '' })
  declare message: string

  @Prop({ required: true, index: true })
  declare pushedAt: Date

  @Prop({ type: [CommitFileSchema], default: [] })
  declare filesChanged: CommitFile[]

  @Prop({ default: 0 })
  declare totalLinesAdded: number

  @Prop({ default: 0 })
  declare totalLinesRemoved: number

  @Prop({ default: 0 })
  declare totalFilesChanged: number

  @Prop({ type: [String], default: [] })
  declare languagesUsed: string[]

  @Prop({ type: String, default: null })
  declare pullRequestId: string | null

  @Prop({ type: [Number], default: [] })
  declare workItemIds: number[]

  @Prop({
    type: String,
    enum: CommitAnalysisStatus,
    default: CommitAnalysisStatus.PENDING,
  })
  declare analysisStatus: CommitAnalysisStatus
}

export const CommitSchema = SchemaFactory.createForClass(Commit)

CommitSchema.index({ authorAzureId: 1, pushedAt: -1 })
