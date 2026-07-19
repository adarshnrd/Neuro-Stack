import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import * as bcrypt from 'bcryptjs'
import { User, UserDocument, UserRole } from './schemas/user.schema'

interface CreateUserData {
  email: string
  passwordHash: string
  name: string
  role?: UserRole
}

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  async create(data: CreateUserData): Promise<UserDocument> {
    const user = new this.userModel(data)
    return user.save()
  }

  async findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec()
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() }).exec()
  }

  async updateRefreshTokenHash(userId: string, refreshToken: string | null): Promise<void> {
    const hash = refreshToken ? await bcrypt.hash(refreshToken, 10) : null
    await this.userModel.findByIdAndUpdate(userId, { refreshTokenHash: hash }).exec()
  }

  async validateRefreshToken(userId: string, refreshToken: string): Promise<UserDocument | null> {
    const user = await this.findById(userId)
    if (!user?.refreshTokenHash || !user.isActive) return null
    const isValid = await bcrypt.compare(refreshToken, user.refreshTokenHash)
    return isValid ? user : null
  }
}
