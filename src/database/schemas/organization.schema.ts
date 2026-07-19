import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument, Types } from 'mongoose'

export type OrganizationDocument = HydratedDocument<Organization>

/**
 * A connected Azure DevOps organization.
 *
 * In this service-based company each client engagement gets its own Azure
 * DevOps org, so `Organization` is the natural tenant boundary — every Project,
 * Repository, and downstream fact hangs off one. The org's Personal Access
 * Token is stored encrypted at rest (AES-256-GCM via {@link EncryptionService})
 * and is the "org → PAT" credential the admin registers; `patEncrypted` and
 * `webhookSecret` are `select:false` and stripped from JSON so they never leave
 * the service.
 */
@Schema({
  timestamps: true,
  toJSON: {
    transform: (_doc, ret) => {
      const r = ret as Record<string, unknown>
      r['id'] = (r['_id'] as { toString(): string } | undefined)?.toString()
      delete r['_id']
      delete r['__v']
      delete r['patEncrypted']
      delete r['webhookSecret']
      return r
    },
  },
})
export class Organization {
  // Display name for the organization / client engagement
  @Prop({ required: true, trim: true })
  declare name: string

  // Optional client / account label (service-based: org ≈ client)
  @Prop({ type: String, trim: true })
  clientName?: string

  // Azure org slug derived from orgUrl (e.g. "contoso" → https://dev.azure.com/contoso)
  @Prop({ required: true })
  declare azureOrgSlug: string

  // Full Azure DevOps organization base URL
  @Prop({ required: true, unique: true })
  declare orgUrl: string

  // AES-256-GCM encrypted Personal Access Token — never returned by the API
  @Prop({ required: true, select: false })
  declare patEncrypted: string

  // Last 4 chars of the PAT, safe to surface for at-a-glance identification
  @Prop({ type: String })
  patLast4?: string

  // Admin who last registered / rotated the PAT
  @Prop({ type: Types.ObjectId, ref: 'User' })
  patUpdatedByUserId?: Types.ObjectId

  // Per-org webhook HMAC secret — never returned by the API
  @Prop({ type: String, select: false })
  webhookSecret?: string

  @Prop({ default: true })
  declare isActive: boolean

  @Prop({ type: Date })
  lastSyncedAt?: Date
}

export const OrganizationSchema = SchemaFactory.createForClass(Organization)

OrganizationSchema.index({ orgUrl: 1 }, { unique: true })
