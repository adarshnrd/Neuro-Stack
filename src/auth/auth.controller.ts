import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common'
import { AuthService } from './auth.service'
import { LoginDto } from './dto/login.dto'
import { RegisterDto } from './dto/register.dto'
import { AuthResponseDto, TokensDto } from './dto/auth-response.dto'
import { Public } from './decorators/public.decorator'
import { CurrentUser } from './decorators/current-user.decorator'
import { JwtRefreshGuard } from './guards/jwt-refresh.guard'
import { UserDocument } from '../users/schemas/user.schema'

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterDto): Promise<AuthResponseDto> {
    return this.authService.register(dto)
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(dto)
  }

  /**
   * Global JwtAuthGuard sees @Public() and exits early.
   * JwtRefreshGuard then validates the refresh token in the Authorization header.
   */
  @Public()
  @UseGuards(JwtRefreshGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@CurrentUser() user: UserDocument): Promise<TokensDto> {
    return this.authService.refresh(user)
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentUser('_id') userId: { toString(): string }): Promise<void> {
    await this.authService.logout(userId.toString())
  }
}
