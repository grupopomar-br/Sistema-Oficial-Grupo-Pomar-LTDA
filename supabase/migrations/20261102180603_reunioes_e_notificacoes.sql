-- Aplicação manual após melhorias_audio_central. Não cria pagamentos ou convites.
begin;
do $$ begin
 if to_regprocedure('public.pomar_workspace_personalized()') is null then raise exception 'Aplique primeiro melhorias_audio_central.';end if;
 if not exists(select 1 from pg_roles where rolname='pomar_notification_worker') then
  create role pomar_notification_worker nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
 end if;
 if exists(select 1 from pg_roles where rolname='pomar_notification_worker' and (rolsuper or rolcreatedb or rolcreaterole or rolbypassrls or rolinherit)) or exists(select 1 from pg_auth_members where member=(select oid from pg_roles where rolname='pomar_notification_worker')) then raise exception 'Papel de notificações com privilégios incompatíveis.';end if;
end $$;
revoke all on schema public,pomar_private from pomar_notification_worker;
grant usage on schema public to pomar_notification_worker;
revoke create on schema public from pomar_notification_worker;

create table public.pomar_meetings (
 id uuid primary key,owner_id uuid not null references auth.users(id),version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 title text not null check(char_length(trim(title)) between 2 and 160),client_id uuid,project_id uuid,
 starts_at timestamptz not null,ends_at timestamptz not null,
 status text not null default 'scheduled' check(status in('scheduled','completed','cancelled')),
 location text not null default '' check(char_length(location)<=300),meeting_url text not null default '' check(char_length(meeting_url)<=2048 and (meeting_url='' or meeting_url ~ '^https://[^/@[:space:]]+([/?#]|$)')),
 participants text not null default '' check(char_length(participants)<=3000),agenda text not null default '' check(char_length(agenda)<=10000),outcome text not null default '' check(char_length(outcome)<=10000),
 reminder_minutes integer not null default 60 check(reminder_minutes in(0,60,120)),reminder_version integer not null default 1 check(reminder_version>0),
 check(ends_at>starts_at and ends_at-starts_at<=interval '24 hours'),unique(owner_id,id),
 foreign key(owner_id,client_id) references public.pomar_clients(owner_id,id),foreign key(owner_id,project_id) references public.pomar_projects(owner_id,id)
);
alter table public.pomar_meetings enable row level security;alter table public.pomar_meetings force row level security;
revoke all on public.pomar_meetings from public,anon,authenticated,pomar_notification_worker,pomar_billing_worker;
grant select,insert,update on public.pomar_meetings to authenticated;
create policy owner_access on public.pomar_meetings to authenticated using(owner_id=(select auth.uid()) and (select pomar_private.is_owner())) with check(owner_id=(select auth.uid()) and (select pomar_private.is_owner()));
create index on public.pomar_meetings(owner_id,status,starts_at);
create trigger touch_record before insert or update on public.pomar_meetings for each row execute function pomar_private.touch_record();
create trigger audit_record after insert or update on public.pomar_meetings for each row execute function pomar_private.audit_record('meeting');

create table public.pomar_notifications (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),
 dedupe_key text not null check(char_length(dedupe_key)<=200),kind text not null check(kind in('sale','meeting','test')),
 source_id uuid not null,source_version integer not null default 1,
 title text not null check(char_length(title)<=160),message text not null check(char_length(message)<=500),
 occurred_at timestamptz not null default now(),expires_at timestamptz not null,read_at timestamptz,active boolean not null default true,
 unique(owner_id,dedupe_key),unique(owner_id,id)
);
alter table public.pomar_notifications enable row level security;alter table public.pomar_notifications force row level security;
revoke all on public.pomar_notifications from public,anon,authenticated,pomar_notification_worker,pomar_billing_worker;
grant select on public.pomar_notifications to authenticated;
grant update(read_at) on public.pomar_notifications to authenticated;
create policy owner_read on public.pomar_notifications for select to authenticated using(owner_id=(select auth.uid()) and (select pomar_private.is_owner()));
create policy owner_read_status on public.pomar_notifications for update to authenticated using(owner_id=(select auth.uid()) and (select pomar_private.is_owner())) with check(owner_id=(select auth.uid()) and (select pomar_private.is_owner()));
create index on public.pomar_notifications(owner_id,active,occurred_at desc);
create index on public.pomar_notifications(owner_id) where active and read_at is null;

create table pomar_private.push_devices (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),
 endpoint text not null check(char_length(endpoint) between 20 and 2048),p256dh text not null check(p256dh ~ '^[A-Za-z0-9_-]{87}$'),auth_key text not null check(auth_key ~ '^[A-Za-z0-9_-]{22}$'),
 created_at timestamptz not null default now(),active boolean not null default true,unique(owner_id,endpoint),unique(owner_id,id)
);
create table pomar_private.push_deliveries (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),notification_id uuid not null,device_id uuid not null,
 status text not null default 'pending' check(status in('pending','sending','sent','failed','cancelled')),
 attempts integer not null default 0 check(attempts between 0 and 5),available_at timestamptz not null default now(),lease_until timestamptz,lease_token uuid,
 unique(notification_id,device_id),foreign key(owner_id,notification_id) references public.pomar_notifications(owner_id,id),foreign key(owner_id,device_id) references pomar_private.push_devices(owner_id,id)
);
create table pomar_private.notification_sale_baseline (
 payment_id uuid primary key,owner_id uuid not null references auth.users(id)
);
insert into pomar_private.notification_sale_baseline(payment_id,owner_id)
 select id,owner_id from public.pomar_provider_payments where mode='live' and status in('approved','refunded','charged_back');
create table pomar_private.notification_runtime (singleton boolean primary key default true check(singleton),last_dispatch_at timestamptz);
insert into pomar_private.notification_runtime(singleton) values(true);
do $$ declare t text;begin
 foreach t in array array['push_devices','push_deliveries','notification_runtime','notification_sale_baseline'] loop
  execute format('alter table pomar_private.%I enable row level security',t);execute format('alter table pomar_private.%I force row level security',t);
  execute format('revoke all on pomar_private.%I from public,anon,authenticated,pomar_notification_worker,pomar_billing_worker',t);
 end loop;
end $$;
create index on pomar_private.push_deliveries(status,available_at,lease_until);

-- A fila lê somente pagamentos já verificados e não modifica o fluxo financeiro.
-- Aprovações anteriores à instalação ficam na baseline privada, sem avisos retroativos.
create function pomar_private.meeting_reminder_version() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then new.reminder_version:=1;
 elsif (new.starts_at,new.status,new.reminder_minutes) is distinct from (old.starts_at,old.status,old.reminder_minutes) then new.reminder_version:=old.reminder_version+1;
 else new.reminder_version:=old.reminder_version;end if;
 return new;
end $$;
revoke all on function pomar_private.meeting_reminder_version() from public,anon,authenticated,pomar_notification_worker,pomar_billing_worker;
create trigger meeting_reminder_version before insert or update on public.pomar_meetings for each row execute function pomar_private.meeting_reminder_version();

-- A geração e a invalidação são feitas pelos RPCs delimitados, sem conceder
-- INSERT de notificações arbitrárias ao navegador.
create function pomar_private.enqueue_meeting_reminders(p_owner uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
 insert into public.pomar_notifications(owner_id,dedupe_key,kind,source_id,title,message,expires_at)
 select p.owner_id,'sale:'||p.id,'sale',p.id,'Pagamento Pix confirmado','Um pagamento foi confirmado pelo Mercado Pago. Confira o recebimento em Cobranças.',now()+interval '1 day'
 from public.pomar_provider_payments p join public.pomar_charges c on c.owner_id=p.owner_id and c.id=p.charge_id
 where p.owner_id=p_owner and p.mode='live' and p.status='approved' and c.mode='live' and c.amount_cents=p.amount_cents
 and not exists(select 1 from pomar_private.notification_sale_baseline b where b.payment_id=p.id)
 and not exists(select 1 from public.pomar_notifications n where n.owner_id=p.owner_id and n.dedupe_key='sale:'||p.id)
 on conflict(owner_id,dedupe_key) do nothing;
 update public.pomar_notifications n set active=false where n.owner_id=p_owner and n.kind='meeting' and n.active and not exists(
  select 1 from public.pomar_meetings m where m.owner_id=p_owner and m.id=n.source_id and m.status='scheduled' and m.reminder_version=n.source_version);
 insert into public.pomar_notifications(owner_id,dedupe_key,kind,source_id,source_version,title,message,expires_at)
 select m.owner_id,'meeting:'||m.id||':'||m.reminder_version,'meeting',m.id,m.reminder_version,'Reunião: '||left(m.title,150),
  'Início em '||to_char(m.starts_at at time zone 'America/Fortaleza','DD/MM às HH24:MI')||'. Abra Reuniões para conferir os detalhes.',m.starts_at
 from public.pomar_meetings m where m.owner_id=p_owner and m.status='scheduled' and m.reminder_minutes>0 and m.starts_at>now()
 and now()>=m.starts_at-make_interval(mins=>m.reminder_minutes) on conflict(owner_id,dedupe_key) do nothing;
 update pomar_private.push_deliveries d set status='cancelled',lease_token=null where d.owner_id=p_owner and d.status in('pending','sending') and not exists(
  select 1 from public.pomar_notifications n where n.id=d.notification_id and n.owner_id=p_owner and n.active and n.expires_at>now());
end $$;
revoke all on function pomar_private.enqueue_meeting_reminders(uuid) from public,anon,authenticated,pomar_notification_worker,pomar_billing_worker;

alter function public.pomar_command(uuid,jsonb) rename to pomar_command_before_meetings;
alter function public.pomar_command_before_meetings(uuid,jsonb) set schema pomar_private;
revoke all on function pomar_private.pomar_command_before_meetings(uuid,jsonb) from public,anon;
grant execute on function pomar_private.pomar_command_before_meetings(uuid,jsonb) to authenticated;
create function public.pomar_command(p_key uuid,p_command jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v jsonb:=p_command->'value';old_payload jsonb;n integer;
begin
 if p_command->>'type' is distinct from 'saveMeeting' then return pomar_private.pomar_command_before_meetings(p_key,p_command);end if;
 if not pomar_private.is_owner() then raise exception using errcode='42501',message='POMAR_ACCESS';end if;
 if p_key is null then raise exception using errcode='22023',message='POMAR_BAD_COMMAND';end if;
 insert into public.pomar_command_log(owner_id,command_id,payload) values(auth.uid(),p_key,p_command) on conflict do nothing;get diagnostics n=row_count;
 if n=0 then select payload into old_payload from public.pomar_command_log where owner_id=auth.uid() and command_id=p_key;
  if old_payload is distinct from p_command then raise exception using errcode='P0001',message='POMAR_KEY_REUSED';end if;return jsonb_build_object('duplicate',true);end if;
 if exists(select 1 from public.pomar_meetings where owner_id=auth.uid() and id=(v->>'id')::uuid) then
  update public.pomar_meetings set title=v->>'title',client_id=(v->>'client_id')::uuid,project_id=(v->>'project_id')::uuid,starts_at=(v->>'starts_at')::timestamptz,ends_at=(v->>'ends_at')::timestamptz,status=v->>'status',location=v->>'location',meeting_url=v->>'meeting_url',participants=v->>'participants',agenda=v->>'agenda',outcome=v->>'outcome',reminder_minutes=(v->>'reminder_minutes')::integer
  where owner_id=auth.uid() and id=(v->>'id')::uuid and version=(v->>'version')::integer;get diagnostics n=row_count;
  if n<>1 then raise exception using errcode='P0001',message='POMAR_CONFLICT';end if;
 else
  if (select count(*) from public.pomar_meetings where owner_id=auth.uid())>=10000 then raise exception using errcode='P0001',message='POMAR_SNAPSHOT_LIMIT';end if;
  if (v->>'version')::integer is distinct from 1 then raise exception using errcode='P0001',message='POMAR_CONFLICT';end if;
  insert into public.pomar_meetings(id,owner_id,title,client_id,project_id,starts_at,ends_at,status,location,meeting_url,participants,agenda,outcome,reminder_minutes)
  values((v->>'id')::uuid,auth.uid(),v->>'title',(v->>'client_id')::uuid,(v->>'project_id')::uuid,(v->>'starts_at')::timestamptz,(v->>'ends_at')::timestamptz,v->>'status',v->>'location',v->>'meeting_url',v->>'participants',v->>'agenda',v->>'outcome',(v->>'reminder_minutes')::integer);
 end if;return jsonb_build_object('duplicate',false);
end $$;
revoke all on function public.pomar_command(uuid,jsonb) from public,anon;
grant execute on function public.pomar_command(uuid,jsonb) to authenticated;
create function public.pomar_workspace_scheduled() returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;items jsonb;begin
 result:=public.pomar_workspace_personalized();
 if (select count(*) from public.pomar_meetings where owner_id=auth.uid())>10000 then raise exception using errcode='P0001',message='POMAR_SNAPSHOT_LIMIT';end if;
 select coalesce(jsonb_agg(to_jsonb(m)-'owner_id' order by starts_at,id),'[]'::jsonb) into items from public.pomar_meetings m where owner_id=auth.uid();
 return result||jsonb_build_object('meetings_ready',true,'meetings',items);
end $$;
revoke all on function public.pomar_workspace_scheduled() from public,anon;grant execute on function public.pomar_workspace_scheduled() to authenticated;

create function public.pomar_notifications_list() returns jsonb language plpgsql security definer set search_path='' as $$
declare items jsonb;n bigint;last_at timestamptz;begin
 if not pomar_private.is_owner() then raise exception using errcode='42501',message='POMAR_ACCESS';end if;
 perform pomar_private.enqueue_meeting_reminders(auth.uid());
 select count(*) into n from public.pomar_notifications where owner_id=auth.uid() and active and read_at is null;
 select coalesce(jsonb_agg(to_jsonb(r) order by occurred_at desc,id),'[]'::jsonb) into items from(
  select id,kind,source_id,title,message,occurred_at,read_at from public.pomar_notifications where owner_id=auth.uid() and active order by occurred_at desc,id limit 100) r;
 select last_dispatch_at into last_at from pomar_private.notification_runtime where singleton;
 return jsonb_build_object('available',true,'items',items,'unread',n,'last_dispatch_at',last_at);
end $$;
revoke all on function public.pomar_notifications_list() from public,anon;grant execute on function public.pomar_notifications_list() to authenticated;

create function public.pomar_push_device(p_subscription jsonb,p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$
declare v_endpoint text:=p_subscription->>'endpoint';begin
 if not pomar_private.is_owner() then raise exception using errcode='42501',message='POMAR_ACCESS';end if;
 if v_endpoint is null or char_length(v_endpoint)>2048 or v_endpoint !~ '^https://(fcm\.googleapis\.com|([A-Za-z0-9-]+\.)*push\.services\.mozilla\.com|([A-Za-z0-9-]+\.)*push\.apple\.com|([A-Za-z0-9-]+\.)+notify\.windows\.com)/' then raise exception using errcode='22023',message='POMAR_BAD_COMMAND';end if;
 if not p_enabled then
  update pomar_private.push_devices set active=false where owner_id=auth.uid() and push_devices.endpoint=v_endpoint;
  return;
 end if;
 perform 1 from pomar_private.owner_registry where owner_id=auth.uid() for update;
 if (select count(*) from pomar_private.push_devices where owner_id=auth.uid() and active)>=10 and not exists(select 1 from pomar_private.push_devices where owner_id=auth.uid() and push_devices.endpoint=v_endpoint and active) then raise exception using errcode='P0001',message='POMAR_DEVICE_LIMIT';end if;
 insert into pomar_private.push_devices(owner_id,endpoint,p256dh,auth_key) values(auth.uid(),v_endpoint,p_subscription->'keys'->>'p256dh',p_subscription->'keys'->>'auth')
 on conflict(owner_id,endpoint) do update set p256dh=excluded.p256dh,auth_key=excluded.auth_key,active=true;
end $$;
revoke all on function public.pomar_push_device(jsonb,boolean) from public,anon;grant execute on function public.pomar_push_device(jsonb,boolean) to authenticated;

create function public.pomar_notification_test(p_endpoint text) returns void language plpgsql security definer set search_path='' as $$
declare device uuid;begin
 if not pomar_private.is_owner() then raise exception using errcode='42501',message='POMAR_ACCESS';end if;
 select id into device from pomar_private.push_devices where owner_id=auth.uid() and endpoint=p_endpoint and active;
 if device is null then raise exception using errcode='P0001',message='POMAR_NOT_FOUND';end if;
 if exists(select 1 from public.pomar_notifications where owner_id=auth.uid() and kind='test' and source_id=device and occurred_at>now()-interval '1 minute') then raise exception using errcode='P0001',message='POMAR_TEST_RATE_LIMIT';end if;
 insert into public.pomar_notifications(owner_id,dedupe_key,kind,source_id,title,message,expires_at)
 values(auth.uid(),'test:'||gen_random_uuid(),'test',device,'Teste de notificações','Este aparelho está pronto para receber os avisos da Central.',now()+interval '10 minutes');
end $$;
revoke all on function public.pomar_notification_test(text) from public,anon;grant execute on function public.pomar_notification_test(text) to authenticated;

-- Capacidade de entrega delimitada: sem CRUD, sem dados de clientes/financeiro,
-- sem owner ou endpoint fornecido pelo chamador. O papel do pooler é conferido.
create function public.pomar_notifications_claim(p_limit integer default 20) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid;items jsonb;begin
 if session_user<>'pomar_notification_worker' then raise exception using errcode='42501',message='POMAR_ACCESS';end if;
 select owner_id into uid from pomar_private.owner_registry where active;
 if uid is null then return '[]'::jsonb;end if;
 perform pomar_private.enqueue_meeting_reminders(uid);
 update pomar_private.notification_runtime set last_dispatch_at=now() where singleton;
 insert into pomar_private.push_deliveries(owner_id,notification_id,device_id)
 select n.owner_id,n.id,d.id from public.pomar_notifications n join pomar_private.push_devices d on d.owner_id=n.owner_id and d.active
 where n.owner_id=uid and n.active and n.expires_at>now() and d.created_at<=n.occurred_at and (n.kind<>'test' or n.source_id=d.id) on conflict(notification_id,device_id) do nothing;
 update pomar_private.push_deliveries set status='failed',lease_token=null where attempts>=5 and (status='pending' or (status='sending' and lease_until<now()));
 with selected as (
  select d.id from pomar_private.push_deliveries d join public.pomar_notifications n on n.id=d.notification_id and n.owner_id=d.owner_id
   join pomar_private.push_devices p on p.id=d.device_id and p.owner_id=d.owner_id
  where d.owner_id=uid and n.active and n.expires_at>now() and p.active and d.attempts<5 and
   ((d.status='pending' and d.available_at<=now()) or (d.status='sending' and d.lease_until<now()))
  order by d.available_at,d.id for update of d skip locked limit greatest(1,least(coalesce(p_limit,20),50))
 ), claimed as (
  update pomar_private.push_deliveries d set status='sending',attempts=attempts+1,lease_until=now()+interval '3 minutes',lease_token=gen_random_uuid()
   from selected s where d.id=s.id returning d.*
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'lease',d.lease_token,'kind',n.kind,'sourceId',n.source_id,'expiresAt',n.expires_at,
  'subscription',jsonb_build_object('endpoint',p.endpoint,'keys',jsonb_build_object('p256dh',p.p256dh,'auth',p.auth_key)))),'[]'::jsonb)
 into items from claimed d join public.pomar_notifications n on n.id=d.notification_id join pomar_private.push_devices p on p.id=d.device_id;
 return items;
end $$;
create function public.pomar_notification_delivery_valid(p_id uuid,p_lease uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if session_user<>'pomar_notification_worker' then raise exception using errcode='42501',message='POMAR_ACCESS';end if;
 return exists(select 1 from pomar_private.push_deliveries d join public.pomar_notifications n on n.id=d.notification_id and n.owner_id=d.owner_id
  join pomar_private.push_devices p on p.id=d.device_id and p.owner_id=d.owner_id join pomar_private.owner_registry r on r.owner_id=d.owner_id and r.active
  where d.id=p_id and d.lease_token=p_lease and d.status='sending' and d.lease_until>now() and n.active and n.expires_at>now() and p.active
  and (n.kind<>'meeting' or exists(select 1 from public.pomar_meetings m where m.owner_id=n.owner_id and m.id=n.source_id and m.reminder_version=n.source_version and m.status='scheduled')));
end $$;
create function public.pomar_notification_ack(p_id uuid,p_lease uuid,p_result text) returns void language plpgsql security definer set search_path='' as $$
declare device uuid;begin
 if session_user<>'pomar_notification_worker' then raise exception using errcode='42501',message='POMAR_ACCESS';end if;
 if p_result is null or p_result not in('sent','retry','gone','failed') then raise exception using errcode='22023',message='POMAR_BAD_COMMAND';end if;
 update pomar_private.push_deliveries set status=case when p_result='sent' then 'sent' when p_result='retry' and attempts<5 then 'pending' else 'failed' end,
  available_at=now()+make_interval(mins=>least(60,(power(2,attempts))::integer)),lease_token=null,lease_until=null
 where id=p_id and lease_token=p_lease and status='sending' and lease_until>now() returning device_id into device;
 if p_result='gone' and device is not null then update pomar_private.push_devices set active=false where id=device;end if;
end $$;
revoke all on function public.pomar_notifications_claim(integer),public.pomar_notification_delivery_valid(uuid,uuid),public.pomar_notification_ack(uuid,uuid,text) from public,anon,authenticated,pomar_billing_worker;
grant execute on function public.pomar_notifications_claim(integer),public.pomar_notification_delivery_valid(uuid,uuid),public.pomar_notification_ack(uuid,uuid,text) to pomar_notification_worker;
notify pgrst,'reload schema';
commit;
