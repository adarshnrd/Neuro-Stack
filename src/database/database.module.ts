import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { AIAnalysis, AIAnalysisSchema } from './schemas/ai-analysis.schema'
import { Commit, CommitSchema } from './schemas/commit.schema'
import { DailySummary, DailySummarySchema } from './schemas/daily-summary.schema'
import { Developer, DeveloperSchema } from './schemas/developer.schema'
import { LoginEvent, LoginEventSchema } from './schemas/login-event.schema'
import { MonthlySummary, MonthlySummarySchema } from './schemas/monthly-summary.schema'
import { Organization, OrganizationSchema } from './schemas/organization.schema'
import { PrAlert, PrAlertSchema } from './schemas/pr-alert.schema'
import {
  PrEffortAnalysis,
  PrEffortAnalysisSchema,
} from './schemas/pr-effort-analysis.schema'
import { Project, ProjectSchema } from './schemas/project.schema'
import { PullRequest, PullRequestSchema } from './schemas/pull-request.schema'
import { Repository, RepositorySchema } from './schemas/repository.schema'
import { Sprint, SprintSchema } from './schemas/sprint.schema'
import { Team, TeamSchema } from './schemas/team.schema'
import { TriggerLog, TriggerLogSchema } from './schemas/trigger-log.schema'
import { WebhookEvent, WebhookEventSchema } from './schemas/webhook-event.schema'
import { WorkItem, WorkItemSchema } from './schemas/work-item.schema'

const SCHEMAS = MongooseModule.forFeature([
  { name: AIAnalysis.name, schema: AIAnalysisSchema },
  { name: Commit.name, schema: CommitSchema },
  { name: DailySummary.name, schema: DailySummarySchema },
  { name: Developer.name, schema: DeveloperSchema },
  { name: LoginEvent.name, schema: LoginEventSchema },
  { name: MonthlySummary.name, schema: MonthlySummarySchema },
  { name: Organization.name, schema: OrganizationSchema },
  { name: PrAlert.name, schema: PrAlertSchema },
  { name: PrEffortAnalysis.name, schema: PrEffortAnalysisSchema },
  { name: Project.name, schema: ProjectSchema },
  { name: PullRequest.name, schema: PullRequestSchema },
  { name: Repository.name, schema: RepositorySchema },
  { name: Sprint.name, schema: SprintSchema },
  { name: Team.name, schema: TeamSchema },
  { name: TriggerLog.name, schema: TriggerLogSchema },
  { name: WebhookEvent.name, schema: WebhookEventSchema },
  { name: WorkItem.name, schema: WorkItemSchema },
])

@Module({
  imports: [SCHEMAS],
  exports: [SCHEMAS],
})
export class DatabaseModule {}
