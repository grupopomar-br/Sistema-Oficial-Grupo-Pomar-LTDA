-- Aplicação manual após project_completion_date. Não altera pagamentos ou recebimentos.
begin;
do $$ begin
 if to_regprocedure('public.pomar_workspace_enriched()') is null then
  raise exception 'Aplique primeiro a migração project_completion_date desta versão.';
 end if;
 if to_regclass('storage.objects') is null then
  raise exception 'O Storage do Supabase precisa estar disponível para as fotos de perfil.';
 end if;
end $$;

-- Mesmas verificações de identidade, revogação e limite absoluto de oito horas.
-- Somente as janelas de inatividade e de confirmação recente são ampliadas.
create or replace function pomar_private.recent_mfa() returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce(auth.jwt()->>'aal'='aal2' and exists(
  select 1 from jsonb_array_elements(case when jsonb_typeof(auth.jwt()->'amr')='array' then auth.jwt()->'amr' else '[]'::jsonb end) a
  where a->>'method'='totp' and case when (a->>'timestamp') ~ '^\d{1,12}$'
   then (a->>'timestamp')::bigint between floor(extract(epoch from now()))::bigint-1800 and floor(extract(epoch from now()))::bigint+30 else false end),false);
$$;
create or replace function pomar_private.is_owner() returns boolean
language sql stable security definer set search_path='' as $$
 select pomar_private.owner_identity_valid() and exists(select 1 from pomar_private.session_guard
  where owner_id=auth.uid() and session_id::text=auth.jwt()->>'session_id' and locked_at is null
  and last_activity_at>now()-interval '60 minutes');
$$;
create or replace function public.pomar_touch_session() returns text
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
 if guard.owner_id<>auth.uid() or guard.locked_at is not null or guard.last_activity_at<=now()-interval '60 minutes' then return 'denied'; end if;
 update pomar_private.session_guard set last_activity_at=now() where session_id=sid;
 return 'granted';
end $$;
create function public.pomar_touch_session_v2() returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('status',public.pomar_touch_session(),
  'policy',jsonb_build_object('idleTimeoutMs',3600000,'sensitiveMfaSeconds',1800));
$$;
revoke all on function public.pomar_touch_session_v2() from public,anon;
grant execute on function public.pomar_touch_session_v2() to authenticated;

create table public.pomar_methodologies (
 id uuid primary key,owner_id uuid not null references auth.users(id),
 version integer not null default 1 check(version>0),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 title text not null check(char_length(trim(title)) between 2 and 160),
 service text not null default '' check(char_length(service)<=120),
 purpose text not null default '' check(char_length(purpose)<=3000),
 steps text not null default '' check(char_length(steps)<=20000),
 differentiators text not null default '' check(char_length(differentiators)<=8000),
 deliverables text not null default '' check(char_length(deliverables)<=8000),
 quality_criteria text not null default '' check(char_length(quality_criteria)<=8000),
 notes text not null default '' check(char_length(notes)<=10000),archived boolean not null default false,
 unique(owner_id,id)
);
create index on public.pomar_methodologies(owner_id,archived,updated_at desc);
create table public.pomar_profiles (
 id uuid primary key,owner_id uuid not null unique references auth.users(id),
 version integer not null default 1 check(version>0),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 avatar_path text not null default '', check(id=owner_id),
 check(avatar_path in('','brand') or (split_part(avatar_path,'/',1)=owner_id::text
  and avatar_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$'))
);
do $$ declare t text; begin
 foreach t in array array['methodologies','profiles'] loop
  execute format('alter table public.pomar_%I enable row level security',t);
  execute format('alter table public.pomar_%I force row level security',t);
  execute format('revoke all on public.pomar_%I from public,anon,authenticated',t);
  execute format('grant select,insert,update on public.pomar_%I to authenticated',t);
  execute format('create policy owner_access on public.pomar_%I to authenticated using(owner_id=(select auth.uid()) and (select pomar_private.is_owner())) with check(owner_id=(select auth.uid()) and (select pomar_private.is_owner()))',t);
  execute format('create trigger touch_record before insert or update on public.pomar_%I for each row execute function pomar_private.touch_record()',t);
  execute format('create trigger audit_record after insert or update on public.pomar_%I for each row execute function pomar_private.audit_record(%L)',t,case when t='profiles' then 'profile' else 'methodology' end);
 end loop;
end $$;

-- Extensão dos comandos; as operações existentes mantêm sua implementação.
alter function public.pomar_command(uuid,jsonb) rename to pomar_command_before_personalization;
alter function public.pomar_command_before_personalization(uuid,jsonb) set schema pomar_private;
revoke all on function pomar_private.pomar_command_before_personalization(uuid,jsonb) from public,anon;
grant execute on function pomar_private.pomar_command_before_personalization(uuid,jsonb) to authenticated;
create function public.pomar_command(p_key uuid,p_command jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare kind text:=p_command->>'type';v jsonb:=p_command->'value'; n integer;old_payload jsonb; expected integer;path text;
begin
 if kind is null or kind not in('saveMethodology','saveProfile') then
  return pomar_private.pomar_command_before_personalization(p_key,p_command);
 end if;
 if not pomar_private.is_owner() then raise exception using errcode='42501',message='POMAR_ACCESS'; end if;
 if p_key is null or jsonb_typeof(p_command)<>'object' then raise exception using errcode='22023',message='POMAR_BAD_COMMAND'; end if;
 insert into public.pomar_command_log(owner_id,command_id,payload) values(auth.uid(),p_key,p_command) on conflict do nothing;
 get diagnostics n=row_count;
 if n=0 then
  select payload into old_payload from public.pomar_command_log where owner_id=auth.uid() and command_id=p_key;
  if old_payload is distinct from p_command then raise exception using errcode='P0001',message='POMAR_KEY_REUSED'; end if;
  return jsonb_build_object('duplicate',true);
 end if;
 if kind='saveMethodology' then
  if exists(select 1 from public.pomar_methodologies where owner_id=auth.uid() and id=(v->>'id')::uuid) then
   update public.pomar_methodologies set title=v->>'title',service=v->>'service',purpose=v->>'purpose',steps=v->>'steps',
    differentiators=v->>'differentiators',deliverables=v->>'deliverables',quality_criteria=v->>'quality_criteria',notes=v->>'notes',archived=(v->>'archived')::boolean
    where owner_id=auth.uid() and id=(v->>'id')::uuid and version=(v->>'version')::integer;
   get diagnostics n=row_count;
   if n<>1 then raise exception using errcode='P0001',message='POMAR_CONFLICT'; end if;
  else
   if (select count(*) from public.pomar_methodologies where owner_id=auth.uid())>=1000 then raise exception using errcode='P0001',message='POMAR_SNAPSHOT_LIMIT'; end if;
   if (v->>'version')::integer is distinct from 1 then raise exception using errcode='P0001',message='POMAR_CONFLICT'; end if;
   insert into public.pomar_methodologies(id,owner_id,title,service,purpose,steps,differentiators,deliverables,quality_criteria,notes,archived)
    values((v->>'id')::uuid,auth.uid(),v->>'title',v->>'service',v->>'purpose',v->>'steps',v->>'differentiators',v->>'deliverables',v->>'quality_criteria',v->>'notes',(v->>'archived')::boolean);
  end if;
 else
  expected:=(p_command->>'expected_version')::integer;path:=p_command->>'avatar_path';
  if expected is null or expected<0 or path is null then raise exception using errcode='22023',message='POMAR_BAD_COMMAND'; end if;
  if expected=0 then
   insert into public.pomar_profiles(id,owner_id,avatar_path) values(auth.uid(),auth.uid(),path) on conflict do nothing;
   get diagnostics n=row_count;
  else
   update public.pomar_profiles set avatar_path=path where owner_id=auth.uid() and version=expected;
   get diagnostics n=row_count;
  end if;
  if n<>1 then raise exception using errcode='P0001',message='POMAR_CONFLICT'; end if;
 end if;
 return jsonb_build_object('duplicate',false);
end $$;
revoke all on function public.pomar_command(uuid,jsonb) from public,anon;
grant execute on function public.pomar_command(uuid,jsonb) to authenticated;

-- Endpoint novo: snapshots anteriores continuam compatíveis com o rollback da aplicação.
create function public.pomar_workspace_personalized() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;items jsonb;profile jsonb;
begin
 result:=public.pomar_workspace_enriched();
 if (select count(*) from public.pomar_methodologies where owner_id=auth.uid())>1000 then raise exception using errcode='P0001',message='POMAR_SNAPSHOT_LIMIT'; end if;
 select coalesce(jsonb_agg(to_jsonb(m)-'owner_id' order by updated_at desc,id),'[]'::jsonb) into items
  from public.pomar_methodologies m where owner_id=auth.uid();
 select jsonb_build_object('avatar_path',avatar_path,'version',version) into profile from public.pomar_profiles where owner_id=auth.uid();
 return result||jsonb_build_object('personalization_ready',true,'methodologies',items,'profile',coalesce(profile,jsonb_build_object('avatar_path','','version',0)));
end $$;
revoke all on function public.pomar_workspace_personalized() from public,anon;
grant execute on function public.pomar_workspace_personalized() to authenticated;

-- Objetos privados. Sem upsert, sem URL pública e sem permissão no worker financeiro.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('pomar-profile','pomar-profile',false,2097152,array['image/webp']);
create policy pomar_profile_read on storage.objects for select to authenticated
 using(bucket_id='pomar-profile' and split_part(name,'/',1)=(select auth.uid())::text and (select pomar_private.is_owner()));
create policy pomar_profile_insert on storage.objects for insert to authenticated
 with check(bucket_id='pomar-profile' and split_part(name,'/',1)=(select auth.uid())::text
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$' and (select pomar_private.is_owner()));
create policy pomar_profile_delete on storage.objects for delete to authenticated
 using(bucket_id='pomar-profile' and split_part(name,'/',1)=(select auth.uid())::text and (select pomar_private.is_owner())
  and not exists(select 1 from public.pomar_profiles p where p.owner_id=(select auth.uid()) and p.avatar_path=name));
notify pgrst,'reload schema';
commit;
