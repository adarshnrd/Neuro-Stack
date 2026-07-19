import { IsBoolean, IsEnum, IsOptional } from 'class-validator'
import { UserRole } from '@app/common/types/roles.enum'

export class UpdateUserRoleDto {
  @IsEnum(UserRole)
  role!: UserRole
}

export class UpdateUserStatusDto {
  @IsOptional()
  @IsBoolean()
  isActive!: boolean
}
