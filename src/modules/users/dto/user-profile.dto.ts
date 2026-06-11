import { UserRole } from '@app/common/types/roles.enum'
import type { UserPreferences } from '@app/users/schemas/user.schema'

export class SanitizedUserDto {
  id!: string
  email!: string
  name!: string
  role!: UserRole
  isActive!: boolean
  isWhitelisted!: boolean
  azureDevOpsId?: string
  displayName?: string
  team?: string
  hasAvatar!: boolean
  preferences?: UserPreferences
  lastLoginAt?: Date
  createdAt?: Date
}
