module.exports = {
  apps: [
    {
      name: 'dev-analytics-api',
      script: 'dist/main.js',

      // Cluster mode — spawn one worker per logical CPU core
      instances: 'max',
      exec_mode: 'cluster',

      // Automatic restart on crash
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',

      // Graceful shutdown — give in-flight requests time to drain
      kill_timeout: 10000,
      listen_timeout: 8000,
      shutdown_with_message: true,

      // Env vars injected for production — .env is NOT loaded by PM2;
      // set these in the deployment environment or use a secrets manager.
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '0.0.0.0',
      },

      env_development: {
        NODE_ENV: 'development',
        PORT: 3000,
        HOST: '0.0.0.0',
      },

      // Logging
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
}
