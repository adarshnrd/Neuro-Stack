import { SanitizedUserDto } from '@app/modules/users/dto/user-profile.dto'

export class TokensDto {
  accessToken!: string
  refreshToken!: string
}

export class AuthResponseDto extends TokensDto {
  user!: SanitizedUserDto
}
