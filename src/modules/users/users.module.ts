import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { User, UserSchema } from '@app/users/schemas/user.schema'
import { SharedModule } from '@app/shared/shared.module'
import { UsersService } from './users.service'
import { UsersController } from './users.controller'

@Module({
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]), SharedModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
