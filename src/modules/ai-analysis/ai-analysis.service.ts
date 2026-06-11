import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common'
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'

import { AIAnalysis, AIAnalysisDocument } from '@app/database/schemas/ai-analysis.schema'
import { Commit, CommitDocument } from '@app/database/schemas/commit.schema'
import { WorkItem, WorkItemDocument } from '@app/database/schemas/work-item.schema'
import {
  AZURE_BOARDS_SERVICE,
  type IAzureBoardsService,
} from '@app/shared/interfaces/azure-boards.interface'
import {
  AZURE_GIT_SERVICE,
  type IAzureGitService,
} from '@app/shared/interfaces/azure-git.interface'

import { QWEN_LLM } from './langchain/qwen.provider'
import { buildAnalysisGraph, type CompiledAnalysisGraph } from './langgraph/analysis.graph'
import { createInitialState } from './langgraph/state/analysis.state'

interface CommitSavedEvent {
  commitId: string
}

@Injectable()
export class AIAnalysisService implements OnModuleInit {
  private readonly logger = new Logger(AIAnalysisService.name)
  private compiledGraph!: CompiledAnalysisGraph

  constructor(
    @InjectModel(AIAnalysis.name)
    private readonly analysisModel: Model<AIAnalysisDocument>,
    @InjectModel(Commit.name)
    private readonly commitModel: Model<CommitDocument>,
    @InjectModel(WorkItem.name)
    private readonly workItemModel: Model<WorkItemDocument>,
    @Inject(QWEN_LLM)
    private readonly llm: BaseChatModel,
    private readonly eventEmitter: EventEmitter2,
    @Optional()
    @Inject(AZURE_BOARDS_SERVICE)
    private readonly boardsService?: IAzureBoardsService,
    @Optional()
    @Inject(AZURE_GIT_SERVICE)
    private readonly gitService?: IAzureGitService,
  ) {}

  onModuleInit(): void {
    const llmAny = this.llm as unknown as Record<string, unknown>
    const modelName =
      (typeof llmAny['modelName'] === 'string' ? llmAny['modelName'] : null) ??
      (typeof llmAny['model'] === 'string' ? llmAny['model'] : null) ??
      'unknown'

    this.compiledGraph = buildAnalysisGraph({
      commitModel: this.commitModel,
      analysisModel: this.analysisModel,
      workItemModel: this.workItemModel,
      llm: this.llm,
      modelName,
      boardsService: this.boardsService,
      gitService: this.gitService,
    })

    this.logger.log(`Analysis graph compiled (model=${modelName})`)
  }

  @OnEvent('commit.saved', { async: true })
  async handleCommitSaved(event: CommitSavedEvent): Promise<void> {
    const { commitId } = event
    this.logger.debug(`AI analysis triggered: ${commitId}`)

    try {
      const finalState = await this.compiledGraph.invoke(createInitialState(commitId))

      if (finalState.error) {
        this.logger.warn(
          `Analysis graph ended with error for commit ${commitId}: ${finalState.error}`,
        )
        return
      }

      if (finalState.analysisComplete) {
        this.logger.debug(
          `Analysis complete for commit ${commitId} ` + `(score=${finalState.efficiencyScore})`,
        )
        // Signal the real-time analytics projector to fold the freshly-computed
        // efficiency score / effort into the developer's daily summary.
        this.eventEmitter.emit('analysis.commit.completed', { commitId })
      }
    } catch (err) {
      this.logger.error(
        `Analysis graph threw for commit ${commitId}`,
        err instanceof Error ? err.stack : String(err),
      )
    }
  }

  /** Update actual effort hours once a work item reaches a terminal state. */
  async updateActualEffort(commitId: string, actualEffortHours: number): Promise<void> {
    const analysis = await this.analysisModel
      .findOne({ commitId: new Types.ObjectId(commitId) })
      .exec()
    if (!analysis) return

    const estimated = analysis.estimatedEffortHours
    const effortDeltaPercent =
      estimated > 0 ? Math.round(((actualEffortHours - estimated) / estimated) * 100) : null

    await this.analysisModel
      .findByIdAndUpdate(analysis._id, {
        $set: { actualEffortHours, effortDeltaPercent },
      })
      .exec()
  }
}
