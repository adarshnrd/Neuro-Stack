import { Module } from '@nestjs/common'
import { AzureGitService } from './azure-git.service'
import { AzureBoardsService } from './azure-boards.service'
import { AzureThrottleService } from './azure-throttle.service'
import { AzureClientFactory } from './azure-client.factory'
import { AZURE_GIT_SERVICE } from '../interfaces/azure-git.interface'
import { AZURE_BOARDS_SERVICE } from '../interfaces/azure-boards.interface'

/**
 * Provides AzureGitService and AzureBoardsService under their injection tokens,
 * plus the AzureClientFactory for per-organization (multi-org) Azure clients.
 * Import this module anywhere that needs @Optional() @Inject(AZURE_GIT_SERVICE) or
 * @Optional() @Inject(AZURE_BOARDS_SERVICE) to be resolved.
 */
@Module({
  providers: [
    AzureThrottleService,
    AzureClientFactory,
    { provide: AZURE_GIT_SERVICE, useClass: AzureGitService },
    { provide: AZURE_BOARDS_SERVICE, useClass: AzureBoardsService },
  ],
  exports: [AZURE_GIT_SERVICE, AZURE_BOARDS_SERVICE, AzureThrottleService, AzureClientFactory],
})
export class AzureModule {}
