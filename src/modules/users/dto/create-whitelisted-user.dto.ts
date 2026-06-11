import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator'
import { UserRole } from '@app/common/types/roles.enum'

export class CreateWhitelistedUserDto {
  @IsEmail()
  email!: string

  @IsString()
  @MinLength(8)
  tempPassword!: string

  @IsEnum(UserRole)
  role!: UserRole

  @IsOptional()
  @IsString()
  team?: string

  @IsOptional()
  @IsString()
  displayName?: string
}
