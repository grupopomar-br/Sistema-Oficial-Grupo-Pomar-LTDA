-- v0.4: sessão limitada, caixa de ideias e governança da cobrança. Aplicação manual.
begin;
create table pomar_private.session_guard (
 session_id uuid primary key references auth.sessions(id) on delete cascade,
 owner_id uuid not null references auth.users(id), opened_at timestamptz not null default now(),
 last_activity_at timestamptz not null default now(), locked_at timestamptz
);
revoke all on pomar_private.session_guard from public,anon,authenticated;
alter table pomar_private.session_guard enable row level security;
alter table pomar_private.session_guard force row level security;
alter table pomar_private.owner_registry enable row level security;
alter table pomar_private.owner_registry force row level security;
create function pomar_private.owner_identity_valid() returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(auth.uid() is not null and auth.jwt()->>'aal'='aal2'
 and exists(select 1 from pomar_private.owner_registry where active and owner_id=auth.uid())
 and exists(select 1 from auth.sessions where user_id=auth.uid() and id::text=auth.jwt()->>'session_id' and (not_after is null or not_after>now()) and created_at>=now()-interval '8 hours' and created_at<=now()+interval '30 seconds'),false);
$$;
create function pomar_private.recent_mfa() returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce(auth.jwt()->>'aal'='aal2' and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(auth.jwt()->'amr')='array' then auth.jwt()->'amr' else '[]'::jsonb end) a
 where a->>'method'='totp' and (a->>'timestamp') ~ '^\d{1,12}$'
 and case when (a->>'timestamp') ~ '^\d{1,12}$' then (a->>'timestamp')::bigint between extract(epoch from now())::bigint-300 and extract(epoch from now())::bigint+30 else false end),false);
$$;
create or replace function pomar_private.is_owner() returns boolean
language sql stable security definer set search_path='' as $$
 select pomar_private.owner_identity_valid() and exists(select 1 from pomar_private.session_guard
 where owner_id=auth.uid() and session_id::text=auth.jwt()->>'session_id' and locked_at is null and last_activity_at>now()-interval '15 minutes');
$$;
-- Nenhum ID é aceito do cliente: usa somente as claims verificadas pelo Auth.
create function public.pomar_touch_session() returns text
language plpgsql security definer set search_path='' as $$
declare sid uuid; guard pomar_private.session_guard;
begin
 if not pomar_private.owner_identity_valid() then return 'denied'; end if;
 sid:=(auth.jwt()->>'session_id')::uuid;
 select * into guard from pomar_private.session_guard where session_id=sid for update;
 if not found then
  if not pomar_private.recent_mfa() then return 'needs_mfa'; end if;
  insert into pomar_private.session_guard(session_id,owner_id) values(sid,auth.uid()) on conflict do nothing;
  select * into guard from pomar_private.session_guard where session_id=sid for update;
 end if;
 if guard.owner_id<>auth.uid() or guard.locked_at is not null or guard.last_activity_at<=now()-interval '15 minutes' then return 'denied'; end if;
 update pomar_private.session_guard set last_activity_at=now() where session_id=sid;
 return 'granted';
end $$;
create function public.pomar_lock_session() returns void
language plpgsql security definer set search_path='' as $$
begin
 update pomar_private.session_guard set locked_at=coalesce(locked_at,now()) where owner_id=auth.uid() and session_id::text=auth.jwt()->>'session_id';
end $$;
revoke all on function pomar_private.owner_identity_valid(),pomar_private.recent_mfa(),public.pomar_touch_session(),public.pomar_lock_session() from public,anon,authenticated;
grant execute on function public.pomar_touch_session(),public.pomar_lock_session(),pomar_private.recent_mfa() to authenticated;

create table public.pomar_ideas (
 id uuid primary key,owner_id uuid not null references auth.users(id),version integer not null default 1 check(version>0),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 title text not null check(char_length(title) between 2 and 160),detail text not null default '' check(char_length(detail)<=10000),
 category text not null check(category in('general','operations','billing','security','automation','product')),
 priority text not null check(priority in('P0','P1','P2','P3')),stage text not null check(stage in('inbox','planned','doing','done','archived')),task_id uuid,
 unique(owner_id,id),foreign key(owner_id,task_id) references public.pomar_tasks(owner_id,id)
);
create table public.pomar_collection_agreements (
 id uuid primary key,owner_id uuid not null references auth.users(id),version integer not null default 1 check(version>0),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 contract_id uuid not null,initial_cents bigint not null check(initial_cents between 0 and 100000000000),gate text not null check(gate in('none','initial','full')),
 grace_days integer not null default 0 check(grace_days between 0 and 30),accepted_on date,terms_reference text not null default '' check(char_length(terms_reference)<=500),notes text not null default '' check(char_length(notes)<=5000),
 check(gate<>'initial' or initial_cents>0),check(accepted_on is null or char_length(trim(terms_reference))>=3),unique(owner_id,id),unique(owner_id,contract_id),foreign key(owner_id,contract_id) references public.pomar_contracts(owner_id,id)
);
create table public.pomar_collection_actions (
 id uuid primary key,owner_id uuid not null references auth.users(id),version integer not null default 1 check(version>0),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 installment_id uuid not null,kind text not null check(kind in('contact','reminder','promise','dispute')),channel text not null check(channel in('manual','email','whatsapp','phone')),
 note text not null check(char_length(note) between 3 and 2000),promise_on date,check(kind<>'promise' or promise_on is not null),unique(owner_id,id),foreign key(owner_id,installment_id) references public.pomar_installments(owner_id,id)
);
do $$ declare t text; begin
 foreach t in array array['ideas','collection_agreements','collection_actions'] loop
  execute format('alter table public.pomar_%I enable row level security',t);execute format('alter table public.pomar_%I force row level security',t);
  execute format('revoke all on public.pomar_%I from public,anon,authenticated',t);execute format('grant select,insert on public.pomar_%I to authenticated',t);
  execute format('create policy owner_access on public.pomar_%I to authenticated using(owner_id=(select auth.uid()) and (select pomar_private.is_owner())) with check(owner_id=(select auth.uid()) and (select pomar_private.is_owner()))',t);
  execute format('create trigger touch_record before insert or update on public.pomar_%I for each row execute function pomar_private.touch_record()',t);
  execute format('create trigger audit_record after insert or update on public.pomar_%I for each row execute function pomar_private.audit_record(%L)',t,case when t='ideas' then 'idea' else 'collection' end);
 end loop;
end $$;
grant update on public.pomar_ideas,public.pomar_collection_agreements to authenticated;
create index on public.pomar_ideas(owner_id,stage,priority);
create index on public.pomar_ideas(owner_id,task_id);
create index on public.pomar_collection_actions(owner_id,installment_id,created_at desc);
create function pomar_private.check_collection_agreement() returns trigger language plpgsql security invoker set search_path='' as $$
declare total bigint;
begin
 select total_cents into total from public.pomar_contracts where owner_id=new.owner_id and id=new.contract_id;
 if new.initial_cents>total or new.accepted_on>(now() at time zone 'America/Fortaleza')::date then raise exception using errcode='22023',message='POMAR_BAD_COMMAND'; end if;
 return new;
end $$;
create trigger agreement_guard before insert or update on public.pomar_collection_agreements for each row execute function pomar_private.check_collection_agreement();
revoke all on function pomar_private.check_collection_agreement() from public,anon,authenticated;

-- A versão anterior permanece privada. A transação envolve criação/conversão e log.
alter function public.pomar_command(uuid,jsonb) rename to pomar_command_v1;
alter function public.pomar_command_v1(uuid,jsonb) set schema pomar_private;
alter function public.pomar_workspace() rename to pomar_workspace_v1;
alter function public.pomar_workspace_v1() set schema pomar_private;
create function public.pomar_command(p_key uuid,p_command jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare kind text:=p_command->>'type';v jsonb:=p_command->'value';n integer;old_payload jsonb;idea public.pomar_ideas;
begin
 if kind not in('saveIdea','saveCollectionAgreement','addCollectionAction','convertIdeaToTask') then return pomar_private.pomar_command_v1(p_key,p_command);end if;
 if not pomar_private.is_owner() then raise exception using errcode='42501',message='POMAR_ACCESS';end if;
 insert into public.pomar_command_log(owner_id,command_id,payload) values(auth.uid(),p_key,p_command) on conflict do nothing;get diagnostics n=row_count;
 if n=0 then select payload into old_payload from public.pomar_command_log where owner_id=auth.uid() and command_id=p_key;if old_payload is distinct from p_command then raise exception using errcode='P0001',message='POMAR_KEY_REUSED';end if;return jsonb_build_object('duplicate',true);end if;
 if kind='saveIdea' then
  if exists(select 1 from public.pomar_ideas where owner_id=auth.uid() and id=(v->>'id')::uuid) then
   update public.pomar_ideas set title=v->>'title',detail=v->>'detail',category=v->>'category',priority=v->>'priority',stage=v->>'stage' where owner_id=auth.uid() and id=(v->>'id')::uuid and version=(v->>'version')::integer;get diagnostics n=row_count;
   if n<>1 then raise exception using errcode='P0001',message='POMAR_CONFLICT';end if;
  else insert into public.pomar_ideas(id,owner_id,title,detail,category,priority,stage,task_id) values((v->>'id')::uuid,auth.uid(),v->>'title',v->>'detail',v->>'category',v->>'priority',v->>'stage',null);end if;
 elsif kind='saveCollectionAgreement' then
  if exists(select 1 from public.pomar_collection_agreements where owner_id=auth.uid() and id=(v->>'id')::uuid) then
   update public.pomar_collection_agreements set initial_cents=(v->>'initial_cents')::bigint,gate=v->>'gate',grace_days=(v->>'grace_days')::integer,accepted_on=(v->>'accepted_on')::date,terms_reference=v->>'terms_reference',notes=v->>'notes'
   where owner_id=auth.uid() and id=(v->>'id')::uuid and contract_id=(v->>'contract_id')::uuid and version=(v->>'version')::integer;get diagnostics n=row_count;
   if n<>1 then raise exception using errcode='P0001',message='POMAR_CONFLICT';end if;
  else insert into public.pomar_collection_agreements(id,owner_id,contract_id,initial_cents,gate,grace_days,accepted_on,terms_reference,notes)
   values((v->>'id')::uuid,auth.uid(),(v->>'contract_id')::uuid,(v->>'initial_cents')::bigint,v->>'gate',(v->>'grace_days')::integer,(v->>'accepted_on')::date,v->>'terms_reference',v->>'notes');end if;
 elsif kind='addCollectionAction' then
  insert into public.pomar_collection_actions(id,owner_id,installment_id,kind,channel,note,promise_on) values((v->>'id')::uuid,auth.uid(),(v->>'installment_id')::uuid,v->>'kind',v->>'channel',v->>'note',(v->>'promise_on')::date);
 elsif kind='convertIdeaToTask' then
  select * into idea from public.pomar_ideas where owner_id=auth.uid() and id=(p_command->>'id')::uuid for update;
  if idea.id is null then raise exception using errcode='P0001',message='POMAR_NOT_FOUND';end if;
  if idea.task_id is null then
   insert into public.pomar_tasks(id,owner_id,title,description,project_id,priority,status,focus_on) values((p_command->>'task_id')::uuid,auth.uid(),idea.title,idea.detail,(p_command->>'project_id')::uuid,idea.priority,'pending',(now() at time zone 'America/Fortaleza')::date);
   update public.pomar_ideas set task_id=(p_command->>'task_id')::uuid,stage='planned' where owner_id=auth.uid() and id=idea.id;
  end if;
 end if;return jsonb_build_object('duplicate',false);
end $$;
create function public.pomar_workspace() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;rows jsonb;t text;n bigint;
begin
 result:=pomar_private.pomar_workspace_v1();
 foreach t in array array['ideas','collection_agreements','collection_actions'] loop
  execute format('select count(*) from public.pomar_%I where owner_id=$1',t) into n using auth.uid();if n>(case when t='collection_actions' then 20000 else 10000 end) then raise exception using errcode='P0001',message='POMAR_SNAPSHOT_LIMIT';end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(r)-''owner_id'' order by created_at,id),''[]''::jsonb) from public.pomar_%I r where owner_id=$1',t) into rows using auth.uid();result:=result||jsonb_build_object(t,rows);
 end loop;return result;
end $$;
revoke all on function public.pomar_command(uuid,jsonb),public.pomar_workspace() from public,anon;
grant execute on function public.pomar_command(uuid,jsonb),public.pomar_workspace() to authenticated;
commit;
