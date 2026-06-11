import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument, Types } from 'mongoose'

export type RepositoryDocument = HydratedDocument<Repository>

/** A Git repository within a {@link Project} of a connected organization. */
@Schema({ timestamps: true })
export class Repository {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true, index: true })
  declare organizationId: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'Project', required: true, index: true })
  declare projectId: Types.ObjectId

  // Azure repository GUID — globally unique, the key webhooks/diffs reference
  @Prop({ required: true, unique: true })
  declare azureRepoId: string

  // Denormalized Azure project GUID for convenience joins
  @Prop({ required: true })
  declare azureProjectId: string

  @Prop({ required: true })
  declare name: string

  @Prop({ type: String })
  defaultBranch?: string

  @Prop({ type: String })
  webUrl?: string

  @Prop({ type: Date })
  lastSyncedAt?: Date
}

export const RepositorySchema = SchemaFactory.createForClass(Repository)

RepositorySchema.index({ azureRepoId: 1 }, { unique: true })
