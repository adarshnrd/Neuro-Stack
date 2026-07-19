import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator'

export class UpdatePreferencesDto {
  @IsOptional()
  @IsBoolean()
  emailNotifications?: boolean

  @IsOptional()
  @IsBoolean()
  weeklyDigest?: boolean

  @IsOptional()
  @IsBoolean()
  showEfficiencyScore?: boolean

  @IsOptional()
  @IsString()
  @IsIn(['daily', 'monthly'])
  defaultPeriod?: 'daily' | 'monthly'
}
