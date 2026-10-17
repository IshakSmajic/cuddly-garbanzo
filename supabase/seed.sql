-- Local stack only: runs after the migrations on `npm run db:reset` (never on
-- the hosted project). These are local values, not secrets; the hosted
-- project stores its own in Vault by hand (docs/PROGRESS.md, milestone 10).

-- Where the cleanup-files cron job sends its request. From inside the
-- database container, the API gateway is reached by its container name.
select vault.create_secret('http://supabase_kong_cuddly-garbanzo:8000', 'project_url');
-- Must match CLEANUP_SECRET in supabase/functions/.env.
select vault.create_secret('local-cleanup-secret', 'cleanup_secret');
