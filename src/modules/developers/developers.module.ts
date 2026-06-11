import { Module } from '@nestjs/common'
import { DatabaseModule } from '@app/database/database.module'
import { SharedModule } from '@app/shared/shared.module'
import { AzureModule } from '@app/shared/azure/azure.module'
import { DevelopersService } from './developers.service'
import { DevelopersController } from './developers.controller'

@Module({
  imports: [
    DatabaseModule, // Developer model
    SharedModule, // EncryptionService
    AzureModule, // AZURE_GIT_SERVICE for org-membership sync
  ],
  controllers: [DevelopersController],
  providers: [DevelopersService],
  exports: [DevelopersService],
})
export class DevelopersModule {}
