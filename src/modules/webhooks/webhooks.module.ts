import { Module } from '@nestjs/common'
import { DatabaseModule } from '@app/database/database.module'
import { SharedModule } from '@app/shared/shared.module'
import { AzureModule } from '@app/shared/azure/azure.module'
import { DevelopersModule } from '@app/modules/developers/developers.module'
import { WebhooksService } from './webhooks.service'
import { WebhooksController } from './webhooks.controller'
import { CommitsService } from './services/commits.service'
import { PushEventProcessor } from './processors/push-event.processor'
import { PullRequestProcessor } from './processors/pull-request.processor'
import { WorkItemProcessor } from './processors/work-item.processor'
@Module({
  imports: [
    DatabaseModule, // WebhookEvent, TriggerLog, Commit, PullRequest, WorkItem, PrAlert models
    SharedModule, // EncryptionService
    AzureModule, // AZURE_GIT_SERVICE + AZURE_BOARDS_SERVICE for commit diffs and work item fetch
    DevelopersModule, // DevelopersService for author email → Azure ID resolution
  ],
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    CommitsService,
    PushEventProcessor,
    PullRequestProcessor,
    WorkItemProcessor,
  ],
  exports: [WebhooksService, CommitsService],
})
export class WebhooksModule {}
