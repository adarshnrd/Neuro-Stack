/**
 * Analytics REST API
 *
 * Swagger decorators require: npm install @nestjs/swagger
 * Add SwaggerModule.setup() in main.ts to enable /api-docs UI.
 */
import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common'
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger'

import { CurrentUser } from '@app/common/decorators/current-user.decorator'
import { Roles } from '@app/common/decorators/roles.decorator'
import { UserRole } from '@app/common/types/roles.enum'
import { PaginatedResult } from '@app/common/types'
import { UserDocument } from '@app/users/schemas/user.schema'

import { AnalyticsService } from './analytics.service'
import { DailySummaryCron, type DailyRebuildResult } from './crons/daily-summary.cron'
import { MonthlySummaryCron, type MonthlyBuildResult } from './crons/monthly-summary.cron'
import {
  DeveloperCommitsQueryDto,
  DeveloperDailyQueryDto,
  DeveloperMonthlyQueryDto,
  DeveloperProjectsQueryDto,
  DeveloperPrEffortQueryDto,
  DailyLoginsQueryDto,
  OrgDailyQueryDto,
  OrgMonthlyQueryDto,
  OrgOverviewQueryDto,
  TriggerLogQueryDto,
  type CommitWithAnalysisDto,
  type DailyLoginCountDto,
  type LoginEventRecordDto,
  type DailySummaryWithUserDto,
  type OrgOverviewDto,
  type OrgDailyEffortDto,
  type PrWithAuthorDto,
  type PrEffortDto,
  type PrCommitDto,
  type ProjectSummaryDto,
} from './dto/analytics.dto'

@ApiTags('Analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly dailySummaryCron: DailySummaryCron,
    private readonly monthlySummaryCron: MonthlySummaryCron,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Org-level endpoints
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /analytics/org/overview
   * Accessible by all authenticated roles.
   */
  @Get('org/overview')
  @ApiOperation({
    summary: 'Organisation overview for a given day',
    description:
      'Returns commit totals, active developers, top performers, and missing-work-item PR count. ' +
      'Defaults to today (UTC) when ?date is omitted.',
  })
  @ApiQuery({
    name: 'date',
    required: false,
    example: '2025-06-01',
    description: 'Target date YYYY-MM-DD (UTC). Defaults to today.',
  })
  getOrgOverview(@Query() query: OrgOverviewQueryDto): Promise<OrgOverviewDto> {
    return this.analyticsService.getOrgOverview(query.date)
  }

  /**
   * GET /analytics/org/daily
   * Accessible by all authenticated roles.
   */
  @Get('org/daily')
  @ApiOperation({
    summary: "All developers' daily summary for a given date",
    description:
      'Returns one DailySummary per developer who had activity on the requested date, ' +
      'enriched with a decrypted displayName. Sorted by avgEfficiencyScore descending.',
  })
  @ApiQuery({
    name: 'date',
    required: false,
    example: '2025-06-01',
    description: 'YYYY-MM-DD. Defaults to today.',
  })
  getOrgDailySummaries(@Query() query: OrgDailyQueryDto): Promise<DailySummaryWithUserDto[]> {
    return this.analyticsService.getOrgDailySummaries(query.date)
  }

  /**
   * GET /analytics/org/pr-effort
   * Accessible by all authenticated roles.
   */
  @Get('org/pr-effort')
  @ApiOperation({
    summary: 'Per-developer PR effort rollup for a given date',
    description:
      'Aggregates AI-estimated and developer-reported hours from PR Work Analysis ' +
      'for every developer with PR commit activity on the requested date. ' +
      'Sorted by reported hours descending.',
  })
  @ApiQuery({
    name: 'date',
    required: false,
    example: '2025-06-01',
    description: 'YYYY-MM-DD. Defaults to today.',
  })
  getOrgPrEffortByDay(@Query() query: OrgDailyQueryDto): Promise<OrgDailyEffortDto[]> {
    return this.analyticsService.getOrgPrEffortByDay(query.date)
  }

  /**
   * GET /analytics/org/monthly
   * Accessible by all authenticated roles.
   */
  @Get('org/monthly')
  @ApiOperation({
    summary: "All developers' monthly summary for a given month",
    description: 'Sorted by totalCommits descending.',
  })
  @ApiQuery({
    name: 'month',
    required: false,
    example: '2025-06',
    description: 'YYYY-MM. Defaults to the current month.',
  })
  getOrgMonthlySummaries(@Query() query: OrgMonthlyQueryDto) {
    return this.analyticsService.getOrgMonthlySummaries(query.month)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Developer-level endpoints (ADMIN / MANAGER only — developers are not users)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /analytics/developer/:azureId/daily
   * ADMIN / MANAGER may query any developer.
   */
  @Get('developer/:azureId/daily')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Paginated daily summaries for a developer (max 90-day range)',
    description:
      'Developers can only access their own data. ' +
      'Admins and managers can access any developer.',
  })
  @ApiParam({ name: 'azureId', description: 'Azure DevOps user ID' })
  @ApiQuery({
    name: 'from',
    required: false,
    example: '2025-05-01',
    description: 'YYYY-MM-DD start (inclusive)',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    example: '2025-06-01',
    description: 'YYYY-MM-DD end (inclusive, max 90-day span)',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  getDeveloperDailySummaries(
    @Param('azureId') azureId: string,
    @Query() query: DeveloperDailyQueryDto,
    @CurrentUser() user: UserDocument,
  ): Promise<PaginatedResult<unknown>> {
    return this.analyticsService.getDeveloperDailySummaries(
      user,
      azureId,
      query.from,
      query.to,
      query.page,
      query.limit,
    )
  }

  /**
   * GET /analytics/developer/:azureId/monthly
   * ADMIN / MANAGER may query any developer.
   */
  @Get('developer/:azureId/monthly')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Paginated monthly summaries for a developer',
    description:
      'Use from/to (YYYY-MM) to bound the range. ' + 'Developers can only access their own data.',
  })
  @ApiParam({ name: 'azureId', description: 'Azure DevOps user ID' })
  @ApiQuery({
    name: 'from',
    required: false,
    example: '2025-01',
    description: 'YYYY-MM start (inclusive)',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    example: '2025-06',
    description: 'YYYY-MM end (inclusive)',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  getDeveloperMonthlySummaries(
    @Param('azureId') azureId: string,
    @Query() query: DeveloperMonthlyQueryDto,
    @CurrentUser() user: UserDocument,
  ): Promise<PaginatedResult<unknown>> {
    return this.analyticsService.getDeveloperMonthlySummaries(
      user,
      azureId,
      query.from,
      query.to,
      query.page,
      query.limit,
    )
  }

  /**
   * GET /analytics/developer/:azureId/commits
   * Individual commits with joined AI analysis + PR status.
   */
  @Get('developer/:azureId/commits')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Paginated commits for a developer with AI analysis and PR status',
    description:
      'Optionally filter by a single date and/or repositoryId. ' +
      'Each commit is enriched with an inline AI analysis summary ' +
      '(efficiencyScore, complexityLevel, technicalSummary) and the PR status when linked.',
  })
  @ApiParam({ name: 'azureId', description: 'Azure DevOps user ID' })
  @ApiQuery({
    name: 'date',
    required: false,
    example: '2025-06-01',
    description: 'Filter by specific day YYYY-MM-DD',
  })
  @ApiQuery({ name: 'repositoryId', required: false, description: 'Filter by Azure repository ID' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  getDeveloperCommits(
    @Param('azureId') azureId: string,
    @Query() query: DeveloperCommitsQueryDto,
    @CurrentUser() user: UserDocument,
  ): Promise<PaginatedResult<CommitWithAnalysisDto>> {
    return this.analyticsService.getDeveloperCommits(
      user,
      azureId,
      query.date,
      query.repositoryId,
      query.page,
      query.limit,
    )
  }

  /**
   * GET /analytics/developer/:azureId/projects
   * Group commits by repository and aggregate per-repo stats.
   */
  @Get('developer/:azureId/projects')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Per-repository commit activity for a developer',
    description:
      'Aggregates commits by repositoryId: commitCount, line totals, ' +
      'union of languagesUsed, and lastCommitAt. Sorted by lastCommitAt desc.',
  })
  @ApiParam({ name: 'azureId', description: 'Azure DevOps user ID' })
  @ApiQuery({
    name: 'from',
    required: false,
    example: '2025-01-01',
    description: 'YYYY-MM-DD start',
  })
  @ApiQuery({ name: 'to', required: false, example: '2025-06-30', description: 'YYYY-MM-DD end' })
  getDeveloperProjects(
    @Param('azureId') azureId: string,
    @Query() query: DeveloperProjectsQueryDto,
    @CurrentUser() user: UserDocument,
  ): Promise<ProjectSummaryDto[]> {
    return this.analyticsService.getDeveloperProjects(user, azureId, query.from, query.to)
  }

  /**
   * GET /analytics/developer/:azureId/pr-effort
   * Per-PR "expected vs actual" effort analysis for a developer.
   */
  @Get('developer/:azureId/pr-effort')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Per-PR effort analysis (AI-estimated vs actual hours) for a developer',
    description:
      'Returns one row per pull request authored by the developer in the optional created-date ' +
      'window, each with the AI-estimated hour range, the developer actual hours (work-item ' +
      'CompletedWork or commit-activity estimate), variance, and late-binding phase.',
  })
  @ApiParam({ name: 'azureId', description: 'Azure DevOps user ID' })
  @ApiQuery({
    name: 'from',
    required: false,
    example: '2025-01-01',
    description: 'YYYY-MM-DD start',
  })
  @ApiQuery({ name: 'to', required: false, example: '2025-06-30', description: 'YYYY-MM-DD end' })
  getDeveloperPrEffort(
    @Param('azureId') azureId: string,
    @Query() query: DeveloperPrEffortQueryDto,
  ): Promise<PrEffortDto[]> {
    return this.analyticsService.getDeveloperPrEffort(azureId, query.from, query.to)
  }

  /**
   * GET /analytics/developer/:azureId/pr/:azurePrId/commits
   * Full commit history for a single PR — drives the PR commit-history timeline.
   */
  @Get('developer/:azureId/pr/:azurePrId/commits')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Commit history for a single pull request',
    description:
      'Returns every commit pushed to the PR, ascending by push time, each with its ' +
      'push timestamp, branch, message and line/file deltas. Drives the PR detail timeline.',
  })
  @ApiParam({ name: 'azureId', description: 'Azure DevOps user ID' })
  @ApiParam({ name: 'azurePrId', description: 'Azure DevOps pull request ID' })
  getPrCommits(@Param('azurePrId') azurePrId: string): Promise<PrCommitDto[]> {
    return this.analyticsService.getPrCommits(azurePrId)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Admin / Manager endpoints
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /analytics/prs/alerts
   * PRs with no linked work items.
   * Requires ADMIN or MANAGER role.
   *
   * IMPORTANT: defined before developer/:azureId/* to prevent "prs" being
   * matched as an :azureId wildcard.
   */
  @Get('prs/alerts')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Pull requests with no linked work items',
    description:
      'Returns active and completed PRs where workItemIds is empty, ' +
      "enriched with the author's display name. " +
      'Requires ADMIN or MANAGER role.',
  })
  getPrAlerts(): Promise<PrWithAuthorDto[]> {
    return this.analyticsService.getPrAlerts()
  }

  /**
   * GET /analytics/trigger-logs
   * Paginated trigger log with optional status / date-range filters.
   * Requires ADMIN role.
   */
  @Get('trigger-logs')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Paginated webhook trigger logs',
    description:
      'Filter by processingStatus and/or a createdAt date range. ' +
      'Requires ADMIN role. Results sorted newest-first.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'processingStatus value (received | saved | processed | failed)',
  })
  @ApiQuery({ name: 'from', required: false, description: 'ISO 8601 start datetime' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO 8601 end datetime' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  getTriggerLogs(@Query() query: TriggerLogQueryDto): Promise<PaginatedResult<unknown>> {
    return this.analyticsService.getTriggerLogs(
      query.status,
      query.from,
      query.to,
      query.page,
      query.limit,
    )
  }

  /**
   * POST /analytics/admin/trigger-daily
   * On-demand full rebuild of one day's summaries. Powers the "Sync" button on
   * the daily analytics page. Requires ADMIN or MANAGER.
   */
  @Post('admin/trigger-daily')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Rebuild daily analytics for one day on demand',
    description:
      'Recomputes every developer with any activity (commits, PRs, or work ' +
      'items) on the given day. Defaults to today (reporting timezone). ' +
      'Requires ADMIN or MANAGER role.',
  })
  @ApiQuery({
    name: 'date',
    required: false,
    example: '2026-06-11',
    description: 'Target date YYYY-MM-DD. Defaults to today (reporting timezone).',
  })
  triggerDailyAnalytics(@Query('date') date?: string): Promise<DailyRebuildResult> {
    return this.dailySummaryCron.rebuildForDate(date)
  }

  /**
   * POST /analytics/admin/trigger-monthly
   * On-demand monthly roll-up for a given month. Powers the "Sync Now"
   * button on the Monthly Analytics page. Requires ADMIN or MANAGER.
   * Returns 409 if a build is already running, 400 on a malformed month.
   */
  @Post('admin/trigger-monthly')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Trigger monthly summary roll-up on demand',
    description:
      'Rebuilds monthly summaries for the given month (YYYY-MM) by aggregating ' +
      'existing daily summaries. Defaults to the previous month when omitted. ' +
      'Returns 409 if already running. Requires ADMIN or MANAGER role.',
  })
  @ApiQuery({
    name: 'month',
    required: false,
    example: '2026-06',
    description: 'Target month YYYY-MM. Defaults to the previous month (UTC).',
  })
  triggerMonthlyAnalytics(@Query('month') month?: string): Promise<MonthlyBuildResult> {
    return this.monthlySummaryCron.buildForMonth(month)
  }

  /**
   * GET /analytics/logins/daily
   * Day-wise login counts. Requires ADMIN role.
   */
  @Get('logins/daily')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Day-wise login statistics',
    description:
      'Returns total logins and distinct user counts per UTC day. ' +
      'Defaults to the trailing 30 days when from/to are omitted. Requires ADMIN role.',
  })
  @ApiQuery({ name: 'from', required: false, example: '2025-06-01', description: 'YYYY-MM-DD start' })
  @ApiQuery({ name: 'to', required: false, example: '2025-06-30', description: 'YYYY-MM-DD end' })
  getDailyLogins(@Query() query: DailyLoginsQueryDto): Promise<DailyLoginCountDto[]> {
    return this.analyticsService.getDailyLoginCounts(query.from, query.to)
  }

  /**
   * GET /analytics/logins/events
   * Individual login events. Requires ADMIN role.
   */
  @Get('logins/events')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Individual login events',
    description:
      'Returns each successful login with user identity, date, time, and IP. ' +
      'Defaults to the trailing 30 days when from/to are omitted. Requires ADMIN role.',
  })
  @ApiQuery({ name: 'from', required: false, example: '2025-06-01', description: 'YYYY-MM-DD start' })
  @ApiQuery({ name: 'to', required: false, example: '2025-06-30', description: 'YYYY-MM-DD end' })
  getLoginEvents(@Query() query: DailyLoginsQueryDto): Promise<LoginEventRecordDto[]> {
    return this.analyticsService.getLoginEvents(query.from, query.to)
  }
}
