// Dummy environment so importing src modules never requires a real .env —
// config/index.ts is loaded transitively (via the logger) by almost everything
// and hard-requires the Supabase variables. Needed for CI.
process.env.SUPA_BASE_PROJECT_URL ??= 'http://localhost:54321';
process.env.SUPA_BASE_DB_API_KEY ??= 'test-key';
process.env.SESSION_SECRET ??= 'test-secret-test-secret-test-secret!';
process.env.LOG_LEVEL ??= 'error';
