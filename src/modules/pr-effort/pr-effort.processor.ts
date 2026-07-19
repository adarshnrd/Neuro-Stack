import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'

import { PrEffortService } from './pr-effort.service'

interface PrChangedEvent {
  azurePrId: string
}

interface WorkItemChangedEvent {
  workItemId: number
}

/**
 * Listens for post-persist signals from the webhook processors and drives the
 * PR-effort analysis. Runs async/decoupled from the webhook ack path; failures
 * are logged and swallowed so one bad PR never blocks the pipeline.
 */
@Injectable()
export class PrEffortProcessor {
  private readonly logger = new Logger(PrEffortProcessor.name)

  constructor(private readonly prEffortService: PrEffortService) {}

  @OnEvent('analysis.pr.changed', { async: true })
  async onPrChanged(event: PrChangedEvent): Promise<void> {
    try {
      await this.prEffortService.computeForPr(event.azurePrId)
    } catch (err) {
      this.logger.error(
        `PR effort compute failed for PR #${event.azurePrId}`,
        err instanceof Error ? err.stack : String(err),
      )
    }
  }

  @OnEvent('analysis.workitem.changed', { async: true })
  async onWorkItemChanged(event: WorkItemChangedEvent): Promise<void> {
    try {
      await this.prEffortService.recomputeForWorkItem(event.workItemId)
    } catch (err) {
      this.logger.error(
        `PR effort recompute failed for work item #${event.workItemId}`,
        err instanceof Error ? err.stack : String(err),
      )
    }
  }
}
