-- Resultados informados manualmente e dados mínimos para avisos personalizados.
-- Aplicar uma vez após reunioes_e_notificacoes. Não ativa cartão nem altera o Pix.
begin;

create table public.pomar_google_results (
 id uuid primary key, owner_id uuid not null references auth.users(id),
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 client_id uuid not null,profile_name text not null check(char_length(btrim(profile_name)) between 2 and 160),
 profile_url text not null default '' check(profile_url='' or (char_length(profile_url)<=2048 and profile_url ~ '^https://[^/@[:space:]]+(/|$)')),
 period_start date not null,period_end date not null,collected_on date not null,
 interactions bigint check(interactions between 0 and 1000000000),
 calls bigint check(calls between 0 and 1000000000),
 bookings bigint check(bookings between 0 and 1000000000),
 directions bigint check(directions between 0 and 1000000000),
 website_clicks bigint check(website_clicks between 0 and 1000000000),
 profile_views bigint check(profile_views between 0 and 1000000000),
 notes text not null default '' check(char_length(notes)<=5000),
 verified boolean not null default false,archived boolean not null default false,
 foreign key(owner_id,client_id) references public.pomar_clients(owner_id,id),
 unique(owner_id,id),
 check(period_start>=date '1900-01-01' and period_end>=period_start and collected_on>=period_end),
 check(collected_on<=(now() at time zone 'America/Fortaleza')::date),
 check(num_nonnulls(interactions,calls,bookings,directions,website_clicks,profile_views)>0)
);
create unique index pomar_google_result_period on public.pomar_google_results(owner_id,client_id,lower(btrim(profile_name)),period_start,period_end) where not archived;
create index pomar_google_result_history on public.pomar_google_results(owner_id,client_id,archived,period_end desc);
alter table public.pomar_google_results enable row level security;
alter table public.pomar_google_results force row level security;
revoke all on public.pomar_google_results from public,anon,authenticated,pomar_billing_worker,pomar_notification_worker;
grant select,insert,update on public.pomar_google_results to authenticated;
create policy owner_access on public.pomar_google_results to authenticated
 using(owner_id=(select auth.uid()) and (select pomar_private.is_owner()))
 with check(owner_id=(select auth.uid()) and (select pomar_private.is_owner()));
create trigger touch_record before insert or update on public.pomar_google_results for each row execute function pomar_private.touch_record();
create trigger audit_record after insert or update on public.pomar_google_results for each row execute function pomar_private.audit_record('google_result');

alter function public.pomar_command(uuid,jsonb) rename to pomar_command_before_results;
alter function public.pomar_command_before_results(uuid,jsonb) set schema pomar_private;
revoke all on function pomar_private.pomar_command_before_results(uuid,jsonb) from public,anon;
grant execute on function pomar_private.pomar_command_before_results(uuid,jsonb) to authenticated;
create function public.pomar_command(p_key uuid,p_command jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v jsonb:=p_command->'value';old_payload jsonb;n integer;metric text;item public.pomar_google_results;
begin
 if p_command->>'type' is distinct from 'saveGoogleResult' then return pomar_private.pomar_command_before_results(p_key,p_command);end if;
 if not pomar_private.is_owner() then raise exception using errcode='42501',message='POMAR_ACCESS';end if;
 if p_key is null or jsonb_typeof(v) is distinct from 'object' then raise exception using errcode='22023',message='POMAR_BAD_COMMAND';end if;
 foreach metric in array array['interactions','calls','bookings','directions','website_clicks','profile_views'] loop
  if v->>metric is not null and (jsonb_typeof(v->metric)<>'number' or v->>metric !~ '^[0-9]{1,10}$') then
   raise exception using errcode='22023',message='POMAR_BAD_COMMAND';end if;
 end loop;
 select * into item from jsonb_populate_record(null::public.pomar_google_results,v);
 insert into public.pomar_command_log(owner_id,command_id,payload) values(auth.uid(),p_key,p_command) on conflict do nothing;get diagnostics n=row_count;
 if n=0 then
  select payload into old_payload from public.pomar_command_log where owner_id=auth.uid() and command_id=p_key;
  if old_payload is distinct from p_command then raise exception using errcode='P0001',message='POMAR_KEY_REUSED';end if;
  return jsonb_build_object('duplicate',true);
 end if;
 if exists(select 1 from public.pomar_google_results where owner_id=auth.uid() and id=item.id) then
  update public.pomar_google_results set client_id=item.client_id,profile_name=btrim(item.profile_name),profile_url=item.profile_url,
   period_start=item.period_start,period_end=item.period_end,collected_on=item.collected_on,
   interactions=item.interactions,calls=item.calls,bookings=item.bookings,directions=item.directions,website_clicks=item.website_clicks,profile_views=item.profile_views,
   notes=item.notes,verified=item.verified,archived=item.archived
   where owner_id=auth.uid() and id=item.id and version=item.version;get diagnostics n=row_count;
  if n<>1 then raise exception using errcode='P0001',message='POMAR_CONFLICT';end if;
 else
  if (select count(*) from public.pomar_google_results where owner_id=auth.uid())>=10000 then raise exception using errcode='P0001',message='POMAR_SNAPSHOT_LIMIT';end if;
  if item.version is distinct from 1 then raise exception using errcode='P0001',message='POMAR_CONFLICT';end if;
  insert into public.pomar_google_results(id,owner_id,client_id,profile_name,profile_url,period_start,period_end,collected_on,interactions,calls,bookings,directions,website_clicks,profile_views,notes,verified,archived)
  values(item.id,auth.uid(),item.client_id,btrim(item.profile_name),item.profile_url,item.period_start,item.period_end,item.collected_on,item.interactions,item.calls,item.bookings,item.directions,item.website_clicks,item.profile_views,item.notes,item.verified,item.archived);
 end if;
 return jsonb_build_object('duplicate',false);
end $$;
revoke all on function public.pomar_command(uuid,jsonb) from public,anon;
grant execute on function public.pomar_command(uuid,jsonb) to authenticated;

create function public.pomar_workspace_results() returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;items jsonb;begin
 result:=public.pomar_workspace_scheduled();
 if (select count(*) from public.pomar_google_results where owner_id=auth.uid())>10000 then raise exception using errcode='P0001',message='POMAR_SNAPSHOT_LIMIT';end if;
 select coalesce(jsonb_agg(to_jsonb(r)-'owner_id' order by r.period_end desc,r.id),'[]'::jsonb) into items from public.pomar_google_results r where owner_id=auth.uid();
 return result||jsonb_build_object('google_results_ready',true,'google_results',items);
end $$;
revoke all on function public.pomar_workspace_results() from public,anon;
grant execute on function public.pomar_workspace_results() to authenticated;

-- Só o valor confirmado e o horário do lembrete; sem cliente, documento ou pauta.
-- RPC novo mantém compatibilidade com implantações anteriores e a fila existente.
create function public.pomar_notifications_claim_personalized(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path='' as $$
declare jobs jsonb;items jsonb;begin
 if session_user<>'pomar_notification_worker' then raise exception using errcode='42501',message='POMAR_ACCESS';end if;
 jobs:=public.pomar_notifications_claim(p_limit);
 select coalesce(jsonb_agg(j.value||jsonb_build_object('amountCents',p.amount_cents,'meetingStartsAt',m.starts_at) order by j.ordinality),'[]'::jsonb) into items
 from jsonb_array_elements(jobs) with ordinality j(value,ordinality)
 left join public.pomar_provider_payments p on j.value->>'kind'='sale' and p.id=(j.value->>'sourceId')::uuid and p.mode='live' and p.status='approved'
  and exists(select 1 from public.pomar_charges c where c.id=p.charge_id and c.owner_id=p.owner_id and c.mode='live' and c.amount_cents=p.amount_cents)
 left join public.pomar_meetings m on j.value->>'kind'='meeting' and m.id=(j.value->>'sourceId')::uuid;
 return items;
end $$;
revoke all on function public.pomar_notifications_claim_personalized(integer) from public,anon,authenticated,pomar_billing_worker;
grant execute on function public.pomar_notifications_claim_personalized(integer) to pomar_notification_worker;

create function public.pomar_notifications_list_personalized() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;items jsonb;begin
 if not pomar_private.is_owner() then raise exception using errcode='42501',message='POMAR_ACCESS';end if;
 result:=public.pomar_notifications_list();
 select coalesce(jsonb_agg(j.value||jsonb_build_object('amount_cents',p.amount_cents,'meeting_starts_at',m.starts_at) order by j.ordinality),'[]'::jsonb) into items
 from jsonb_array_elements(result->'items') with ordinality j(value,ordinality)
 left join public.pomar_provider_payments p on j.value->>'kind'='sale' and p.owner_id=auth.uid() and p.id=(j.value->>'source_id')::uuid and p.mode='live' and p.status='approved'
  and exists(select 1 from public.pomar_charges c where c.id=p.charge_id and c.owner_id=p.owner_id and c.mode='live' and c.amount_cents=p.amount_cents)
 left join public.pomar_meetings m on j.value->>'kind'='meeting' and m.owner_id=auth.uid() and m.id=(j.value->>'source_id')::uuid;
 return result||jsonb_build_object('items',items);
end $$;
revoke all on function public.pomar_notifications_list_personalized() from public,anon,pomar_billing_worker,pomar_notification_worker;
grant execute on function public.pomar_notifications_list_personalized() to authenticated;
notify pgrst,'reload schema';
commit;
