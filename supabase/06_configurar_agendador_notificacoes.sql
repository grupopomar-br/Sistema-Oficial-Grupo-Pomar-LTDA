-- Aplicação manual no projeto da Central, após reunioes_e_notificacoes.
-- Ative Cron, pg_net e Vault no Dashboard. No Vault, crie estes dois segredos:
-- pomar_notifications_app_url = origem HTTPS da Central, sem caminho/barra final.
-- pomar_notifications_cron_secret = MESMO valor de POMAR_NOTIFICATIONS_CRON_SECRET da Vercel.
-- Nenhuma chave administrativa do Supabase é enviada à aplicação.
begin;
do $$ declare app text;token text;begin
 if to_regprocedure('public.pomar_notifications_claim(integer)') is null then raise exception 'Aplique primeiro reunioes_e_notificacoes.';end if;
 if to_regclass('cron.job') is null or to_regclass('vault.decrypted_secrets') is null or to_regclass('net.http_request_queue') is null then raise exception 'Ative Cron, pg_net e Vault antes de continuar.';end if;
 select decrypted_secret into app from vault.decrypted_secrets where name='pomar_notifications_app_url';
 select decrypted_secret into token from vault.decrypted_secrets where name='pomar_notifications_cron_secret';
 if app is null or app !~ '^https://[A-Za-z0-9.-]+$' or token is null or char_length(token) not between 32 and 256 or token !~ '^[A-Za-z0-9_-]+$' then raise exception 'Configure a origem e o segredo no Vault antes de criar o job.';end if;
end $$;
-- A fila pg_net pode conter o cabeçalho Bearer enquanto a requisição aguarda.
-- O navegador e os workers restritos não recebem acesso a esses registros.
revoke all on all tables in schema net from public,anon,authenticated,pomar_billing_worker,pomar_notification_worker;
revoke usage on schema net from public,anon,authenticated,pomar_billing_worker,pomar_notification_worker;
select cron.schedule('pomar-notification-dispatch','* * * * *',$cron$
 select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='pomar_notifications_app_url') || '/api/notifications/dispatch',
  headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='pomar_notifications_cron_secret')),
  body := '{}'::jsonb,
  timeout_milliseconds := 60000
 );
$cron$);
commit;
