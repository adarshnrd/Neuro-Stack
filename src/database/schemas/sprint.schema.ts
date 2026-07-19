import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument, Types } from 'mongoose'

export type SprintDocument = HydratedDocument<Sprint>

/**
 * An Azure DevOps iteration (sprint) with its date window. Sprint roll-ups bound
 * facts by [startDate, endDate]; this collection provides those boundaries since
 * iteration changes are not reliably webhook-driven (synced/refreshed lazily).
 */
@Schema({ timestamps: true })
export class Sprint {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true, index: true })
  declare organizationId: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'Project', required: true, index: true })
  declare projectId: Types.ObjectId

  @Prop({ type: String })
  azureProjectId?: string

  @Prop({ type: Types.ObjectId, ref: 'Team' })
  teamId?: Types.ObjectId

  @Prop({ required: true })
  declare name: string

  // Full Azure iteration path (e.g. "Project\\Release 1\\Sprint 3")
  @Prop({ required: true })
  declare path: string

  @Prop({ type: Date })
  startDate?: Date

  @Prop({ type: Date })
  endDate?: Date
}

export const SprintSchema = SchemaFactory.createForClass(Sprint)

SprintSchema.index({ organizationId: 1, projectId: 1, path: 1 }, { unique: true })
