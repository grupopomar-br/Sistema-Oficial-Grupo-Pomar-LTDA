-- O marcador no R2 bloqueia PUTs assinados antigos. Este registro impede reutilizar o ID.
begin;

create table pomar_private.media_removals (
 id uuid primary key,
 link_id uuid not null references pomar_private.media_links(id),
 removed_at timestamptz
);
create index media_removals_link on pomar_private.media_removals(link_id);
alter table pomar_private.media_removals enable row level security;
alter table pomar_private.media_removals force row level security;
revoke all on pomar_private.media_removals
 from public,anon,authenticated,pomar_media_worker,pomar_billing_worker,pomar_notification_worker;

create function pomar_private.media_reject_removed_id() returns trigger
language plpgsql set search_path='' as $$
begin
 if exists(select 1 from pomar_private.media_removals where id=new.id) then
  raise exception using errcode='P0001',message='POMAR_KEY_REUSED';
 end if;
 return new;
end $$;
revoke all on function pomar_private.media_reject_removed_id()
 from public,anon,authenticated,pomar_media_worker,pomar_billing_worker,pomar_notification_worker;
create trigger media_reject_removed_id before insert on pomar_private.media_uploads
 for each row execute function pomar_private.media_reject_removed_id();

create function pomar_private.media_begin_removal(p_project uuid,p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare completed timestamptz;
begin
 if not pomar_private.is_owner() then raise exception using errcode='42501',message='POMAR_ACCESS'; end if;
 insert into pomar_private.media_removals(id,link_id)
 select u.id,u.link_id from pomar_private.media_uploads u
 join pomar_private.media_links l on l.id=u.link_id
 where u.id=p_id and u.received_at is not null and l.project_id=p_project and l.owner_id=auth.uid()
 on conflict (id) do nothing;
 select r.removed_at into completed from pomar_private.media_removals r
 join pomar_private.media_links l on l.id=r.link_id
 where r.id=p_id and l.project_id=p_project and l.owner_id=auth.uid();
 if not found then raise exception using errcode='P0001',message='POMAR_NOT_FOUND'; end if;
 return completed is null;
end $$;

create function pomar_private.media_finish_removal(p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if session_user<>'pomar_media_worker' then raise exception using errcode='42501',message='POMAR_ACCESS'; end if;
 update pomar_private.media_removals set removed_at=now() where id=p_id and removed_at is null;
 if found then
  delete from pomar_private.media_uploads where id=p_id;
 end if;
 return exists(select 1 from pomar_private.media_removals where id=p_id and removed_at is not null);
end $$;

-- A resposta antiga permanece disponível para versões sem a ação de remoção.
create function pomar_private.media_project_with_removals(p_project uuid,p_change_link boolean,p_hash text) returns jsonb
language sql security definer set search_path='' as $$
 select (case when p_change_link then pomar_private.media_set_link(p_project,p_hash)
  else pomar_private.media_project(p_project) end) || jsonb_build_object('removing_ids',coalesce((
   select jsonb_agg(r.id) from pomar_private.media_removals r
   join pomar_private.media_links l on l.id=r.link_id
   where l.project_id=p_project and l.owner_id=auth.uid() and r.removed_at is null
  ),'[]'::jsonb));
$$;
create function public.pomar_media_project_with_removals(p_project uuid,p_change_link boolean,p_hash text) returns jsonb
language sql security invoker set search_path='' as $$
 select pomar_private.media_project_with_removals(p_project,p_change_link,p_hash);
$$;
create function public.pomar_media_begin_removal(p_project uuid,p_id uuid) returns boolean
language sql security invoker set search_path='' as $$
 select pomar_private.media_begin_removal(p_project,p_id);
$$;

revoke all on function pomar_private.media_project_with_removals(uuid,boolean,text),
 public.pomar_media_project_with_removals(uuid,boolean,text),
 pomar_private.media_begin_removal(uuid,uuid),public.pomar_media_begin_removal(uuid,uuid)
 from public,anon,pomar_media_worker,pomar_billing_worker,pomar_notification_worker;
grant execute on function pomar_private.media_project_with_removals(uuid,boolean,text),
 public.pomar_media_project_with_removals(uuid,boolean,text),
 pomar_private.media_begin_removal(uuid,uuid),public.pomar_media_begin_removal(uuid,uuid) to authenticated;
revoke all on function pomar_private.media_finish_removal(uuid)
 from public,anon,authenticated,pomar_billing_worker,pomar_notification_worker;
grant execute on function pomar_private.media_finish_removal(uuid) to pomar_media_worker;

notify pgrst,'reload schema';
commit;
