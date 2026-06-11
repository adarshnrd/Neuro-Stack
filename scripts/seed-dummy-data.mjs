#!/usr/bin/env node
/**
 * Standalone dummy data seeder — NOT part of the application codebase.
 *
 * Populates MongoDB with ~1 month of realistic developer activity across
 * 60 developers and 8 repositories so charts, leaderboards, and analytics
 * components (including Daily Analytics estimated-vs-reported hours) render
 * with meaningful high-load data.
 *
 * Data model (current architecture):
 *   • organizations — connected Azure DevOps organizations (multi-org hierarchy)
 *   • projects      — Azure DevOps projects under an organization
 *   • repositories  — Git repos under a project
 *   • teams         — developer team groupings under an organization
 *   • sprints       — Azure iterations/sprints under a project
 *   • developers  — tracked Azure DevOps contributors (NOT portal users)
 *   • users       — admin/manager portal accounts only (seeded separately)
 *   • commits     — webhook-ingested commit records
 *   • aianalyses  — AI complexity/efficiency scores per commit
 *   • dailysummaries   — aggregated daily developer activity
 *   • monthlysummaries — rolled-up monthly developer activity
 *   • pullrequests — webhook-ingested PR records
 *   • workitems   — webhook-ingested Azure Boards work items
 *
 * Collections seeded:
 *   organizations · projects · repositories · teams · sprints
 *   developers · commits · aianalyses · dailysummaries · monthlysummaries
 *   pullrequests · workitems · preffortanalyses
 *
 * Usage (run from project root):
 *   node scripts/seed-dummy-data.mjs
 *   node scripts/seed-dummy-data.mjs --clean    # wipe seed data first, then re-seed
 *
 * Requires MONGODB_URI (and optionally ENCRYPTION_KEY) in .env at project root.
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createHash, createCipheriv, randomBytes } from 'crypto'
import mongoose from 'mongoose'

// ── Minimal .env loader (no dotenv dependency needed) ─────────────────────────

const __dir = dirname(fileURLToPath(import.meta.url))

function loadEnv(filepath) {
  try {
    for (const line of readFileSync(filepath, 'utf8').split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq === -1) continue
      const k = t.slice(0, eq).trim()
      const v = t
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, '')
      if (!process.env[k]) process.env[k] = v
    }
  } catch {
    /* .env absent — rely on pre-set env */
  }
}

loadEnv(resolve(__dir, '..', '.env'))

// ── Config ────────────────────────────────────────────────────────────────────

const MONGODB_URI = process.env.MONGODB_URI
const DB_NAME = process.env.MONGODB_DB_NAME ?? 'dev_analytics'
const ENC_KEY = process.env.ENCRYPTION_KEY
const TZ_OFFSET_MINUTES = Number(process.env.ANALYTICS_TZ_OFFSET_MINUTES ?? 330)
const CLEAN = process.argv.includes('--clean')

if (!MONGODB_URI) {
  console.error('❌  MONGODB_URI not set in .env')
  process.exit(1)
}

const { Types } = mongoose
const ObjectId = Types.ObjectId

// ── Utilities ─────────────────────────────────────────────────────────────────

const rand = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo
const randF = (lo, hi, dp = 1) => +(Math.random() * (hi - lo) + lo).toFixed(dp)
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
const shuffle = (arr) => {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(0, i)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
const isWeekday = (d) => d.getDay() !== 0 && d.getDay() !== 6
/** Reporting-tz day key — matches backend todayKey()/dayKey() (default IST). */
const dayKey = (d) => {
  const shifted = new Date(d.getTime() + TZ_OFFSET_MINUTES * 60_000)
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`
}
const monthKey = (d) => dayKey(d).slice(0, 7)
const addDays = (d, n) => {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function encryptValue(text) {
  const key = createHash('sha256').update(ENC_KEY).digest()
  const iv = randomBytes(16)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()])
  const tag = c.getAuthTag()
  return Buffer.concat([iv, enc, tag]).toString('hex')
}

function encryptName(text) {
  if (!ENC_KEY) return undefined
  return encryptValue(text)
}

// ── Static reference data ─────────────────────────────────────────────────────

const PROJECT = { id: 'proj-devanalytics-001', name: 'DevAnalytics' }

const REPOS = [
  {
    id: 'repo-frontend-001',
    name: 'devanalytics-frontend',
    langs: ['TypeScript', 'CSS', 'HTML', 'JavaScript'],
  },
  { id: 'repo-api-002', name: 'devanalytics-api', langs: ['TypeScript'] },
  { id: 'repo-infra-003', name: 'devanalytics-infra', langs: ['YAML', 'Shell', 'HCL'] },
  { id: 'repo-libs-004', name: 'devanalytics-shared-libs', langs: ['TypeScript', 'JavaScript'] },
  {
    id: 'repo-mobile-005',
    name: 'devanalytics-mobile',
    langs: ['TypeScript', 'Swift', 'Kotlin'],
  },
  {
    id: 'repo-testing-006',
    name: 'devanalytics-testing',
    langs: ['TypeScript', 'JavaScript'],
  },
  {
    id: 'repo-data-007',
    name: 'devanalytics-data-pipeline',
    langs: ['Python', 'SQL', 'TypeScript'],
  },
  {
    id: 'repo-cicd-008',
    name: 'devanalytics-ci-cd',
    langs: ['YAML', 'Shell', 'Python'],
  },
]

const FILE_PATHS = {
  'devanalytics-frontend': [
    'src/app/(protected)/dashboard/page.tsx',
    'src/app/(protected)/analytics/daily/page.tsx',
    'src/app/(protected)/analytics/monthly/page.tsx',
    'src/app/(protected)/developer/[id]/page.tsx',
    'src/components/charts/MonthlyBarChart.tsx',
    'src/components/charts/TeamActivityChart.tsx',
    'src/components/charts/EfficiencyGauge.tsx',
    'src/components/charts/LinesOfCodeChart.tsx',
    'src/components/dashboard/KpiCard.tsx',
    'src/components/dashboard/ActivityFeed.tsx',
    'src/components/layout/Sidebar.tsx',
    'src/components/layout/TopHeader.tsx',
    'src/hooks/useOrgAnalytics.ts',
    'src/hooks/useDeveloperStats.ts',
    'src/lib/api-client.ts',
    'src/lib/auth.config.ts',
    'src/store/auth.store.ts',
    'src/store/ui.store.ts',
    'src/types/analytics.types.ts',
    'src/app/(auth)/signin/page.tsx',
    'src/styles/globals.css',
    'tailwind.config.ts',
    'next.config.ts',
  ],
  'devanalytics-api': [
    'src/modules/auth/auth.service.ts',
    'src/modules/auth/auth.controller.ts',
    'src/modules/analytics/analytics.service.ts',
    'src/modules/analytics/analytics.controller.ts',
    'src/modules/analytics/crons/daily-summary.cron.ts',
    'src/modules/analytics/crons/monthly-summary.cron.ts',
    'src/modules/users/users.service.ts',
    'src/modules/users/users.controller.ts',
    'src/modules/developers/developers.service.ts',
    'src/modules/developers/developers.controller.ts',
    'src/modules/webhooks/webhooks.service.ts',
    'src/modules/webhooks/webhooks.controller.ts',
    'src/modules/ai-analysis/ai-analysis.service.ts',
    'src/database/schemas/commit.schema.ts',
    'src/database/schemas/developer.schema.ts',
    'src/database/schemas/daily-summary.schema.ts',
    'src/database/schemas/monthly-summary.schema.ts',
    'src/common/guards/jwt-auth.guard.ts',
    'src/shared/encryption/encryption.service.ts',
    'src/main.ts',
  ],
  'devanalytics-infra': [
    'docker-compose.yml',
    'docker-compose.prod.yml',
    'k8s/deployment.yaml',
    'k8s/service.yaml',
    'k8s/ingress.yaml',
    'k8s/hpa.yaml',
    'scripts/deploy.sh',
    'scripts/rollback.sh',
    'terraform/main.tf',
    'terraform/variables.tf',
    'terraform/outputs.tf',
    'nginx/nginx.conf',
    '.github/workflows/ci.yml',
    '.github/workflows/deploy.yml',
    'monitoring/prometheus.yml',
    'monitoring/grafana-dashboard.json',
    'monitoring/alerts.yml',
  ],
  'devanalytics-shared-libs': [
    'src/types/api.types.ts',
    'src/types/commit.types.ts',
    'src/types/analytics.types.ts',
    'src/types/user.types.ts',
    'src/utils/date.utils.ts',
    'src/utils/encryption.utils.ts',
    'src/utils/pagination.utils.ts',
    'src/constants/index.ts',
    'src/validators/email.ts',
    'src/validators/schema.ts',
  ],
  'devanalytics-mobile': [
    'src/screens/DashboardScreen.tsx',
    'src/screens/DeveloperProfileScreen.tsx',
    'src/screens/LeaderboardScreen.tsx',
    'src/screens/AnalyticsScreen.tsx',
    'src/components/charts/MobileBarChart.tsx',
    'src/components/MetricCard.tsx',
    'src/components/ActivityList.tsx',
    'src/navigation/AppNavigator.tsx',
    'src/navigation/TabNavigator.tsx',
    'src/services/api.service.ts',
    'src/store/app.store.ts',
    'src/hooks/useAnalyticsData.ts',
    'ios/DevAnalytics.xcodeproj/project.pbxproj',
    'android/app/build.gradle',
    'android/app/src/main/AndroidManifest.xml',
  ],
  'devanalytics-testing': [
    'e2e/auth.spec.ts',
    'e2e/dashboard.spec.ts',
    'e2e/analytics.spec.ts',
    'e2e/developer-profile.spec.ts',
    'unit/auth.service.spec.ts',
    'unit/analytics.service.spec.ts',
    'unit/webhook.processor.spec.ts',
    'unit/daily-summary.spec.ts',
    'unit/encryption.service.spec.ts',
    'integration/api.spec.ts',
    'integration/webhooks.spec.ts',
    'fixtures/mock-commits.ts',
    'fixtures/mock-developers.ts',
    'fixtures/mock-summaries.ts',
    'helpers/test-utils.ts',
    'helpers/db-helper.ts',
    'playwright.config.ts',
    'jest.config.ts',
  ],
  'devanalytics-data-pipeline': [
    'pipelines/commit_aggregator.py',
    'pipelines/daily_summary.py',
    'pipelines/monthly_rollup.py',
    'pipelines/ai_enrichment.py',
    'sql/create_tables.sql',
    'sql/analytics_views.sql',
    'sql/performance_indexes.sql',
    'sql/backfill_summaries.sql',
    'scripts/export_to_csv.py',
    'scripts/backfill_summaries.py',
    'scripts/validate_data.py',
    'models/commit_model.py',
    'models/developer_model.py',
    'models/summary_model.py',
    'utils/db_connection.py',
    'utils/date_helpers.py',
    'utils/metrics.py',
    'config/pipeline.yaml',
  ],
  'devanalytics-ci-cd': [
    '.github/workflows/main-ci.yml',
    '.github/workflows/deploy-staging.yml',
    '.github/workflows/deploy-production.yml',
    '.github/workflows/dependency-review.yml',
    '.github/workflows/security-scan.yml',
    'jenkins/Jenkinsfile',
    'jenkins/Jenkinsfile.release',
    'scripts/health-check.sh',
    'scripts/smoke-test.sh',
    'scripts/db-migrate.sh',
    'k8s/helm/Chart.yaml',
    'k8s/helm/values.yaml',
    'k8s/helm/values.staging.yaml',
    'k8s/helm/values.production.yaml',
    'k8s/helm/templates/deployment.yaml',
    'k8s/helm/templates/service.yaml',
  ],
}

const BRANCHES = [
  'main',
  'develop',
  'staging',
  'feature/auth-module',
  'feature/analytics-dashboard',
  'feature/ai-analysis',
  'feature/webhook-processor',
  'feature/developer-profile',
  'feature/leaderboard',
  'feature/mobile-app',
  'feature/data-pipeline',
  'feature/role-based-access',
  'feature/csv-export',
  'feature/work-item-tracking',
  'feature/pr-analytics',
  'fix/token-refresh',
  'fix/date-timezone',
  'fix/cors-config',
  'fix/null-chart-data',
  'fix/webhook-retry',
  'fix/memory-leak',
  'fix/pagination-offset',
  'refactor/api-client',
  'refactor/analytics-service',
  'refactor/shared-types',
  'chore/bump-deps',
  'chore/update-tsconfig',
  'perf/optimize-queries',
  'perf/bundle-size',
  'test/auth-coverage',
]

const COMMIT_MESSAGES = [
  'feat: add user authentication flow with JWT rotation',
  'fix: resolve token refresh race condition on concurrent requests',
  'refactor: extract shared utility functions into common module',
  'test: add unit tests for auth service with mock providers',
  'docs: update API endpoint documentation with examples',
  'chore: bump dependencies to latest stable versions',
  'feat: implement dashboard KPI cards with live data',
  'fix: correct date timezone handling in summary aggregation',
  'style: apply consistent code formatting across service layer',
  'perf: optimize MongoDB aggregation pipeline for analytics',
  'feat: add developer analytics endpoint with pagination',
  'fix: handle null values in chart data rendering',
  'feat: implement webhook event processing with HMAC verification',
  'refactor: split analytics service into domain-specific modules',
  'fix: resolve CORS preflight issue for cross-origin requests',
  'feat: add monthly summary aggregation with cron schedule',
  'test: add integration tests for analytics endpoints',
  'fix: correct efficiency score calculation formula',
  'feat: implement access + refresh token rotation strategy',
  'refactor: improve global error handling middleware',
  'feat: add AI analysis for commit complexity scoring',
  'fix: prevent duplicate commit processing on webhook retry',
  'feat: add leaderboard component with sorting controls',
  'chore: update tsconfig for strict mode compliance',
  'fix: resolve hydration mismatch on initial page load',
  'feat: add skeleton loading states for async components',
  'perf: lazy-load chart library to reduce initial bundle size',
  'fix: correct PR merge status tracking in daily aggregation',
  'feat: link work items to commits via webhook payload',
  'refactor: move type definitions to shared module',
  'feat: implement developer profile page with activity heatmap',
  'fix: guard against empty datasets in bar chart renderer',
  'feat: add CSV export for monthly analytics report',
  'fix: handle expired refresh tokens gracefully on 401',
  'feat: add role-based access guard for admin endpoints',
  'refactor: replace any types with proper interfaces',
  'fix: correct sprint name extraction from Azure path',
  'feat: add PR review tracking to daily summary',
  'perf: add compound index for developer + date queries',
  'fix: resolve memory leak in event emitter registration',
  'feat: implement team performance comparison chart',
  'fix: pagination returns incorrect total count on filter',
  'feat: add mobile app dashboard screen',
  'test: add e2e tests for dashboard page with Playwright',
  'fix: correct efficiency gauge rendering on null score',
  'feat: implement data pipeline for monthly rollup',
  'chore: configure ESLint strict rules for all modules',
  'perf: add Redis cache layer for org overview endpoint',
  'fix: webhook signature verification fails on retried events',
  'feat: add developer activity heatmap to profile page',
  'refactor: consolidate date utility functions',
  'fix: sort order incorrect in team comparison chart',
  'feat: implement sprint-based work item tracking',
  'test: add unit tests for data pipeline aggregators',
  'fix: monthly summary misses last day of month commits',
  'feat: add AI-generated commit summaries to PR view',
  'perf: batch insert commits to reduce write latency',
  'fix: login redirect loop on session expiry',
  'feat: add org-wide commit heatmap component',
  'refactor: decouple webhook processor from analytics service',
]

const AI_SUMMARIES = [
  'Implements JWT-based authentication with bcrypt-hashed refresh token rotation for secure stateless sessions.',
  'Resolves a concurrency bug in the token refresh flow that caused intermittent 401 errors under load.',
  'Extracts reusable utility functions from service layer into a dedicated shared module, reducing duplication.',
  'Adds test coverage for the authentication service using Jest mock providers; all edge cases covered.',
  'Optimises MongoDB aggregation pipeline with compound indexes, reducing P95 query time significantly.',
  'Introduces HMAC verification for incoming Azure DevOps webhook payloads using raw body capture.',
  'Implements lazy-loaded chart components via next/dynamic to reduce initial JavaScript bundle size.',
  'Fixes date serialisation to ensure UTC handling across summary aggregation and timezone display.',
  'Adds AI-driven complexity scoring per commit using LLM integration with structured output parsing.',
  'Implements skeleton loading states for all protected routes, eliminating layout shift on navigation.',
  'Adds monthly aggregation cron job that rolls up daily summaries for each developer at midnight.',
  'Refactors the analytics service to separate org-level and developer-level concerns into distinct providers.',
  'Corrects efficiency score formula to weight lines changed against estimated effort hours from AI analysis.',
  'Links work item IDs from webhook payload to commit records for traceability across the dev pipeline.',
  'Implements refresh token rotation: each use issues a new pair, invalidating the previous one.',
  'Adds compound index on developerAzureId + date fields, cutting summary query time from 400ms to 18ms.',
  'Introduces Redis caching layer for org overview endpoint, reducing average response time by 65%.',
  'Adds Playwright e2e tests covering auth flow, dashboard render, and chart interactivity.',
  'Extracts shared TypeScript types into a standalone library consumed by both frontend and API.',
  'Implements role-based access control guards restricting admin endpoints to manager and admin roles.',
  'Adds CSV export endpoint that streams monthly analytics data without buffering the full dataset.',
  'Implements webhook deduplication using a processed event hash map, preventing double-counting on retry.',
  'Optimises the team comparison chart to cap at 12 developers and sort by total line changes.',
  'Adds developer profile page with 30-day commit activity sparkline and efficiency trend chart.',
  'Implements data pipeline for nightly monthly rollup with idempotent upsert semantics.',
]

const COMPLEXITY_LEVELS = [
  'low',
  'low',
  'low',
  'medium',
  'medium',
  'medium',
  'high',
  'high',
  'very-high',
]
const CHANGE_TYPES = ['modify', 'modify', 'modify', 'add', 'add', 'delete', 'rename']

const PR_TITLES = [
  'feat: implement JWT authentication module',
  'fix: resolve token expiry edge case on refresh',
  'feat: add dashboard analytics charts and KPIs',
  'refactor: improve global error handling',
  'feat: add AI commit complexity analysis',
  'fix: correct date range filtering in analytics',
  'feat: implement Azure DevOps webhook processor',
  'docs: add comprehensive API usage examples',
  'feat: add developer leaderboard with ranking',
  'fix: resolve CORS preflight configuration',
  'feat: implement monthly summary aggregation',
  'perf: optimise MongoDB aggregation pipeline',
  'feat: add skeleton loading for async pages',
  'fix: guard against XSS in user-supplied input',
  'feat: implement refresh token rotation',
  'fix: handle empty analytics datasets gracefully',
  'feat: add work item progress tracking',
  'chore: upgrade all dependencies to latest',
  'feat: implement CSV analytics export',
  'feat: add developer profile activity heatmap',
  'fix: correct efficiency score calculation',
  'feat: implement role-based access control',
  'refactor: split analytics into domain services',
  'fix: resolve memory leak in event emitter',
  'feat: link commits to work items via webhooks',
  'feat: add Redis caching for org overview',
  'fix: pagination total count off by one',
  'feat: implement PR review tracking dashboard',
  'test: add e2e suite for auth and dashboard',
  'feat: add mobile app initial screens',
  'fix: webhook deduplication on retry events',
  'perf: batch commit inserts with bulk write',
  'feat: add sprint-based work item grouping',
  'fix: monthly rollup misses last day commits',
  'feat: implement data pipeline nightly job',
  'refactor: consolidate date utility functions',
  'fix: team comparison chart sort order wrong',
  'feat: add org-wide commit heatmap',
  'fix: login redirect loop on session expiry',
  'feat: add AI summaries to PR detail view',
  'chore: configure ESLint strict rules',
  'feat: add compound indexes for performance',
  'fix: chart hydration mismatch on SSR',
  'feat: add Playwright e2e test suite',
  'fix: null pointer in monthly summary query',
  'feat: add developer efficiency trend chart',
  'refactor: decouple webhook from analytics',
  'fix: PR merge date off by one timezone',
  'feat: add team activity stacked bar chart',
  'chore: add Dockerfile for production build',
]

const WORK_TITLES = [
  'Implement JWT authentication module',
  'Fix token refresh race condition',
  'Build dashboard analytics components',
  'Integrate Azure DevOps webhooks',
  'Set up CI/CD pipeline on GitHub Actions',
  'Implement developer leaderboard',
  'Add AI commit analysis service',
  'Fix CORS configuration for cross-origin requests',
  'Optimise MongoDB aggregation queries',
  'Implement monthly summary scheduled job',
  'Add skeleton loading states to all pages',
  'Write unit tests for authentication service',
  'Document all REST API endpoints',
  'Implement CSV data export feature',
  'Add work item progress tracking',
  'Fix date timezone handling in summaries',
  'Refactor shared utility functions',
  'Implement refresh token rotation strategy',
  'Build developer profile page',
  'Set up monitoring and alerting dashboards',
  'Fix hydration mismatch on login page',
  'Add PR review tracking to daily summary',
  'Implement role-based access control guards',
  'Add email notification system',
  'Optimise frontend JavaScript bundle size',
  'Fix null values in chart data rendering',
  'Build commit file diff viewer component',
  'Implement sprint planning view',
  'Add team performance metrics dashboard',
  'Fix logout flow edge case on token expiry',
  'Integrate LangChain for commit summarisation',
  'Add compound MongoDB indexes for performance',
  'Implement webhook HMAC signature verification',
  'Migrate configuration to environment-based config',
  'Add end-to-end tests for auth flow',
  'Implement developer activity heatmap chart',
  'Fix race condition in concurrent webhook processing',
  'Add avatar upload to developer profile',
  'Create shared types library package',
  'Implement PR merge tracking analytics',
  'Add Redis caching layer for API endpoints',
  'Fix pagination total count calculation',
  'Build mobile app dashboard screen',
  'Add Playwright e2e test suite setup',
  'Implement data pipeline nightly aggregation job',
  'Fix webhook duplicate event processing',
  'Optimise batch commit insert performance',
  'Build sprint-based work item grouping UI',
  'Fix monthly rollup missing last-day commits',
  'Add org-wide commit activity heatmap',
  'Implement AI commit summaries in PR view',
  'Configure ESLint strict mode across all modules',
  'Add developer efficiency trend chart',
  'Implement team comparison horizontal bar chart',
  'Add Dockerfile for production container build',
  'Fix chart SSR hydration mismatch',
  'Implement compound indexes for daily queries',
  'Decouple webhook processor from analytics service',
  'Fix timezone offset in PR merge date tracking',
  'Build team activity stacked bar chart',
  'Add status page for system health monitoring',
  'Implement Grafana dashboard for API metrics',
  'Set up Prometheus metrics collection',
  'Add rate limiting to public API endpoints',
  'Implement request tracing with OpenTelemetry',
  'Refactor error handling into unified middleware',
  'Build notification centre for alert events',
  'Add dark mode theme toggle to frontend',
  'Implement search and filter for developer list',
  'Build org-level KPI summary report',
  'Add CSV import for bulk user onboarding',
]

const SPRINT_NAMES = ['Sprint 1', 'Sprint 2', 'Sprint 3', 'Sprint 4', 'Sprint 5', 'Sprint 6']

// Identifies the seeded organization so --clean can find & cascade-delete it
const SEED_ORG_URL = 'https://dev.azure.com/devanalytics-seed-org'

// ── Developer name pools for generating 100 developers ───────────────────────

const FIRST_NAMES = [
  'Alex', 'Jordan', 'Morgan', 'Taylor', 'Casey', 'Riley', 'Quinn', 'Avery', 'Logan', 'Drew',
  'Priya', 'Arjun', 'Rahul', 'Neha', 'Vikram', 'Kavya', 'Sanjay', 'Anjali', 'Deepa', 'Riya',
  'Mei', 'Wei', 'Jin', 'Yang', 'Min', 'Ling', 'Peng', 'Rui', 'Zhi', 'Lin',
  'Hiroshi', 'Yuki', 'Kenji', 'Akira', 'Haruto',
  'Ahmad', 'Fatima', 'Omar', 'Layla', 'Hassan',
  'Ivan', 'Olga', 'Carlos', 'Maria', 'Jorge', 'Elena', 'Amara', 'Kofi', 'Luca', 'Sofia',
]

const LAST_NAMES = [
  'Chen', 'Johnson', 'Williams', 'Patel', 'OBrien', 'Sharma', 'Kim', 'Anderson', 'Smith', 'Brown',
  'Davis', 'Wilson', 'Martinez', 'Garcia', 'Rodriguez', 'Lee', 'Zhang', 'Wang', 'Liu', 'Singh',
  'Kumar', 'Gupta', 'Nakamura', 'Tanaka', 'Yamamoto',
  'Hassan', 'Ali', 'Khan', 'Ahmed',
  'Mueller', 'Schmidt', 'Schneider', 'Fischer', 'Weber',
  'Rossi', 'Ferrari', 'Romano', 'Nguyen', 'Tran',
  'Dubois', 'Martin', 'Bernard', 'Thomas', 'Robert', 'Kowalski', 'Novak', 'Petrov', 'Sato', 'Park', 'Reyes',
]

// 8 teams, 60 devs total: counts sum to 60
const TEAM_CONFIGS = [
  { team: 'Frontend',       count: 11, repoIdxs: [0, 3], rateMin: 0.72, rateMax: 0.95 },
  { team: 'Backend',        count: 11, repoIdxs: [1, 3], rateMin: 0.70, rateMax: 0.93 },
  { team: 'Fullstack',      count:  9, repoIdxs: [0, 1], rateMin: 0.68, rateMax: 0.90 },
  { team: 'Infrastructure', count:  6, repoIdxs: [2, 7], rateMin: 0.60, rateMax: 0.85 },
  { team: 'QA',             count:  7, repoIdxs: [5, 3], rateMin: 0.68, rateMax: 0.92 },
  { team: 'DevOps',         count:  6, repoIdxs: [7, 2], rateMin: 0.58, rateMax: 0.83 },
  { team: 'Mobile',         count:  6, repoIdxs: [4, 3], rateMin: 0.65, rateMax: 0.90 },
  { team: 'Data',           count:  4, repoIdxs: [6, 1], rateMin: 0.62, rateMax: 0.88 },
]

// Generate 100 developers from the name pools
const DEVELOPERS = []
let _devSeq = 0

for (const cfg of TEAM_CONFIGS) {
  for (let i = 0; i < cfg.count; i++) {
    const firstIdx = _devSeq % FIRST_NAMES.length
    const lastIdx =
      _devSeq < FIRST_NAMES.length
        ? (_devSeq + 7) % LAST_NAMES.length
        : ((_devSeq % LAST_NAMES.length) + 31) % LAST_NAMES.length
    const firstName = FIRST_NAMES[firstIdx]
    const lastName = LAST_NAMES[lastIdx]
    const num = _devSeq + 1
    const emailLocal = `${firstName.toLowerCase().replace(/[^a-z]/g, '')}${num}.${lastName.toLowerCase().replace(/[^a-z]/g, '')}`
    const rate = +(
      cfg.rateMin +
      (i / Math.max(cfg.count - 1, 1)) * (cfg.rateMax - cfg.rateMin)
    ).toFixed(2)

    DEVELOPERS.push({
      azureId: `azure-dev-${String(num).padStart(3, '0')}`,
      name: `${firstName} ${lastName}`,
      email: `${emailLocal}@mindpathtech.com`,
      team: cfg.team,
      repoIdxs: cfg.repoIdxs,
      rate,
    })
    _devSeq++
  }
}

// ── Date range: last ~30 calendar days (reporting TZ), always including today ──

const TODAY = new Date()
const todayDateStr = dayKey(TODAY)

const START = addDays(TODAY, -29)
START.setHours(0, 0, 0, 0)

// Always include TODAY even if it falls on a weekend
const WORKDAYS = []
for (let d = new Date(START); d <= TODAY; d = addDays(d, 1)) {
  if (isWeekday(d) || dayKey(d) === todayDateStr) WORKDAYS.push(new Date(d))
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const safeUri = MONGODB_URI.replace(/\/\/([^:]+):([^@]+)@/, '//<credentials>@')
  console.log('\n🌱  DevAnalytics Dummy Data Seeder')
  console.log(`   DB      : ${DB_NAME}  @  ${safeUri}`)
  console.log(
    `   Range   : ${dayKey(START)} → ${todayDateStr}  (${WORKDAYS.length} workdays, today always included, TZ offset ${TZ_OFFSET_MINUTES}m)`,
  )
  console.log(`   Devs    : ${DEVELOPERS.length}  across ${TEAM_CONFIGS.length} teams`)
  console.log(`   Repos   : ${REPOS.length}`)
  console.log(`   --clean : ${CLEAN}\n`)

  await mongoose.connect(MONGODB_URI, { dbName: DB_NAME })
  console.log('✓  MongoDB connected')

  const db = mongoose.connection.db
  const orgsColl       = db.collection('organizations')
  const projectsColl   = db.collection('projects')
  const reposColl      = db.collection('repositories')
  const teamsColl      = db.collection('teams')
  const sprintsColl    = db.collection('sprints')
  const developersColl = db.collection('developers')   // ← tracked contributors (NOT portal users)
  const commitsColl    = db.collection('commits')
  const dailyColl      = db.collection('dailysummaries')
  const monthlyColl    = db.collection('monthlysummaries')
  const prColl         = db.collection('pullrequests')
  const worksColl      = db.collection('workitems')
  const aiColl         = db.collection('aianalyses')
  const prEffortColl   = db.collection('preffortanalyses')

  // ── Optional clean ──────────────────────────────────────────────────────────

  if (CLEAN) {
    console.log('\n🗑️   Removing existing seed data...')
    const azureIds = DEVELOPERS.map((d) => d.azureId)
    const [c1, c2, c3, c4, c5, c6, c7, c8] = await Promise.all([
      developersColl.deleteMany({ azureDevOpsId: { $in: azureIds } }),
      commitsColl.deleteMany({ authorAzureId: { $in: azureIds } }),
      dailyColl.deleteMany({ developerAzureId: { $in: azureIds } }),
      monthlyColl.deleteMany({ developerAzureId: { $in: azureIds } }),
      prColl.deleteMany({ authorAzureId: { $in: azureIds } }),
      worksColl.deleteMany({ projectName: PROJECT.name }),
      aiColl.deleteMany({ modelUsed: 'seed-gpt-4o-mini' }),
      prEffortColl.deleteMany({ authorAzureId: { $in: azureIds } }),
    ])
    console.log(
      `   removed: ${c1.deletedCount} developers, ${c2.deletedCount} commits, ` +
        `${c3.deletedCount} daily, ${c4.deletedCount} monthly, ${c5.deletedCount} prs, ` +
        `${c6.deletedCount} work items, ${c7.deletedCount} ai analyses, ` +
        `${c8.deletedCount} pr-effort`,
    )

    const seedOrg = await orgsColl.findOne({ orgUrl: SEED_ORG_URL })
    if (seedOrg) {
      const [h1, h2, h3, h4, h5] = await Promise.all([
        sprintsColl.deleteMany({ organizationId: seedOrg._id }),
        teamsColl.deleteMany({ organizationId: seedOrg._id }),
        reposColl.deleteMany({ organizationId: seedOrg._id }),
        projectsColl.deleteMany({ organizationId: seedOrg._id }),
        orgsColl.deleteMany({ _id: seedOrg._id }),
      ])
      console.log(
        `   removed: ${h5.deletedCount} organization, ${h4.deletedCount} projects, ` +
          `${h3.deletedCount} repositories, ${h2.deletedCount} teams, ${h1.deletedCount} sprints`,
      )
    }
  }

  // ── 1. Organization hierarchy (organizations → projects → repositories → teams → sprints) ──

  console.log('\n🏢  Seeding organization hierarchy...')

  let orgDoc = await orgsColl.findOne({ orgUrl: SEED_ORG_URL })
  if (!orgDoc) {
    const fakePat = 'seedfakepat0000000000000000000000devanalytics'
    const patEncrypted = encryptValue(fakePat)
    orgDoc = {
      _id: new ObjectId(),
      name: 'DevAnalytics (Seed)',
      clientName: 'DevAnalytics Internal',
      azureOrgSlug: 'devanalytics-seed-org',
      orgUrl: SEED_ORG_URL,
      patEncrypted,
      patLast4: fakePat.slice(-4),
      isActive: true,
      lastSyncedAt: new Date(),
      createdAt: new Date(START),
      updatedAt: new Date(),
    }
    await orgsColl.insertOne(orgDoc)
    console.log('✓  1 organization inserted')
  } else {
    console.log('   Organization already exists — skipped')
  }

  let projectDoc = await projectsColl.findOne({
    organizationId: orgDoc._id,
    azureProjectId: PROJECT.id,
  })
  if (!projectDoc) {
    projectDoc = {
      _id: new ObjectId(),
      organizationId: orgDoc._id,
      azureProjectId: PROJECT.id,
      name: PROJECT.name,
      description: 'DevAnalytics platform — seeded project',
      lastSyncedAt: new Date(),
      createdAt: new Date(START),
      updatedAt: new Date(),
    }
    await projectsColl.insertOne(projectDoc)
    console.log('✓  1 project inserted')
  } else {
    console.log('   Project already exists — skipped')
  }

  let repoCount = 0
  for (const repo of REPOS) {
    if (await reposColl.findOne({ azureRepoId: repo.id })) continue
    await reposColl.insertOne({
      organizationId: orgDoc._id,
      projectId: projectDoc._id,
      azureRepoId: repo.id,
      azureProjectId: PROJECT.id,
      name: repo.name,
      defaultBranch: 'main',
      webUrl: `${SEED_ORG_URL}/${PROJECT.name}/_git/${repo.name}`,
      lastSyncedAt: new Date(),
      createdAt: new Date(START),
      updatedAt: new Date(),
    })
    repoCount++
  }
  console.log(
    repoCount ? `✓  ${repoCount} repositories inserted` : '   Repositories already exist — skipped',
  )

  let teamCount = 0
  for (const cfg of TEAM_CONFIGS) {
    const azureTeamId = `azure-team-${cfg.team.toLowerCase()}`
    if (await teamsColl.findOne({ organizationId: orgDoc._id, azureTeamId })) continue
    const memberAzureIds = DEVELOPERS.filter((d) => d.team === cfg.team).map((d) => d.azureId)
    await teamsColl.insertOne({
      organizationId: orgDoc._id,
      azureTeamId,
      azureProjectId: PROJECT.id,
      name: cfg.team,
      memberAzureIds,
      createdAt: new Date(START),
      updatedAt: new Date(),
    })
    teamCount++
  }
  console.log(teamCount ? `✓  ${teamCount} teams inserted` : '   Teams already exist — skipped')

  let sprintCount = 0
  const sprintSpanMs = Math.floor((TODAY.getTime() - START.getTime()) / SPRINT_NAMES.length)
  for (let i = 0; i < SPRINT_NAMES.length; i++) {
    const name = SPRINT_NAMES[i]
    const path = `${PROJECT.name}\\${name}`
    if (await sprintsColl.findOne({ organizationId: orgDoc._id, projectId: projectDoc._id, path })) {
      continue
    }
    await sprintsColl.insertOne({
      organizationId: orgDoc._id,
      projectId: projectDoc._id,
      azureProjectId: PROJECT.id,
      teamId: undefined,
      name,
      path,
      startDate: new Date(START.getTime() + i * sprintSpanMs),
      endDate: new Date(START.getTime() + (i + 1) * sprintSpanMs),
      createdAt: new Date(START),
      updatedAt: new Date(),
    })
    sprintCount++
  }
  console.log(sprintCount ? `✓  ${sprintCount} sprints inserted` : '   Sprints already exist — skipped')

  // ── 2. Developers (tracked contributors — NOT portal users) ────────────────
  // Stored in `developers` collection, completely separate from `users`.
  // The analytics service resolves display names from here via DevelopersService.

  console.log('\n👤  Seeding developers...')
  const developerDocs = []

  for (const dev of DEVELOPERS) {
    if (await developersColl.findOne({ azureDevOpsId: dev.azureId })) continue
    const emailLower = dev.email.toLowerCase()
    developerDocs.push({
      azureDevOpsId: dev.azureId,
      email: emailLower,
      emailHash: createHash('sha256').update(emailLower).digest('hex'),
      displayName: dev.name,
      displayNameEncrypted: encryptName(dev.name),
      team: dev.team,
      isActive: true,
      lastSyncedAt: new Date(),
      createdAt: new Date(START),
      updatedAt: new Date(START),
    })
  }

  if (developerDocs.length) {
    await developersColl.insertMany(developerDocs)
    console.log(`✓  ${developerDocs.length} developers inserted`)
  } else {
    console.log('   All developers already exist — skipped')
  }

  // ── 3. Commits + AI analyses (with running daily/monthly accumulators) ──────

  console.log('\n🔀  Building pull requests (in memory, before commits)...')

  const prDocs = []
  const prsByDev = new Map()
  let prSeq = 9000

  for (let di = 0; di < DEVELOPERS.length; di++) {
    const dev = DEVELOPERS[di]
    const numPrs = rand(5, 9)
    const devPrs = []

    for (let p = 0; p < numPrs; p++) {
      const title = PR_TITLES[(di * 7 + p) % PR_TITLES.length]
      const repoIdx = pick(dev.repoIdxs)
      const repo = REPOS[repoIdx]

      // First two PRs per developer are active today; others spread across the month.
      const createdToday = p < 2
      const createdAt = createdToday
        ? new Date(TODAY)
        : new Date(WORKDAYS[rand(0, Math.max(WORKDAYS.length - 2, 0))])
      createdAt.setHours(rand(9, 17), rand(0, 59), 0, 0)

      const roll = Math.random()
      const status = createdToday
        ? 'active'
        : roll > 0.22
          ? 'completed'
          : roll > 0.08
            ? 'active'
            : 'abandoned'
      const mergedAt =
        status === 'completed'
          ? new Date(createdAt.getTime() + rand(1800, 172800) * 1000)
          : undefined

      const reviewerDev =
        DEVELOPERS.find((d) => d.team === dev.team && d.azureId !== dev.azureId) ??
        DEVELOPERS[(di + 1) % DEVELOPERS.length]

      // Today's PRs almost always have a work item (needed for reported hours).
      const workItemIds =
        createdToday || Math.random() > 0.18 ? [rand(1001, 1300)] : []

      const prDoc = {
        _id: new ObjectId(),
        azurePrId: `azure-pr-${String(prSeq++).padStart(5, '0')}`,
        repositoryId: repo.id,
        repositoryName: repo.name,
        projectId: PROJECT.id,
        projectName: PROJECT.name,
        authorAzureId: dev.azureId,
        authorName: dev.name,
        title,
        description: 'Addresses the changes described in the linked work items.',
        status,
        sourceBranch: pick(BRANCHES.filter((b) => b !== 'main')),
        targetBranch: 'main',
        commitIds: [],
        workItemIds,
        reviewers: [
          {
            azureId: reviewerDev.azureId,
            displayName: reviewerDev.name,
            vote: status === 'completed' ? 10 : pick([0, 5, 10, -5]),
          },
        ],
        isDraft: false,
        completedAt: mergedAt,
        mergedAt,
        createdAt,
        updatedAt: mergedAt ?? createdAt,
      }

      prDocs.push(prDoc)
      devPrs.push(prDoc)
    }

    prsByDev.set(dev.azureId, devPrs)
  }

  console.log(`   ${prDocs.length.toLocaleString()} PRs prepared`)

  // ── 3. Commits + AI analyses (with running daily/monthly accumulators) ──────

  console.log('\n📝  Building commits and AI analyses...')
  console.log(`   (${DEVELOPERS.length} developers × ~${WORKDAYS.length} workdays)`)

  const dayAcc = {}
  const monAcc = {}
  const prActiveDates = new Map()
  const prCommitCounts = new Map()

  function acc(map, key, azureId, ds, isMonth = false) {
    if (!map[key])
      map[key] = {
        developerAzureId: azureId,
        [isMonth ? 'month' : 'date']: ds,
        totalCommits: 0,
        totalLinesAdded: 0,
        totalLinesRemoved: 0,
        totalFilesChanged: 0,
        repos: new Set(),
        scores: [],
        totalEstimatedHours: 0,
        totalActualHours: 0,
        prCreated: 0,
        prMerged: 0,
        workItemsCompleted: 0,
      }
    return map[key]
  }

  const bumpPrDay = (prId, ds) => {
    if (!prActiveDates.has(prId)) prActiveDates.set(prId, new Set())
    prActiveDates.get(prId).add(ds)
  }

  const commitDocs = []
  const aiDocs = []
  let commitSeq = 10000

  for (const day of WORKDAYS) {
    const ds = dayKey(day)
    const ms = monthKey(day)
    const isToday = ds === todayDateStr

    for (const dev of DEVELOPERS) {
      const effectiveRate = isToday ? Math.max(dev.rate, 0.82) : dev.rate
      if (Math.random() > effectiveRate) continue

      const dKey = `${dev.azureId}|${ds}`
      const mKey = `${dev.azureId}|${ms}`
      const da = acc(dayAcc, dKey, dev.azureId, ds, false)
      const ma = acc(monAcc, mKey, dev.azureId, ms, true)

      const devPrs = prsByDev.get(dev.azureId) ?? []
      const eligiblePrs = devPrs.filter((pr) => dayKey(pr.createdAt) <= ds)
      const numCommits = isToday ? rand(5, 12) : rand(4, 9)

      for (let c = 0; c < numCommits; c++) {
        const repoIdx = pick(dev.repoIdxs)
        const repo = REPOS[repoIdx]
        const paths = FILE_PATHS[repo.name]
        const numFiles = rand(1, Math.min(8, paths.length))
        const chosenPaths = shuffle(paths).slice(0, numFiles)

        const files = chosenPaths.map((fp) => ({
          filePath: fp,
          linesAdded: rand(4, 220),
          linesRemoved: rand(0, 120),
          changeType: pick(CHANGE_TYPES),
          language: pick(repo.langs),
        }))

        const totalAdded = files.reduce((s, f) => s + f.linesAdded, 0)
        const totalRemoved = files.reduce((s, f) => s + f.linesRemoved, 0)
        const langs = [...new Set(files.map((f) => f.language))]

        const pushedAt = new Date(day)
        pushedAt.setHours(rand(8, isToday ? 18 : 20), rand(0, 59), rand(0, 59))

        const commitId = new ObjectId()
        const azureCommitId = `azure-commit-${String(commitSeq++).padStart(6, '0')}`
        const workItemIds = Math.random() > 0.2 ? [rand(1001, 1300)] : []

        let linkedPr = null
        if (eligiblePrs.length && Math.random() > 0.25) {
          linkedPr = pick(eligiblePrs)
          linkedPr.commitIds.push(azureCommitId)
          prCommitCounts.set(linkedPr.azurePrId, (prCommitCounts.get(linkedPr.azurePrId) ?? 0) + 1)
          bumpPrDay(linkedPr.azurePrId, ds)
        }

        commitDocs.push({
          _id: commitId,
          azureCommitId,
          repositoryId: repo.id,
          repositoryName: repo.name,
          projectId: PROJECT.id,
          projectName: PROJECT.name,
          authorAzureId: dev.azureId,
          authorName: dev.name,
          authorEmail: dev.email,
          branchName: pick(BRANCHES),
          message: pick(COMMIT_MESSAGES),
          pushedAt,
          filesChanged: files,
          totalLinesAdded: totalAdded,
          totalLinesRemoved: totalRemoved,
          totalFilesChanged: numFiles,
          languagesUsed: langs,
          pullRequestId: linkedPr?._id ?? null,
          workItemIds,
          analysisStatus: 'complete',
        })

        const complexity = pick(COMPLEXITY_LEVELS)
        const effScore = rand(48, 99)
        const estHours = randF(0.5, 6.0, 2)
        const actHours = randF(0.3, 7.0, 2)
        const effortDelta = +(((actHours - estHours) / estHours) * 100).toFixed(1)

        aiDocs.push({
          commitId,
          workItemId: workItemIds[0] ?? null,
          estimatedEffortHours: estHours,
          actualEffortHours: actHours,
          effortDeltaPercent: effortDelta,
          efficiencyScore: effScore,
          complexityLevel: complexity,
          codeQualitySignals: {
            hasTests: Math.random() > 0.55,
            hasDocumentation: Math.random() > 0.65,
            hasRefactoring: Math.random() > 0.5,
            hasBugFix: Math.random() > 0.6,
            isSecurityRelated: Math.random() > 0.82,
          },
          technicalSummary: pick(AI_SUMMARIES),
          modelUsed: 'seed-gpt-4o-mini',
          createdAt: pushedAt,
        })

        for (const a of [da, ma]) {
          a.totalCommits++
          a.totalLinesAdded += totalAdded
          a.totalLinesRemoved += totalRemoved
          a.totalFilesChanged += numFiles
          a.repos.add(repo.id)
          a.scores.push(effScore)
          a.totalEstimatedHours += estHours
          a.totalActualHours += actHours
        }
      }

      if (Math.random() > 0.45) {
        const n = rand(1, 3)
        da.workItemsCompleted += n
        ma.workItemsCompleted += n
      }
    }
  }

  const CHUNK = 1000
  console.log(
    `   Generated ${commitDocs.length.toLocaleString()} commits — inserting in chunks of ${CHUNK}...`,
  )
  for (let i = 0; i < commitDocs.length; i += CHUNK) {
    await commitsColl.insertMany(commitDocs.slice(i, i + CHUNK), { ordered: false })
    process.stdout.write(
      `\r   commits: ${Math.min(i + CHUNK, commitDocs.length).toLocaleString()} / ${commitDocs.length.toLocaleString()}   `,
    )
  }
  console.log(`\n✓  ${commitDocs.length.toLocaleString()} commits inserted`)

  for (let i = 0; i < aiDocs.length; i += CHUNK) {
    await aiColl.insertMany(aiDocs.slice(i, i + CHUNK), { ordered: false })
  }
  console.log(`✓  ${aiDocs.length.toLocaleString()} AI analyses inserted`)

  // Per-developer-per-day (and per-month) PR created / merged counts, derived
  // from the real PR docs — these replace the old random accumulators.
  const prCreatedByDevDay = {}
  const prMergedByDevDay = {}
  const prCreatedByDevMonth = {}
  const prMergedByDevMonth = {}
  const bump = (map, key) => {
    map[key] = (map[key] ?? 0) + 1
  }
  for (const pr of prDocs) {
    bump(prCreatedByDevDay, `${pr.authorAzureId}|${dayKey(pr.createdAt)}`)
    bump(prCreatedByDevMonth, `${pr.authorAzureId}|${monthKey(pr.createdAt)}`)
    if (pr.mergedAt) {
      bump(prMergedByDevDay, `${pr.authorAzureId}|${dayKey(pr.mergedAt)}`)
      bump(prMergedByDevMonth, `${pr.authorAzureId}|${monthKey(pr.mergedAt)}`)
    }
  }

  // ── 4. Daily summaries ──────────────────────────────────────────────────────

  console.log('\n📊  Seeding daily summaries...')

  const dailyDocs = Object.values(dayAcc).map((a) => ({
    developerAzureId: a.developerAzureId,
    date: a.date,
    totalCommits: a.totalCommits,
    totalLinesAdded: a.totalLinesAdded,
    totalLinesRemoved: a.totalLinesRemoved,
    totalFilesChanged: a.totalFilesChanged,
    repositoriesWorkedOn: [...a.repos],   // repo IDs — consistent with cron
    avgEfficiencyScore: a.scores.length
      ? +(a.scores.reduce((s, v) => s + v, 0) / a.scores.length).toFixed(1)
      : null,
    totalEstimatedHours: +a.totalEstimatedHours.toFixed(2),
    totalActualHours: +a.totalActualHours.toFixed(2),
    prCreated: prCreatedByDevDay[`${a.developerAzureId}|${a.date}`] ?? 0,
    prMerged: prMergedByDevDay[`${a.developerAzureId}|${a.date}`] ?? 0,
    workItemsCompleted: a.workItemsCompleted,
  }))

  for (let i = 0; i < dailyDocs.length; i += CHUNK) {
    await dailyColl.insertMany(dailyDocs.slice(i, i + CHUNK), { ordered: false })
  }
  console.log(`✓  ${dailyDocs.length.toLocaleString()} daily summaries inserted`)

  // ── 5. Monthly summaries ────────────────────────────────────────────────────

  console.log('\n📅  Seeding monthly summaries...')

  const monthlyDocs = Object.values(monAcc).map((a) => ({
    developerAzureId: a.developerAzureId,
    month: a.month,
    totalCommits: a.totalCommits,
    totalLinesAdded: a.totalLinesAdded,
    totalLinesRemoved: a.totalLinesRemoved,
    totalFilesChanged: a.totalFilesChanged,
    repositoriesWorkedOn: [...a.repos],   // repo IDs — consistent with cron
    avgEfficiencyScore: a.scores.length
      ? +(a.scores.reduce((s, v) => s + v, 0) / a.scores.length).toFixed(1)
      : null,
    totalEstimatedHours: +a.totalEstimatedHours.toFixed(2),
    totalActualHours: +a.totalActualHours.toFixed(2),
    prCreated: prCreatedByDevMonth[`${a.developerAzureId}|${a.month}`] ?? 0,
    prMerged: prMergedByDevMonth[`${a.developerAzureId}|${a.month}`] ?? 0,
    workItemsCompleted: a.workItemsCompleted,
  }))

  for (let i = 0; i < monthlyDocs.length; i += CHUNK) {
    await monthlyColl.insertMany(monthlyDocs.slice(i, i + CHUNK), { ordered: false })
  }
  console.log(`✓  ${monthlyDocs.length.toLocaleString()} monthly summaries inserted`)

  // ── 6. Pull requests (built above, inserted here) ──────────────────────────

  console.log('\n🔀  Seeding pull requests...')

  for (let i = 0; i < prDocs.length; i += CHUNK) {
    await prColl.insertMany(prDocs.slice(i, i + CHUNK), { ordered: false })
  }
  const prCreatedTodayCount = prDocs.filter((p) => dayKey(p.createdAt) === todayDateStr).length
  console.log(
    `✓  ${prDocs.length.toLocaleString()} pull requests inserted (${prCreatedTodayCount} created today)`,
  )

  // ── 7. Work items (2–4 per developer) ──────────────────────────────────────

  console.log('\n📋  Seeding work items...')

  const workDocs = []
  let workItemId = 1001

  for (let di = 0; di < DEVELOPERS.length; di++) {
    const dev = DEVELOPERS[di]
    const numItems = rand(2, 4)

    for (let w = 0; w < numItems; w++) {
      const title = WORK_TITLES[(di * 4 + w) % WORK_TITLES.length]
      const type = ['task', 'bug', 'story', 'feature', 'epic'][w % 5]
      const globalIdx = di * 4 + w
      const state =
        globalIdx < DEVELOPERS.length * 2
          ? 'Closed'
          : globalIdx < DEVELOPERS.length * 3
            ? 'Resolved'
            : pick(['Active', 'New', 'Active'])
      const est = randF(2, 16, 1)
      const act = state === 'Closed' ? randF(1.5, 18, 1) : undefined
      const sprint = SPRINT_NAMES[Math.floor(globalIdx / 30) % SPRINT_NAMES.length]

      workDocs.push({
        azureWorkItemId: workItemId++,
        type,
        title,
        assignedToAzureId: dev.azureId,
        estimatedHours: est,
        completedHours: act,
        remainingHours: state === 'Active' ? randF(0.5, est, 1) : 0,
        storyPoints: pick([1, 2, 3, 5, 8, 13]),
        state,
        sprintName: sprint,
        sprintPath: `DevAnalytics\\${sprint}`,
        projectName: PROJECT.name,
        linkedPrIds: [],
        startedAt: new Date(addDays(START, rand(0, 20))),
        closedAt: state === 'Closed' ? new Date(addDays(START, rand(21, 61))) : undefined,
        createdAt: new Date(START),
        updatedAt: new Date(TODAY),
      })
    }
  }

  for (let i = 0; i < workDocs.length; i += CHUNK) {
    await worksColl.insertMany(workDocs.slice(i, i + CHUNK), { ordered: false })
  }
  console.log(`✓  ${workDocs.length.toLocaleString()} work items inserted`)

  // ── 8. PR effort analysis (estimated vs actual, per PR) ─────────────────────
  // Deterministic synthetic values (no AI calls). Mirrors the shape the real
  // PrEffortService produces so the PR Work Analysis card renders immediately.

  console.log('\n⚖️   Seeding PR effort analysis...')

  const complexityFor = (mid) =>
    mid > 4 ? 'very-high' : mid > 2 ? 'high' : mid > 0.75 ? 'medium' : 'low'

  const prEffortDocs = prDocs.map((pr) => {
    const estimatedHoursMid = randF(0.5, 8, 2)
    const estimatedHours = estimatedHoursMid
    const estimatedHoursMin = +(estimatedHoursMid * 0.6).toFixed(2)
    const estimatedHoursMax = +(estimatedHoursMid * 1.4).toFixed(2)
    const hasWorkItem = pr.workItemIds.length > 0
    const createdToday = dayKey(pr.createdAt) === todayDateStr
    const efficiencyScore = rand(52, 96)

    let actualHours = null
    let actualSource = null
    let variancePercent = null
    let phase = 'estimate_only'

    if (hasWorkItem) {
      phase = 'complete'
      actualSource = pick(['work-item-logged', 'commit-activity'])
      actualHours = +(estimatedHoursMid * randF(0.55, 2.8, 2)).toFixed(2)
      variancePercent = Math.round(((actualHours - estimatedHoursMid) / estimatedHoursMid) * 100)
    }

    const activeSet = prActiveDates.get(pr.azurePrId) ?? new Set()
    activeSet.add(dayKey(pr.createdAt))
    if (pr.mergedAt) activeSet.add(dayKey(pr.mergedAt))
    if (createdToday || Math.random() < 0.4) activeSet.add(todayDateStr)
    const activeDates = [...activeSet].sort()
    const lastDay = activeDates[activeDates.length - 1] ?? todayDateStr
    const lastCommitAt = new Date(`${lastDay}T12:00:00.000Z`)
    const commitCount = prCommitCounts.get(pr.azurePrId) ?? rand(1, 6)

    return {
      azurePrId: pr.azurePrId,
      prTitle: pr.title,
      authorAzureId: pr.authorAzureId,
      repositoryName: pr.repositoryName,
      projectName: pr.projectName,
      workItemIds: pr.workItemIds,
      estimatedHours,
      estimatedHoursMin,
      estimatedHoursMax,
      estimatedHoursMid,
      efficiencyScore,
      complexityLevel: complexityFor(estimatedHoursMid),
      aiExplanation: hasWorkItem
        ? `Estimated ${estimatedHoursMin}-${estimatedHoursMax}h from code size and the linked work item.`
        : `Estimated ${estimatedHoursMin}-${estimatedHoursMax}h from code size; link a work item to measure actual effort.`,
      actualHours,
      actualSource,
      variancePercent,
      phase,
      activeDates,
      commitCount,
      lastCommitAt,
      prCreatedAt: pr.createdAt,
      prMergedAt: pr.mergedAt,
      analyzedAt: new Date(),
      modelUsed: 'seed-deterministic',
      createdAt: pr.createdAt,
      updatedAt: new Date(),
    }
  })

  for (let i = 0; i < prEffortDocs.length; i += CHUNK) {
    await prEffortColl.insertMany(prEffortDocs.slice(i, i + CHUNK), { ordered: false })
  }
  const estimateOnlyCount = prEffortDocs.filter((p) => p.phase === 'estimate_only').length
  const effortTodayCount = prEffortDocs.filter((p) => p.activeDates.includes(todayDateStr)).length
  console.log(
    `✓  ${prEffortDocs.length.toLocaleString()} PR effort analyses inserted ` +
      `(${estimateOnlyCount} awaiting work-item link, ${effortTodayCount} active today)`,
  )

  // ── Summary ─────────────────────────────────────────────────────────────────

  const teamBreakdown = TEAM_CONFIGS.map((c) => `${c.team} (${c.count})`).join(' · ')

  console.log('\n✅  Seed complete!\n')
  console.log('   Collection          Records')
  console.log('   ─────────────────────────────────────')
  console.log(`   organizations       1`)
  console.log(`   projects            1`)
  console.log(`   repositories        ${REPOS.length}`)
  console.log(`   teams               ${TEAM_CONFIGS.length}`)
  console.log(`   sprints             ${SPRINT_NAMES.length}`)
  console.log(`   developers          ${developerDocs.length}`)
  console.log(`   commits             ${commitDocs.length.toLocaleString()}`)
  console.log(`   aianalyses          ${aiDocs.length.toLocaleString()}`)
  console.log(`   dailysummaries      ${dailyDocs.length.toLocaleString()}`)
  console.log(`   monthlysummaries    ${monthlyDocs.length.toLocaleString()}`)
  console.log(`   pullrequests        ${prDocs.length.toLocaleString()}`)
  console.log(`   workitems           ${workDocs.length.toLocaleString()}`)
  console.log(`   preffortanalyses    ${prEffortDocs.length.toLocaleString()}`)
  console.log()
  console.log('   Team breakdown:')
  console.log(`   ${teamBreakdown}`)
  console.log()
  console.log('   Sample developers:')
  for (const d of DEVELOPERS.slice(0, 8)) {
    console.log(`   • ${d.name.padEnd(22)} ${d.azureId}  (${d.team}, rate=${d.rate})`)
  }
  if (DEVELOPERS.length > 8) {
    console.log(`   • ... and ${DEVELOPERS.length - 8} more`)
  }
  console.log()
  console.log('   NOTE: Developers are in the `developers` collection (not `users`).')
  console.log('   Admin/manager portal accounts are seeded separately via seed-admin.ts.')
  console.log()
  console.log('   Re-seed cleanly:')
  console.log('   node scripts/seed-dummy-data.mjs --clean\n')

  await mongoose.disconnect()
}

main().catch((err) => {
  console.error('\n❌  Seed failed:', err.message)
  process.exit(1)
})
