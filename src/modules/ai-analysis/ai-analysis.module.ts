import { Module } from '@nestjs/common'
import { DatabaseModule } from '@app/database/database.module'
import { SharedModule } from '@app/shared/shared.module'
import { AzureModule } from '@app/shared/azure/azure.module'
import { QwenLlmProvider, QWEN_LLM } from './langchain/qwen.provider'
import { AIAnalysisService } from './ai-analysis.service'

@Module({
  imports: [
    DatabaseModule, // AIAnalysis, Commit, WorkItem models + InjectModel tokens
    SharedModule, // EncryptionService
    AzureModule, // exports AZURE_GIT_SERVICE + AZURE_BOARDS_SERVICE (optional injection)
  ],
  providers: [QwenLlmProvider, AIAnalysisService],
  exports: [AIAnalysisService, QWEN_LLM],
})
export class AIAnalysisModule {}
