import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import { AuthService } from './auth.service'
import { LoginDto } from './dto/login.dto'
import { AuthResponseDto, TokensDto } from './dto/auth-response.dto'
import { Public } from '@app/common/decorators/public.decorator'
import { CurrentUser } from '@app/common/decorators/current-user.decorator'
import { JwtRefreshGuard } from '@app/common/guards/jwt-refresh.guard'
import { UserDocument } from '@app/users/schemas/user.schema'
import { SanitizedUserDto } from '@app/modules/users/dto/user-profile.dto'
import { UsersService } from '@app/modules/users/users.service'

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Rate-limit to 5 requests / 60 s.
   * Requires: npm install @nestjs/throttler
   * Then add ThrottlerModule.forRoot([{ ttl: 60000, limit: 5 }]) to AppModule
   * and @Throttle({ default: { limit: 5, ttl: 60000 } }) decorator here.
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() req: { ip?: string }): Promise<AuthResponseDto> {
    return this.authService.login(dto.email, dto.password, req.ip)
  }

  @Public()
  @UseGuards(JwtRefreshGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(
    @CurrentUser() user: UserDocument,
    @Headers('authorization') authHeader: string,
  ): Promise<TokensDto> {
    const rawToken = authHeader?.split(' ')[1]
    if (!rawToken) throw new UnauthorizedException('Refresh token missing')
    return this.authService.refreshTokens(user._id.toString(), rawToken)
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@CurrentUser('_id') id: { toString(): string }): Promise<void> {
    return this.authService.logout(id.toString())
  }

  @Get('me')
  me(@CurrentUser() user: UserDocument): SanitizedUserDto {
    return this.usersService.sanitizeUser(user)
  }
}
