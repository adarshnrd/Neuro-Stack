import { IsOptional, IsString, IsUrl, MinLength } from 'class-validator'

export class CreateOrganizationDto {
  @IsString()
  @MinLength(1)
  name!: string

  @IsOptional()
  @IsString()
  clientName?: string

  // Azure DevOps organization base URL, e.g. https://dev.azure.com/contoso
  @IsUrl()
  orgUrl!: string

  // Personal Access Token — validated against Azure before being stored encrypted
  @IsString()
  @MinLength(8)
  pat!: string

  // Optional per-org webhook HMAC secret
  @IsOptional()
  @IsString()
  webhookSecret?: string
}
