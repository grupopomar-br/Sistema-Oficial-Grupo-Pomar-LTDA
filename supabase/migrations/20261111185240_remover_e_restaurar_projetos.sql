-- Guarda a remoção separadamente para manter os vínculos e os snapshots anteriores.
begin;

create table if not exists pomar_private.project_removals (
 project_id uuid primary key,
 owner_id uuid not null,
 removed_at timestamptz not null default now(),
 foreign key(owner_id,project_id) references public.pomar_projects(owner_id,id)
);
alter table pomar_private.project_removals enable row level security;
alter table pomar_private.project_removals force row level security;
revoke all on pomar_private.project_removals from public,anon,authenticated;

create or replace function pomar_private.project_removal_dates() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not pomar_private.is_owner() then
  raise exception using errcode='42501',message='POMAR_ACCESS';
 end if;
 return (select coalesce(jsonb_object_agg(project_id,removed_at),'{}'::jsonb)
  from pomar_private.project_removals where owner_id=auth.uid());
end $$;

create or replace function pomar_private.set_project_removed(p_key uuid,p_id uuid,p_version integer,p_removed boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid();
 project public.pomar_projects;
 payload jsonb:=jsonb_build_object('type','setProjectRemoved','id',p_id,'expected_version',p_version,'removed',p_removed);
 affected integer;
begin
 if not pomar_private.is_owner() then
  raise exception using errcode='42501',message='POMAR_ACCESS';
 end if;
 if p_key is null or p_id is null or p_version is null or p_version<1 or p_removed is null then
  raise exception using errcode='22023',message='POMAR_BAD_COMMAND';
 end if;
 insert into public.pomar_command_log(owner_id,command_id,payload)
 values(uid,p_key,payload) on conflict do nothing;
 if not found then
  if (select l.payload from public.pomar_command_log l where l.owner_id=uid and l.command_id=p_key)
   is distinct from payload then
   raise exception using errcode='P0001',message='POMAR_KEY_REUSED';
  end if;
  return jsonb_build_object('duplicate',true);
 end if;

 select * into project from public.pomar_projects where owner_id=uid and id=p_id for update;
 if not found then raise exception using errcode='P0001',message='POMAR_NOT_FOUND'; end if;
 if project.version<>p_version then raise exception using errcode='P0001',message='POMAR_CONFLICT'; end if;

 if p_removed then
  insert into pomar_private.project_removals(project_id,owner_id)
  values(p_id,uid) on conflict do nothing;
 else
  delete from pomar_private.project_removals where project_id=p_id and owner_id=uid;
 end if;
 get diagnostics affected=row_count;
 if affected=0 then return jsonb_build_object('duplicate',false); end if;

 if p_removed and to_regclass('pomar_private.media_links') is not null then
  update pomar_private.media_links set revoked_at=now()
  where project_id=p_id and owner_id=uid and revoked_at is null;
 end if;
 -- O controle de versão invalida edições ou remoções feitas a partir de fichas antigas.
 update public.pomar_projects set updated_at=now() where owner_id=uid and id=p_id;
 insert into public.pomar_audit_events(owner_id,entity_type,entity_id,action,summary)
 values(uid,'project',p_id,case when p_removed then 'remove' else 'restore' end,
  (case when p_removed then 'Projeto removido: ' else 'Projeto restaurado: ' end)||project.name);
 return jsonb_build_object('duplicate',false);
end $$;

create or replace function public.pomar_project_removal_dates() returns jsonb
language sql stable security invoker set search_path='' as $$
 select pomar_private.project_removal_dates();
$$;
create or replace function public.pomar_set_project_removed(p_key uuid,p_id uuid,p_version integer,p_removed boolean) returns jsonb
language sql security invoker set search_path='' as $$
 select pomar_private.set_project_removed(p_key,p_id,p_version,p_removed);
$$;
revoke all on function pomar_private.project_removal_dates(),public.pomar_project_removal_dates(),
 pomar_private.set_project_removed(uuid,uuid,integer,boolean),public.pomar_set_project_removed(uuid,uuid,integer,boolean)
 from public,anon,authenticated;
grant execute on function pomar_private.project_removal_dates(),public.pomar_project_removal_dates(),
 pomar_private.set_project_removed(uuid,uuid,integer,boolean),public.pomar_set_project_removed(uuid,uuid,integer,boolean)
 to authenticated;

-- A emissão de convites e a remoção usam o mesmo lock do projeto.
create or replace function pomar_private.check_media_project_available() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from pomar_private.project_removals
  where project_id=new.project_id and owner_id=new.owner_id) then
  raise exception using errcode='P0001',message='POMAR_PROJECT_REMOVED';
 end if;
 return new;
end $$;
revoke all on function pomar_private.check_media_project_available() from public,anon,authenticated;
do $$
begin
 if to_regclass('pomar_private.media_links') is not null then
  drop trigger if exists check_media_project_available on pomar_private.media_links;
  create trigger check_media_project_available before insert on pomar_private.media_links
   for each row execute function pomar_private.check_media_project_available();
 end if;
end $$;

notify pgrst,'reload schema';
commit;
