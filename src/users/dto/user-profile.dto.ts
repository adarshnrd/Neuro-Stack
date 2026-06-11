import { UserRole } from '../schemas/user.schema'

export class UserProfileDto {
  id!: string
  email!: string
  name!: string
  role!: UserRole
}
