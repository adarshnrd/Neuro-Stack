import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { createHash } from 'crypto'
import * as bcrypt from 'bcryptjs'
import { User, UserDocument, UserPreferences } from '@app/users/schemas/user.schema'
import { UserRole } from '@app/common/types/roles.enum'
import { EncryptionService } from '@app/shared/encryption/encryption.service'
import { PaginationDto, PaginatedResult } from '@app/common/types'
import { SanitizedUserDto } from './dto/user-profile.dto'
import { CreateWhitelistedUserDto } from './dto/create-whitelisted-user.dto'
import { ChangePasswordDto } from './dto/change-password.dto'
import { UpdateProfileDto } from './dto/update-profile.dto'
import { UpdatePreferencesDto } from './dto/update-preferences.dto'
import { UpdateUserRoleDto, UpdateUserStatusDto } from './dto/update-user-admin.dto'

const MAX_AVATAR_BYTES = 2 * 1024 * 1024 // 2 MB

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly encryptionService: EncryptionService,
  ) {}

  // ─── Email hashing ────────────────────────────────────────────────────────

  hashEmail(email: string): string {
    return createHash('sha256').update(email.toLowerCase()).digest('hex')
  }

  // ─── Finders ─────────────────────────────────────────────────────────────

  async findByEmailHash(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ emailHash: this.hashEmail(email) }).exec()
  }

  async findByEmailForAuth(email: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ emailHash: this.hashEmail(email) })
      .select('+passwordHash +refreshTokenHash')
      .exec()
  }

  async findByIdForRefresh(userId: string): Promise<UserDocument | null> {
    return this.userModel.findById(userId).select('+refreshTokenHash').exec()
  }

  async findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec()
  }

  async findAll(dto: PaginationDto): Promise<PaginatedResult<SanitizedUserDto>> {
    const { page, limit } = dto
    const [users, total] = await Promise.all([
      this.userModel
        .find()
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.userModel.countDocuments().exec(),
    ])
    return {
      items: users.map((u) => this.sanitizeUser(u)),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    }
  }

  // ─── Own-account: profile ─────────────────────────────────────────────────

  async getMyProfile(userId: string): Promise<SanitizedUserDto> {
    const user = await this.userModel.findById(userId).exec()
    if (!user) throw new NotFoundException('User not found')
    return this.sanitizeUser(user)
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<SanitizedUserDto> {
    const user = await this.userModel.findById(userId).exec()
    if (!user) throw new NotFoundException('User not found')

    if (dto.name !== undefined) {
      user.name = dto.name
      user.displayNameEncrypted = this.encryptionService.encrypt(dto.name)
    }
    if (dto.team !== undefined) user.team = dto.team

    await user.save()
    return this.sanitizeUser(user)
  }

  // ─── Own-account: avatar ──────────────────────────────────────────────────

  async uploadAvatar(userId: string, base64Data: string, mimeType: string): Promise<void> {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (!allowed.includes(mimeType)) {
      throw new BadRequestException('Unsupported image type. Use JPEG, PNG, WebP, or GIF.')
    }

    const buf = Buffer.from(base64Data, 'base64')
    if (buf.byteLength > MAX_AVATAR_BYTES) {
      throw new BadRequestException('Image too large. Maximum size is 2 MB.')
    }

    await this.userModel
      .findByIdAndUpdate(userId, { avatarData: buf, avatarMimeType: mimeType })
      .exec()
  }

  async getAvatarData(userId: string): Promise<{ data: Buffer; mimeType: string } | null> {
    const user = await this.userModel.findById(userId).select('+avatarData avatarMimeType').exec()
    if (!user?.avatarData || !user.avatarMimeType) return null
    return { data: user.avatarData, mimeType: user.avatarMimeType }
  }

  async deleteAvatar(userId: string): Promise<void> {
    await this.userModel
      .findByIdAndUpdate(userId, { $unset: { avatarData: 1, avatarMimeType: 1 } })
      .exec()
  }

  // ─── Own-account: preferences ─────────────────────────────────────────────

  async updatePreferences(userId: string, dto: UpdatePreferencesDto): Promise<SanitizedUserDto> {
    const user = await this.userModel.findById(userId).exec()
    if (!user) throw new NotFoundException('User not found')

    const merged: UserPreferences = {
      emailNotifications: dto.emailNotifications ?? user.preferences?.emailNotifications ?? true,
      weeklyDigest: dto.weeklyDigest ?? user.preferences?.weeklyDigest ?? true,
      showEfficiencyScore: dto.showEfficiencyScore ?? user.preferences?.showEfficiencyScore ?? true,
      defaultPeriod: dto.defaultPeriod ?? user.preferences?.defaultPeriod ?? 'daily',
    }
    user.preferences = merged
    await user.save()
    return this.sanitizeUser(user)
  }

  // ─── Own-account: password ────────────────────────────────────────────────

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.userModel.findById(userId).select('+passwordHash').exec()
    if (!user) throw new NotFoundException('User not found')

    const isValid = await bcrypt.compare(dto.currentPassword, user.passwordHash)
    if (!isValid) throw new UnauthorizedException('Current password is incorrect')

    user.passwordHash = await bcrypt.hash(dto.newPassword, 12)
    await user.save()
  }

  // ─── Own-account: session invalidation ───────────────────────────────────

  async invalidateSessions(userId: string): Promise<void> {
    await this.userModel.findByIdAndUpdate(userId, { refreshTokenHash: null }).exec()
  }

  // ─── Admin write operations ───────────────────────────────────────────────

  async createWhitelistedUser(dto: CreateWhitelistedUserDto): Promise<UserDocument> {
    const emailLower = dto.email.toLowerCase()
    const emailHash = this.hashEmail(emailLower)

    if (await this.userModel.exists({ emailHash })) {
      throw new ForbiddenException('Email already registered')
    }

    const displayName = dto.displayName ?? emailLower.split('@')[0]
    const [passwordHash, displayNameEncrypted] = await Promise.all([
      bcrypt.hash(dto.tempPassword, 12),
      Promise.resolve(this.encryptionService.encrypt(displayName)),
    ])

    const user = new this.userModel({
      email: emailLower,
      emailHash,
      passwordHash,
      name: displayName,
      displayNameEncrypted,
      role: dto.role,
      team: dto.team,
      isWhitelisted: true,
    })
    return user.save()
  }

  async removeFromWhitelist(emailHash: string): Promise<void> {
    const user = await this.userModel.findOne({ emailHash }).exec()
    if (!user) throw new NotFoundException('User not found')
    user.isWhitelisted = false
    await user.save()
  }

  async updateUserRole(
    requesterId: string,
    targetId: string,
    dto: UpdateUserRoleDto,
  ): Promise<SanitizedUserDto> {
    if (requesterId === targetId) {
      throw new ForbiddenException('Cannot change your own role')
    }
    const user = await this.userModel.findById(targetId).exec()
    if (!user) throw new NotFoundException('User not found')

    user.role = dto.role
    await user.save()
    return this.sanitizeUser(user)
  }

  async setUserStatus(
    requesterId: string,
    targetId: string,
    dto: UpdateUserStatusDto,
  ): Promise<SanitizedUserDto> {
    if (requesterId === targetId) {
      throw new ForbiddenException('Cannot deactivate your own account')
    }
    const user = await this.userModel.findById(targetId).exec()
    if (!user) throw new NotFoundException('User not found')

    user.isActive = dto.isActive
    // Invalidate sessions when deactivating
    if (!dto.isActive) user.refreshTokenHash = null
    await user.save()
    return this.sanitizeUser(user)
  }

  // ─── Serialization ────────────────────────────────────────────────────────

  sanitizeUser(user: UserDocument): SanitizedUserDto {
    let displayName: string | undefined
    try {
      if (user.displayNameEncrypted) {
        displayName = this.encryptionService.decrypt(user.displayNameEncrypted)
      }
    } catch {
      // Non-fatal
    }

    const plain = user.toObject({ virtuals: false }) as Record<string, unknown>

    return {
      id: user._id.toString(),
      email: user.email,
      name: user.name ?? displayName ?? '',
      role: user.role as UserRole,
      isActive: user.isActive,
      isWhitelisted: user.isWhitelisted,
      azureDevOpsId: user.azureDevOpsId,
      displayName,
      team: user.team,
      hasAvatar: !!(plain['avatarMimeType']),
      preferences: user.preferences,
      lastLoginAt: user.lastLoginAt,
      createdAt: (plain['createdAt'] as Date | undefined),
    }
  }
}
