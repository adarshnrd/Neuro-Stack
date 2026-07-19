import { Module } from '@nestjs/common'
import { DatabaseModule } from '@app/database/database.module'
import { SharedModule } from '@app/shared/shared.module'
import { AzureModule } from '@app/shared/azure/azure.module'
import { OrganizationsService } from './organizations.service'
import { OrganizationsController } from './organizations.controller'

@Module({
  imports: [
    DatabaseModule, // Organization, Project, Repository, Team models
    SharedModule, // EncryptionService (PAT encrypt/decrypt)
    AzureModule, // AzureClientFactory (per-org client + probe)
  ],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
