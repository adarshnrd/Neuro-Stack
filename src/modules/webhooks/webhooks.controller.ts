import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
} from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { WebhooksService } from './webhooks.service'
import { Public } from '@app/common/decorators/public.decorator'
import { TriggerProcessingStatus } from '@app/database/schemas/trigger-log.schema'

interface AzureWebhookBody {
  id?: string
  eventType?: string
  resource?: {
    pushedBy?: { id?: string; displayName?: string }
    createdBy?: { id?: string; displayName?: string }
    repository?: {
      name?: string
      project?: { name?: string }
    }
  }
  [key: string]: unknown
}

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name)

  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Single ingestion endpoint for all Azure DevOps webhook events.
   *
   * CONTRACT: must always return HTTP 200 with {received:true}.
   * Azure treats any non-2xx as a delivery failure and will retry,
   * flooding the service. All errors are logged and swallowed.
   *
   * Target latency: < 50 ms (HMAC check → duplicate check → encrypt → 2 inserts → emit)
   */
  @Public()
  @Post('azure')
  @HttpCode(HttpStatus.OK)
  async handleAzureWebhook(
    @Body() body: AzureWebhookBody,
    @Headers() headers: Record<string, string | undefined>,
    @Req() req: { ip?: string },
  ): Promise<{ received: boolean }> {
    try {
      // ── a) Extract delivery ID ──────────────────────────────────────────
      const deliveryId = headers['x-vss-messageid'] ?? body.id ?? ''

      // ── b) Idempotency: skip already-seen deliveries ────────────────────
      if (deliveryId && (await this.webhooksService.isDuplicate(deliveryId))) {
        this.logger.debug(`Duplicate delivery skipped: ${deliveryId}`)
        return { received: true }
      }

      // ── c) Detect and map event type ────────────────────────────────────
      const azureEventType = body.eventType ?? ''
      const eventType = this.webhooksService.detectEventType(azureEventType)

      if (!eventType) {
        this.logger.warn(`Unrecognised Azure event type: "${azureEventType}" — ignoring`)
        return { received: true }
      }

      // ── d) Encrypt raw payload and persist WebhookEvent ─────────────────
      const webhookEvent = await this.webhooksService.saveRawEvent(
        body as Record<string, unknown>,
        eventType,
        deliveryId,
      )

      // ── e) Save audit TriggerLog ────────────────────────────────────────
      const resource = body.resource ?? {}
      const repository = resource.repository ?? {}
      const pushedBy = resource.pushedBy ?? resource.createdBy

      await this.webhooksService.saveTriggerLog(
        deliveryId,
        azureEventType,
        webhookEvent._id.toString(),
        TriggerProcessingStatus.SAVED,
        {
          developerAzureId: pushedBy?.id,
          developerName: pushedBy?.displayName,
          repositoryName: repository.name,
          projectName: repository.project?.name,
          ipAddress: req.ip,
        },
      )

      // ── f) Emit for async processing — non-blocking ─────────────────────
      this.eventEmitter.emit(`webhook.${eventType}`, {
        webhookEventId: webhookEvent._id.toString(),
      })
    } catch (err) {
      // ── CRITICAL: swallow all exceptions to prevent Azure retry floods ──
      this.logger.error('Webhook ingestion error', err instanceof Error ? err.stack : String(err))
    }

    // ── g) Always acknowledge within 50 ms ─────────────────────────────
    return { received: true }
  }

  /**
   * GET /webhooks/events
   * Returns the most recent webhook events with processing status.
   * Use this to verify that Azure webhook deliveries are being received
   * and processed correctly. Requires authentication (admin/manager).
   */
  @Get('events')
  getRecentEvents(@Query('limit') limit?: string) {
    const n = Math.min(parseInt(limit ?? '20', 10) || 20, 100)
    return this.webhooksService.getRecentEvents(n)
  }
}
