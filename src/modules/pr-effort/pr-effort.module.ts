import { Module } from '@nestjs/common'

import { DatabaseModule } from '@app/database/database.module'
import { AzureModule } from '@app/shared/azure/azure.module'
import { AIAnalysisModule } from '@app/modules/ai-analysis/ai-analysis.module'

import { PrEffortService } from './pr-effort.service'
import { PrEffortProcessor } from './pr-effort.processor'

@Module({
  imports: [
    // PullRequest, Commit, WorkItem, PrEffortAnalysis models
    DatabaseModule,
    // Provides the QWEN_LLM token for the AI estimate
    AIAnalysisModule,
    // Provides AZURE_GIT_SERVICE for fetching the PR's net code diff
    AzureModule,
  ],
  providers: [PrEffortService, PrEffortProcessor],
  exports: [PrEffortService],
})
export class PrEffortModule {}
