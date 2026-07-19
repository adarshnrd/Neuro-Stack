import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

export type UserDocument = HydratedDocument<User> & { readonly isLocked: boolean }

// Single source of truth lives in common; re-exported here so existing
// imports from this path continue to work without changes.
export { UserRole } from '../../common/types/roles.enum'
import { UserRole } from '../../common/types/roles.enum'

export interface UserPreferences {
  emailNotifications: boolean
  weeklyDigest: boolean
  showEfficiencyScore: boolean
  defaultPeriod: 'daily' | 'monthly'
}

const DEFAULT_PREFERENCES: UserPreferences = {
  emailNotifications: true,
  weeklyDigest: true,
  showEfficiencyScore: true,
  defaultPeriod: 'daily',
}

@Schema({
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (_doc, ret) => {
      const r = ret as Record<string, unknown>
      r['id'] = (r['_id'] as { toString(): string } | undefined)?.toString()
      delete r['_id']
      delete r['__v']
      delete r['passwordHash']
      delete r['refreshTokenHash']
      delete r['avatarData']
      return r
    },
  },
})
export class User {
  @Prop({ required: true, trim: true, lowercase: true })
  declare email: string

  // SHA-256 of lowercase email — used for O(log n) uniqueness lookups
  @Prop({ required: true, unique: true })
  declare emailHash: string

  @Prop({ required: true, select: false })
  declare passwordHash: string

  @Prop({ required: true, trim: true })
  declare name: string

  @Prop({ type: String, enum: UserRole, default: UserRole.MANAGER })
  declare role: UserRole

  @Prop({ default: true })
  declare isActive: boolean

  @Prop({ default: false, index: true })
  declare isWhitelisted: boolean

  @Prop({ type: String, unique: true, sparse: true })
  azureDevOpsId?: string

  @Prop({ type: String })
  displayNameEncrypted?: string

  @Prop({ type: String })
  team?: string

  @Prop({ type: String })
  avatarUrl?: string

  // Binary avatar stored directly in MongoDB (max 2 MB enforced in service)
  @Prop({ type: Buffer, select: false })
  avatarData?: Buffer

  @Prop({ type: String })
  avatarMimeType?: string

  @Prop({
    type: Object,
    default: DEFAULT_PREFERENCES,
  })
  preferences?: UserPreferences

  @Prop({ type: String, select: false, default: null })
  declare refreshTokenHash: string | null

  @Prop({ default: 0 })
  declare loginAttempts: number

  @Prop({ type: Date })
  lockUntil?: Date

  @Prop({ type: Date })
  lastLoginAt?: Date
}

export const UserSchema = SchemaFactory.createForClass(User)

UserSchema.virtual('isLocked').get(function (this: UserDocument): boolean {
  return !!(this.lockUntil && this.lockUntil > new Date())
})
