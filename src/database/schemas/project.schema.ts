import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument, Types } from 'mongoose'

export type ProjectDocument = HydratedDocument<Project>

/** An Azure DevOps project within a connected {@link Organization}. */
@Schema({ timestamps: true })
export class Project {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true, index: true })
  declare organizationId: Types.ObjectId

  @Prop({ required: true })
  declare azureProjectId: string

  @Prop({ required: true })
  declare name: string

  @Prop({ type: String })
  description?: string

  @Prop({ type: Date })
  lastSyncedAt?: Date
}

export const ProjectSchema = SchemaFactory.createForClass(Project)

ProjectSchema.index({ organizationId: 1, azureProjectId: 1 }, { unique: true })
