import { registerAs } from '@nestjs/config'

export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  host: process.env.HOST ?? '0.0.0.0',
  frontendUrl: process.env.FRONTEND_URL,
}))
