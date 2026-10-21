-- Start AI block generation when the customer portal inserts a brief.
--
-- On insert into public.projects, pg_net POSTs { projectId } to the admin
-- app's /api/generate with the shared secret. The call is asynchronous and
-- never blocks or fails the customer's insert. If either Vault secret is
-- missing the trigger does nothing, so operators can still start generation
-- from the dashboard.
--
-- Before applying, store both secrets in Vault:
--   select vault.create_secret('https://admin.usetulip.co/api/generate', 'generator_webhook_url');
--   select vault.create_secret('<same value as GENERATOR_WEBHOOK_SECRET>', 'generator_webhook_secret');

create extension if not exists pg_net with schema extensions;

create or replace function public.request_brief_generation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  endpoint text;
  secret text;
begin
  select decrypted_secret into endpoint
    from vault.decrypted_secrets where name = 'generator_webhook_url';
  select decrypted_secret into secret
    from vault.decrypted_secrets where name = 'generator_webhook_secret';

  if endpoint is null or secret is null then
    return new;
  end if;

  perform net.http_post(
    url := endpoint,
    body := jsonb_build_object('projectId', new.id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || secret
    ),
    timeout_milliseconds := 10000
  );
  return new;
end;
$$;

revoke execute on function public.request_brief_generation() from public, anon, authenticated;

create trigger projects_request_generation
  after insert on public.projects
  for each row
  execute function public.request_brief_generation();
