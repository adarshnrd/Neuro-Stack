import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { MongooseModule } from '@nestjs/mongoose'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { ScheduleModule } from '@nestjs/schedule'
import * as Joi from 'joi'
import { Connection } from 'mongoose'

import { CommonModule } from './common/common.module'
import { SharedModule } from './shared/shared.module'
import { DatabaseModule } from './database/database.module'
import { AuthModule } from './modules/auth/auth.module'
import { UsersModule } from './modules/users/users.module'
import { DevelopersModule } from './modules/developers/developers.module'
import { OrganizationsModule } from './modules/organizations/organizations.module'
import { WebhooksModule } from './modules/webhooks/webhooks.module'
import { AzureModule } from './shared/azure/azure.module'
import { AIAnalysisModule } from './modules/ai-analysis/ai-analysis.module'
import { PrEffortModule } from './modules/pr-effort/pr-effort.module'
import { AnalyticsModule } from './modules/analytics/analytics.module'
import { JwtAuthGuard } from './common/guards/jwt-auth.guard'
import { RolesGuard } from './common/guards/roles.guard'

import appConfig from './config/app.config'
import databaseConfig from './config/database.config'
import jwtConfig from './config/jwt.config'
import azureConfig from './config/azure.config'
import aiConfig from './config/ai.config'

@Module({
  imports: [
    // ── Global config ────────────────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, jwtConfig, azureConfig, aiConfig],
      validationSchema: Joi.object({
        NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
        PORT: Joi.number().default(3000),
        HOST: Joi.string().default('0.0.0.0'),
        FRONTEND_URL: Joi.string().uri().required(),

        MONGODB_URI: Joi.string().required(),
        MONGODB_DB_NAME: Joi.string().default('dev_analytics'),

        JWT_SECRET: Joi.string().min(32).required(),
        JWT_EXPIRATION: Joi.string().default('15m'),
        JWT_REFRESH_SECRET: Joi.string().min(32).required(),
        JWT_REFRESH_EXPIRATION: Joi.string().default('7d'),

        ENCRYPTION_KEY: Joi.string().min(16).required(),

        AZURE_ORG_URL: Joi.string().uri().required(),
        AZURE_PAT: Joi.string().required(),
        OPENAI_API_KEY: Joi.string().optional(),
        ANTHROPIC_API_KEY: Joi.string().optional(),
        AI_MODEL_PROVIDER: Joi.string()
          .valid('openai', 'anthropic', 'qwen', 'alibaba', 'custom')
          .default('openai'),
        AI_MODEL_NAME: Joi.string().default('qwen-plus'),
        AI_TEMPERATURE: Joi.number().min(0).max(2).default(0.1),
        ALIBABA_API_KEY: Joi.string().optional(),
        AI_CUSTOM_BASE_URL: Joi.string().uri().optional(),
      }),
      validationOptions: { allowUnknown: true, abortEarly: true },
    }),

    // ── MongoDB ──────────────────────────────────────────────────────────────
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('database.uri'),
        dbName: configService.get<string>('database.dbName'),
        serverSelectionTimeoutMS: 5000,
        connectionFactory: (connection: Connection) => {
          connection.on('connected', () => console.log('MongoDB connected'))
          connection.on('error', (err: Error) => console.error('MongoDB error:', err.message))
          connection.on('disconnected', () => console.warn('MongoDB disconnected — reconnecting'))
          return connection
        },
      }),
    }),

    // ── Events + Scheduler ───────────────────────────────────────────────────
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      newListener: false,
      removeListener: false,
      maxListeners: 20,
      verboseMemoryLeak: true,
      ignoreErrors: false,
    }),
    ScheduleModule.forRoot(),

    // ── Infrastructure ───────────────────────────────────────────────────────
    CommonModule,
    SharedModule,
    DatabaseModule,

    // ── Feature modules ──────────────────────────────────────────────────────
    AuthModule,
    UsersModule,
    DevelopersModule,
    OrganizationsModule,
    AzureModule,
    WebhooksModule,
    AIAnalysisModule,
    PrEffortModule,
    AnalyticsModule,
  ],
  providers: [
    // Global JWT guard — routes opt out with @Public()
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Global role guard — routes opt in with @Roles(...)
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
