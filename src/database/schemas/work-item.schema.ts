import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

export type WorkItemDocument = HydratedDocument<WorkItem>

export enum WorkItemType {
  TASK = 'task',
  BUG = 'bug',
  STORY = 'story',
  FEATURE = 'feature',
  EPIC = 'epic',
}

@Schema({ timestamps: true })
export class WorkItem {
  // Azure work item IDs are integers — stored as Number for equality lookups
  @Prop({ required: true, unique: true })
  declare azureWorkItemId: number

  @Prop({ required: true, type: String, enum: WorkItemType })
  declare type: WorkItemType

  @Prop({ required: true })
  declare title: string

  // Plain-text body (System.Description) — used to give the PR effort estimator
  // context about the intended work. Optional; Azure often leaves it empty.
  @Prop({ type: String })
  description?: string

  @Prop({ type: String, index: true })
  assignedToAzureId?: string

  @Prop({ type: Number })
  estimatedHours?: number

  @Prop({ type: Number })
  completedHours?: number

  @Prop({ type: Number })
  remainingHours?: number

  @Prop({ type: Number })
  storyPoints?: number

  @Prop({ required: true, index: true })
  declare state: string

  @Prop({ type: String })
  sprintName?: string

  @Prop({ type: String })
  sprintPath?: string

  @Prop({ required: true })
  declare projectName: string

  @Prop({ type: [Number], default: [] })
  declare linkedPrIds: number[]

  @Prop({ type: Date })
  startedAt?: Date

  @Prop({ type: Date })
  closedAt?: Date

  /** UTC timestamp when the work item was first created in Azure DevOps */
  @Prop({ type: Date })
  createdInAzureAt?: Date

  /** UTC timestamp when a PR was first linked to this work item */
  @Prop({ type: Date })
  prLinkedAt?: Date

  /**
   * Calendar days from activation (startedAt) to close.
   * Populated when the work item reaches a terminal state.
   */
  @Prop({ type: Number })
  cycleTimeDays?: number

  /**
   * Calendar days from creation (createdInAzureAt) to close — full lead time.
   * Populated when the work item reaches a terminal state.
   */
  @Prop({ type: Number })
  leadTimeDays?: number
}

export const WorkItemSchema = SchemaFactory.createForClass(WorkItem)
