import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument, Types } from 'mongoose'

export type TeamDocument = HydratedDocument<Team>

/**
 * A developer grouping within an organization. Powers team-level drill-down in
 * analytics. May be synced from Azure DevOps teams (`azureTeamId` set) or
 * curated manually in-app (`azureTeamId` absent).
 */
@Schema({ timestamps: true })
export class Team {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true, index: true })
  declare organizationId: Types.ObjectId

  @Prop({ type: String })
  azureTeamId?: string

  @Prop({ type: String })
  azureProjectId?: string

  @Prop({ required: true })
  declare name: string

  // azureDevOpsId values of the developers on this team
  @Prop({ type: [String], default: [] })
  declare memberAzureIds: string[]
}

export const TeamSchema = SchemaFactory.createForClass(Team)

// Unique per (org, azureTeamId) only for Azure-synced teams; manual teams (no
// azureTeamId) are exempt via the partial filter.
TeamSchema.index(
  { organizationId: 1, azureTeamId: 1 },
  { unique: true, partialFilterExpression: { azureTeamId: { $exists: true } } },
)
