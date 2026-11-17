-- Cada medição pertence a uma atualização. O histórico anterior continua válido.
begin;

create table if not exists pomar_private.project_update_progress (
 update_id uuid primary key,
 owner_id uuid not null,
 progress_percent integer not null check (progress_percent between 0 and 100),
 foreign key(owner_id,update_id) references public.pomar_updates(owner_id,id)
);
alter table pomar_private.project_update_progress enable row level security;
alter table pomar_private.project_update_progress force row level security;
revoke all on pomar_private.project_update_progress from public,anon,authenticated;
grant select on pomar_private.project_update_progress to authenticated;
drop policy if exists project_progress_owner on pomar_private.project_update_progress;
create policy project_progress_owner on pomar_private.project_update_progress
 for select to authenticated
 using (owner_id=(select auth.uid()) and (select pomar_private.is_owner()));

create or replace function pomar_private.record_project_update(
 p_key uuid,p_project uuid,p_version integer,p_message text,
 p_progress integer,p_next_action text,p_next_action_on date
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid();
 project public.pomar_projects;
 removed boolean;
 payload jsonb:=jsonb_build_object(
  'type','recordProjectUpdate','project_id',p_project,'expected_version',p_version,
  'message',p_message,'progress_percent',p_progress,'next_action',p_next_action,
  'next_action_on',p_next_action_on
 );
begin
 if pomar_private.is_owner() is distinct from true then
  raise exception using errcode='42501',message='POMAR_ACCESS';
 end if;
 if p_key is null or p_project is null or p_version is null or p_version<1
  or p_message is null or char_length(btrim(p_message)) not between 3 and 5000
  or p_progress not between 0 and 100
  or p_next_action is null or char_length(p_next_action)>1000
  or (p_next_action_on is not null and btrim(p_next_action)='')
 then raise exception using errcode='22023',message='POMAR_BAD_COMMAND'; end if;

 insert into public.pomar_command_log(owner_id,command_id,payload)
 values(uid,p_key,payload) on conflict do nothing;
 if not found then
  if (select l.payload from public.pomar_command_log l where l.owner_id=uid and l.command_id=p_key)
    is distinct from payload then
   raise exception using errcode='P0001',message='POMAR_KEY_REUSED';
  end if;
  return jsonb_build_object('duplicate',true);
 end if;

 select * into project from public.pomar_projects
 where owner_id=uid and id=p_project for update;
 if not found then raise exception using errcode='P0001',message='POMAR_NOT_FOUND'; end if;
 if project.version<>p_version then
  raise exception using errcode='P0001',message='POMAR_CONFLICT';
 end if;
 if to_regclass('pomar_private.project_removals') is not null then
  select exists(select 1 from pomar_private.project_removals
   where owner_id=uid and project_id=p_project) into removed;
  if removed then raise exception using errcode='P0001',message='POMAR_UPDATE_REMOVED'; end if;
 end if;
 if project.status in ('completed','cancelled') then
  raise exception using errcode='P0001',message='POMAR_UPDATE_CLOSED';
 end if;

 update public.pomar_projects set next_action=btrim(p_next_action),next_action_on=p_next_action_on
 where owner_id=uid and id=p_project;
 insert into public.pomar_updates(id,owner_id,project_id,message)
 values(p_key,uid,p_project,btrim(p_message));
 if p_progress is not null then
  insert into pomar_private.project_update_progress(update_id,owner_id,progress_percent)
  values(p_key,uid,p_progress);
 end if;
 return jsonb_build_object('duplicate',false);
end $$;

create or replace function public.pomar_record_project_update(
 p_key uuid,p_project uuid,p_version integer,p_message text,
 p_progress integer,p_next_action text,p_next_action_on date
) returns jsonb
language sql security invoker set search_path='' as $$
 select pomar_private.record_project_update(p_key,p_project,p_version,p_message,p_progress,p_next_action,p_next_action_on);
$$;

-- Um snapshot consistente reúne o workspace, os projetos removidos e o avanço registrado.
create or replace function public.pomar_workspace_project_updates() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare
 snapshot jsonb;
 reader text;
 removal_dates jsonb;
 projects jsonb;
 updates jsonb;
begin
 if pomar_private.is_owner() is distinct from true then
  raise exception using errcode='42501',message='POMAR_ACCESS';
 end if;
 foreach reader in array array[
  'pomar_workspace_expense_purposes','pomar_workspace_collection_queue',
  'pomar_workspace_client_terms','pomar_workspace_cards','pomar_workspace_results',
  'pomar_workspace_scheduled','pomar_workspace_personalized','pomar_workspace_enriched',
  'pomar_workspace'
 ] loop
  if to_regprocedure('public.'||reader||'()') is not null then
   execute format('select public.%I()',reader) into snapshot;
   exit;
  end if;
 end loop;

 if to_regprocedure('public.pomar_project_removal_dates()') is not null then
  removal_dates:=public.pomar_project_removal_dates();
  select coalesce(jsonb_agg(
   case when removal_dates ? (p.value->>'id')
    then p.value||jsonb_build_object('removed_at',removal_dates->(p.value->>'id'))
    else p.value end order by p.position
  ),'[]'::jsonb) into projects
  from jsonb_array_elements(snapshot->'projects') with ordinality p(value,position);
  snapshot:=snapshot||jsonb_build_object('project_removal_ready',true,'projects',projects);
 end if;
 select coalesce(jsonb_agg(
  case when progress.update_id is not null
   then u.value||jsonb_build_object('progress_percent',progress.progress_percent)
   else u.value end order by u.position
 ),'[]'::jsonb) into updates
 from jsonb_array_elements(snapshot->'updates') with ordinality u(value,position)
 left join pomar_private.project_update_progress progress
  on progress.update_id=(u.value->>'id')::uuid and progress.owner_id=auth.uid();
 return snapshot||jsonb_build_object('project_updates_ready',true,'updates',updates);
end $$;

revoke all on function pomar_private.record_project_update(uuid,uuid,integer,text,integer,text,date),
 public.pomar_record_project_update(uuid,uuid,integer,text,integer,text,date),
 public.pomar_workspace_project_updates() from public,anon,authenticated;
grant execute on function pomar_private.record_project_update(uuid,uuid,integer,text,integer,text,date),
 public.pomar_record_project_update(uuid,uuid,integer,text,integer,text,date),
 public.pomar_workspace_project_updates() to authenticated;

notify pgrst,'reload schema';
commit;
