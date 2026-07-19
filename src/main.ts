import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import fastifyHelmet from '@fastify/helmet'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  )

  const configService = app.get(ConfigService)

  // Configure BEFORE init() so routes are registered with the prefix applied.
  const frontendUrl = configService.get<string>('app.frontendUrl')
  app.enableCors({
    origin: frontendUrl,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })

  app.setGlobalPrefix('api/v1')

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  )

  // Explicit init() registers routes (with prefix) AND lets NestJS add its
  // own JSON content-type parser — which we then swap out below.
  await app.init()

  // Swap NestJS's JSON parser for one that also stashes the raw buffer so
  // the webhooks module can verify HMAC signatures.
  const fastifyInstance = app.getHttpAdapter().getInstance()
  fastifyInstance.removeContentTypeParser('application/json')
  fastifyInstance.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    function (req: any, body: Buffer, done: (err: Error | null, payload?: any) => void) {
      ;(req as any).rawBody = body
      try {
        const parsed = JSON.parse(body.toString('utf8'))
        done(null, parsed)
      } catch (err) {
        done(err as Error)
      }
    },
  )

  // Security headers — register after init so the Fastify plugin system
  // is fully bootstrapped before we add a global plugin.
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        scriptSrc: ["'self'"],
      },
    },
  })

  const port = configService.get<number>('app.port') ?? 3000
  const host = configService.get<string>('app.host') ?? '0.0.0.0'

  // listen() skips init since we already called it explicitly above.
  await app.listen(port, host)
  console.log(`DevAnalytics API listening on http://${host}:${port}/api/v1`)
}

bootstrap()
