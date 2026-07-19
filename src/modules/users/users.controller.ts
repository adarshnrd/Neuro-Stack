import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common'
// FastifyReply is a peer dep of @nestjs/platform-fastify; typed as unknown to avoid a direct import
import { UsersService } from './users.service'
import { CreateWhitelistedUserDto } from './dto/create-whitelisted-user.dto'
import { ChangePasswordDto } from './dto/change-password.dto'
import { UpdateProfileDto } from './dto/update-profile.dto'
import { UpdatePreferencesDto } from './dto/update-preferences.dto'
import { UpdateUserRoleDto, UpdateUserStatusDto } from './dto/update-user-admin.dto'
import { SanitizedUserDto } from './dto/user-profile.dto'
import { Roles } from '@app/common/decorators/roles.decorator'
import { CurrentUser } from '@app/common/decorators/current-user.decorator'
import { UserRole } from '@app/common/types/roles.enum'
import { UserDocument } from '@app/users/schemas/user.schema'
import { PaginationDto, PaginatedResult } from '@app/common/types'

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // ─── Static routes first (must precede /:azureId) ────────────────────────

  @Get('me')
  getMyProfile(@CurrentUser() user: UserDocument): Promise<SanitizedUserDto> {
    return this.usersService.getMyProfile(user._id.toString())
  }

  @Patch('me')
  updateProfile(
    @CurrentUser() user: UserDocument,
    @Body() dto: UpdateProfileDto,
  ): Promise<SanitizedUserDto> {
    return this.usersService.updateProfile(user._id.toString(), dto)
  }

  @Post('me/avatar')
  @HttpCode(HttpStatus.NO_CONTENT)
  uploadAvatar(
    @CurrentUser() user: UserDocument,
    @Body() body: { data: string; mimeType: string },
  ): Promise<void> {
    return this.usersService.uploadAvatar(user._id.toString(), body.data, body.mimeType)
  }

  @Get('me/avatar')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getMyAvatar(@CurrentUser() user: UserDocument, @Res() res: any): Promise<void> {
    const avatar = await this.usersService.getAvatarData(user._id.toString())
    if (!avatar) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await res.status(HttpStatus.NOT_FOUND).send()
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await res
      .header('Content-Type', avatar.mimeType)
      .header('Cache-Control', 'private, max-age=86400')
      .send(avatar.data)
  }

  @Delete('me/avatar')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteAvatar(@CurrentUser() user: UserDocument): Promise<void> {
    return this.usersService.deleteAvatar(user._id.toString())
  }

  @Patch('me/preferences')
  updatePreferences(
    @CurrentUser() user: UserDocument,
    @Body() dto: UpdatePreferencesDto,
  ): Promise<SanitizedUserDto> {
    return this.usersService.updatePreferences(user._id.toString(), dto)
  }

  @Delete('me/sessions')
  @HttpCode(HttpStatus.NO_CONTENT)
  invalidateSessions(@CurrentUser() user: UserDocument): Promise<void> {
    return this.usersService.invalidateSessions(user._id.toString())
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  changePassword(
    @CurrentUser('_id') id: { toString(): string },
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    return this.usersService.changePassword(id.toString(), dto)
  }

  // ─── Admin / whitelist routes ─────────────────────────────────────────────

  @Post('whitelist')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async whitelist(@Body() dto: CreateWhitelistedUserDto): Promise<SanitizedUserDto> {
    const user = await this.usersService.createWhitelistedUser(dto)
    return this.usersService.sanitizeUser(user)
  }

  @Delete('whitelist/:emailHash')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeFromWhitelist(@Param('emailHash') emailHash: string): Promise<void> {
    return this.usersService.removeFromWhitelist(emailHash)
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  findAll(@Query() pagination: PaginationDto): Promise<PaginatedResult<SanitizedUserDto>> {
    return this.usersService.findAll(pagination)
  }

  @Patch(':id/role')
  @Roles(UserRole.ADMIN)
  updateUserRole(
    @CurrentUser() requester: UserDocument,
    @Param('id') targetId: string,
    @Body() dto: UpdateUserRoleDto,
  ): Promise<SanitizedUserDto> {
    return this.usersService.updateUserRole(requester._id.toString(), targetId, dto)
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  setUserStatus(
    @CurrentUser() requester: UserDocument,
    @Param('id') targetId: string,
    @Body() dto: UpdateUserStatusDto,
  ): Promise<SanitizedUserDto> {
    return this.usersService.setUserStatus(requester._id.toString(), targetId, dto)
  }
}
