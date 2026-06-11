import { UserProfileDto } from '../../users/dto/user-profile.dto'

export class TokensDto {
  accessToken!: string
  refreshToken!: string
}

export class AuthResponseDto extends TokensDto {
  user!: UserProfileDto
}
