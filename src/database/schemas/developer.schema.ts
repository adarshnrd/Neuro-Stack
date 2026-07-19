import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

export type DeveloperDocument = HydratedDocument<Developer>

/**
 * An Azure DevOps contributor whose activity is tracked for analytics.
 *
 * Developers are NOT portal users — they never authenticate. This collection
 * is the single source of truth for the azureDevOpsId → displayName/email/team
 * mapping that analytics enrichment relies on, kept fully separate from the
 * `users` collection (which holds only Admins and Managers).
 */
@Schema({
  timestamps: true,
  toJSON: {
    transform: (_doc, ret) => {
      const r = ret as Record<string, unknown>
      r['id'] = (r['_id'] as { toString(): string } | undefined)?.toString()
      delete r['_id']
      delete r['__v']
      delete r['displayNameEncrypted']
      return r
    },
  },
})
export class Developer {
  @Prop({ required: true, unique: true, index: true })
  declare azureDevOpsId: string

  // Optional: PR / work-item identities arrive with a real Azure GUID but no
  // email. Commit authors still provide one. Dedupe is keyed on azureDevOpsId.
  @Prop({ trim: true, lowercase: true })
  email?: string

  // SHA-256 of lowercase email — O(log n) lookups when resolving commit authors.
  // Sparse so multiple email-less (GUID-only) developers don't collide on null.
  @Prop({ type: String, unique: true, sparse: true })
  emailHash?: string

  @Prop({ required: true, trim: true })
  declare displayName: string

  // AES-256-GCM encrypted display name (parity with User.displayNameEncrypted)
  @Prop({ type: String })
  displayNameEncrypted?: string

  @Prop({ type: String })
  team?: string

  @Prop({ default: true })
  declare isActive: boolean

  @Prop({ type: Date })
  lastSyncedAt?: Date
}

export const DeveloperSchema = SchemaFactory.createForClass(Developer)
