-- Deploy the compatible application before applying this migration manually.
-- Older completed projects retain an unknown completion date; no backfill is inferred.
begin;
alter table public.pomar_projects add column completed_on date;
alter table public.pomar_projects add constraint pomar_project_completion_after_start
 check (completed_on is null or started_on is null or completed_on >= started_on);

create function pomar_private.track_project_completion() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op = 'INSERT' then
  new.completed_on := case when new.status='completed'
   then (now() at time zone 'America/Fortaleza')::date else null end;
 elsif old.status <> 'completed' and new.status = 'completed' then
  new.completed_on := (now() at time zone 'America/Fortaleza')::date;
 elsif old.status = 'completed' and new.status <> 'completed' then
  new.completed_on := null;
 else
  new.completed_on := old.completed_on;
 end if;
 return new;
end $$;

revoke all on function pomar_private.track_project_completion() from public,anon,authenticated;
create trigger track_project_completion before insert or update on public.pomar_projects
 for each row execute function pomar_private.track_project_completion();

-- Preserve the original snapshot shape for older deployments and rollbacks.
-- The new endpoint exposes the same owner-guarded snapshot with completed_on.
alter function public.pomar_workspace() rename to pomar_workspace_v3;
alter function public.pomar_workspace_v3() set schema pomar_private;
revoke all on function pomar_private.pomar_workspace_v3() from public,anon;
grant execute on function pomar_private.pomar_workspace_v3() to authenticated;

create function public.pomar_workspace() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare snapshot jsonb; old_projects jsonb;
begin
 snapshot := pomar_private.pomar_workspace_v3();
 select coalesce(jsonb_agg(value - 'completed_on' order by position),'[]'::jsonb)
  into old_projects from jsonb_array_elements(snapshot->'projects') with ordinality as p(value,position);
 return jsonb_set(snapshot,'{projects}',old_projects,false);
end $$;

create function public.pomar_workspace_enriched() returns jsonb
language sql stable security invoker set search_path='' as $$
 select pomar_private.pomar_workspace_v3();
$$;
revoke all on function public.pomar_workspace(),public.pomar_workspace_enriched() from public,anon;
grant execute on function public.pomar_workspace(),public.pomar_workspace_enriched() to authenticated;
notify pgrst, 'reload schema';
commit;
