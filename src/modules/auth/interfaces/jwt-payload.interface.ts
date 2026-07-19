import { UserRole } from '@app/common/types/roles.enum'

export interface JwtPayload {
  sub: string // user._id as string
  azureId?: string // user.azureDevOpsId
  role: UserRole
  iat?: number
  exp?: number
}
