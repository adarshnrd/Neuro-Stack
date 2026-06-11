import { Module } from '@nestjs/common'
import { DatabaseModule } from '@app/database/database.module'
import { DevelopersModule } from '@app/modules/developers/developers.module'
import { RetryEventsCron } from './crons/retry-events.cron'
import { DailySummaryCron } from './crons/daily-summary.cron'
import { MonthlySummaryCron } from './crons/monthly-summary.cron'
import { RotateLogsCron } from './crons/rotate-logs.cron'
import { RealtimeAnalyticsProjector } from './projectors/realtime-analytics.projector'
import { AnalyticsService } from './analytics.service'
import { AnalyticsController } from './analytics.controller'

@Module({
  imports: [
    // All @InjectModel(...) tokens used by crons + AnalyticsService
    DatabaseModule,
    // DevelopersService for azureDevOpsId → display-name enrichment.
    // DevelopersModule already brings SharedModule (EncryptionService) into scope.
    DevelopersModule,
  ],
  providers: [
    RetryEventsCron,
    DailySummaryCron,
    MonthlySummaryCron,
    RotateLogsCron,
    RealtimeAnalyticsProjector,
    AnalyticsService,
  ],
  controllers: [AnalyticsController],
})
export class AnalyticsModule {}
