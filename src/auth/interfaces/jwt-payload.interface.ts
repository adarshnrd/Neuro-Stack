import { UserRole } from '../../users/schemas/user.schema'

export interface JwtPayload {
  sub: string
  email: string
  role: UserRole
  iat?: number
  exp?: number
}
