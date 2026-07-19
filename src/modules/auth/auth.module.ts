import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { MongooseModule } from '@nestjs/mongoose'
import { AuthService } from './auth.service'
import { AuthController } from './auth.controller'
import { JwtStrategy } from './strategies/jwt.strategy'
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy'
import { UsersModule } from '@app/modules/users/users.module'
import { LoginEvent, LoginEventSchema } from '@app/database/schemas/login-event.schema'

@Module({
  imports: [
    UsersModule,
    MongooseModule.forFeature([{ name: LoginEvent.name, schema: LoginEventSchema }]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    // Secrets are passed per-sign call so no global secret here
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtRefreshStrategy],
  exports: [AuthService],
})
export class AuthModule {}
