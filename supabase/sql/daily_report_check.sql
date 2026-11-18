-- Bilan quotidien : diagnostic de l'envoi automatique de 6 h, et test à la demande.
-- À lancer dans Supabase : SQL Editor (après daily_report.sql). Le script peut être relancé sans risque.

-- ════════ 1. Journal des appels de la fonction daily-report ════════
-- Les réponses de pg_net sont effacées au bout de quelques heures : ce journal garde la trace des matins.
create table if not exists public.daily_report_runs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  source text not null,              -- cron | test | manuel
  outcome text not null,             -- sent | simulated | skipped_hour | already_sent | error | refused
  detail text
);
create index if not exists daily_report_runs_created_idx on public.daily_report_runs (created_at desc);
alter table public.daily_report_runs enable row level security;
-- Aucune règle d'accès : réservé au serveur (clé service).

-- ════════ 2. État de la tâche planifiée ════════
create or replace function public.daily_report_status(p_request_id bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb := '{}'::jsonb;
begin
  begin
    r := r || jsonb_build_object('job', (
      select jsonb_build_object('schedule', schedule, 'active', active, 'uses_secret', command like '%x-cron-secret%',
                                'url_ok', command like '%/functions/v1/daily-report%',
                                -- Authorization doit contenir la clé publique de Supabase (un jeton « eyJ… »), pas le secret
                                'auth_is_key', command ~ '''Authorization''\s*,\s*''Bearer eyJ',
                                -- le secret doit être lu dans le coffre, pas écrit en clair dans la commande
                                'secret_from_vault', command like '%decrypted_secrets%' and command like '%cron_secret%')
        from cron.job where jobname = 'bilan-quotidien-ames-nomades'));
    r := r || jsonb_build_object('runs', coalesce((
      select jsonb_agg(x order by x.start_time desc) from (
        select d.status, left(coalesce(d.return_message, ''), 200) as message, d.start_time
          from cron.job_run_details d join cron.job j on j.jobid = d.jobid
         where j.jobname = 'bilan-quotidien-ames-nomades'
         order by d.start_time desc limit 6) x), '[]'::jsonb));
  exception when others then
    r := r || jsonb_build_object('cron_error', sqlerrm);
  end;

  begin
    r := r || jsonb_build_object('vault_secret', exists (select 1 from vault.secrets where name = 'cron_secret'));
  exception when others then
    r := r || jsonb_build_object('vault_error', sqlerrm);
  end;

  begin
    if p_request_id is not null then
      r := r || jsonb_build_object('response', (
        select jsonb_build_object('status_code', status_code, 'content', left(coalesce(content, ''), 400), 'timed_out', timed_out,
                                  'error', left(coalesce(error_msg, ''), 200), 'created', created)
          from net._http_response where id = p_request_id));
    end if;
  exception when others then
    r := r || jsonb_build_object('net_error', sqlerrm);
  end;
  return r;
end;
$$;
revoke all on function public.daily_report_status(bigint) from public, anon, authenticated;
grant execute on function public.daily_report_status(bigint) to service_role;

-- ════════ 3. Test : la base appelle la fonction exactement comme à 6 h ════════
-- Même chemin que la tâche (coffre, pg_net, secret), sans attendre 6 h (« force »).
-- Un seul envoi par jour reste garanti : si le bilan du jour est déjà parti, rien n'est renvoyé.
create or replace function public.daily_report_selftest()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  cmd text;
  request_id bigint;
begin
  select command into cmd from cron.job where jobname = 'bilan-quotidien-ames-nomades';
  if cmd is null then
    raise exception 'La tâche planifiée « bilan-quotidien-ames-nomades » n''existe pas : lancez supabase/sql/daily_report.sql.';
  end if;
  if position('/functions/v1/daily-report''' in cmd) = 0 then
    raise exception 'La tâche planifiée n''appelle pas la fonction daily-report : relancez supabase/sql/daily_report.sql.';
  end if;
  -- Même commande que la tâche, avec « force » (ignore l'heure) et la source « test »
  cmd := replace(cmd, '/functions/v1/daily-report''', '/functions/v1/daily-report?force=1&source=test''');
  cmd := regexp_replace(cmd, ';\s*$', '');
  execute cmd into request_id;
  return request_id;
end;
$$;
revoke all on function public.daily_report_selftest() from public, anon, authenticated;
grant execute on function public.daily_report_selftest() to service_role;

-- ════════ 4. Valeur à recopier dans Edge Functions → Secrets → CRON_SECRET ════════
-- (si le diagnostic indique que le secret de la tâche est différent de CRON_SECRET)
select decrypted_secret as "CRON_SECRET (à recopier dans Edge Functions > Secrets)"
  from vault.decrypted_secrets where name = 'cron_secret';
