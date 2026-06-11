import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator'

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  name?: string

  @IsOptional()
  @IsString()
  clientName?: string

  // Supplying a new PAT rotates the credential (re-validated, re-encrypted)
  @IsOptional()
  @IsString()
  @MinLength(8)
  pat?: string

  @IsOptional()
  @IsString()
  webhookSecret?: string

  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}
