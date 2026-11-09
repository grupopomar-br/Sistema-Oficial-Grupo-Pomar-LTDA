-- Os objetos ficam no R2. O banco guarda convites, reservas e recibos de envio.
begin;

do $$ begin
 if not exists(select 1 from pg_roles where rolname='pomar_media_worker') then
  create role pomar_media_worker nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls noreplication;
 end if;
 if exists(
  select 1 from pg_roles where rolname='pomar_media_worker'
  and (rolsuper or rolcreatedb or rolcreaterole or rolbypassrls or rolinherit or rolreplication
   or exists(select 1 from pg_auth_members where member=pg_roles.oid))
 ) then raise exception 'Papel de mídias com privilégios incompatíveis.'; end if;
end $$;
grant usage on schema pomar_private to pomar_media_worker;

create table pomar_private.media_links (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id),
 project_id uuid not null,
 client_id uuid not null,
 token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
 expires_at timestamptz not null,
 revoked_at timestamptz,
 foreign key(owner_id,project_id) references public.pomar_projects(owner_id,id),
 foreign key(owner_id,client_id) references public.pomar_clients(owner_id,id)
);
create unique index media_one_link on pomar_private.media_links(project_id) where revoked_at is null;
create index media_links_project on pomar_private.media_links(project_id,client_id);

create table pomar_private.media_uploads (
 id uuid primary key,
 link_id uuid not null references pomar_private.media_links(id),
 file_name text not null check(char_length(btrim(file_name)) between 1 and 180),
 content_type text not null check(content_type in ('image/png','image/jpeg','image/heic','image/heif','image/webp','video/mp4','video/quicktime','video/webm')),
 size_bytes integer not null check(size_bytes between 12 and case when content_type like 'image/%' then 30000000 else 500000000 end),
 created_at timestamptz not null default now(),
 received_at timestamptz,
 next_check_at timestamptz,
 check_count integer not null default 0 check(check_count between 0 and 20)
);
create index media_uploads_link on pomar_private.media_uploads(link_id,received_at desc);

alter table pomar_private.media_links enable row level security;
alter table pomar_private.media_links force row level security;
alter table pomar_private.media_uploads enable row level security;
alter table pomar_private.media_uploads force row level security;
revoke all on pomar_private.media_links,pomar_private.media_uploads
 from public,anon,authenticated,pomar_media_worker,pomar_billing_worker,pomar_notification_worker;

create function pomar_private.media_revoke_on_project_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update pomar_private.media_links set revoked_at=now()
 where project_id=new.id and owner_id=new.owner_id and revoked_at is null;
 return new;
end $$;
revoke all on function pomar_private.media_revoke_on_project_change()
 from public,anon,authenticated,pomar_media_worker,pomar_billing_worker,pomar_notification_worker;
create trigger media_revoke_on_project_change
 after update of client_id,status on public.pomar_projects
 for each row when (
  old.client_id is distinct from new.client_id
  or (old.status<>'cancelled' and new.status='cancelled')
 ) execute function pomar_private.media_revoke_on_project_change();

create function pomar_private.media_project(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare client uuid; expires timestamptz; files jsonb; used bigint; pending bigint;
begin
 if not pomar_private.is_owner() then raise exception using errcode='42501',message='POMAR_ACCESS'; end if;
 select p.client_id into client from public.pomar_projects p where p.id=p_project and p.owner_id=auth.uid();
 if not found then raise exception using errcode='P0001',message='POMAR_NOT_FOUND'; end if;
 select l.expires_at into expires from pomar_private.media_links l
 where l.project_id=p_project and l.client_id=client and l.owner_id=auth.uid() and l.revoked_at is null and l.expires_at>now()
 and exists(select 1 from public.pomar_projects p where p.id=l.project_id and p.status<>'cancelled');
 select coalesce(sum(u.size_bytes),0),count(*) filter (where u.received_at is null) into used,pending
 from pomar_private.media_uploads u join pomar_private.media_links l on l.id=u.link_id
 where l.project_id=p_project and l.owner_id=auth.uid();
 select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'file_name',u.file_name,'content_type',u.content_type,
  'size_bytes',u.size_bytes,'received_at',u.received_at) order by u.received_at desc,u.id),'[]'::jsonb)
 into files from pomar_private.media_uploads u join pomar_private.media_links l on l.id=u.link_id
 where l.project_id=p_project and l.owner_id=auth.uid() and u.received_at is not null;
 return jsonb_build_object('expires_at',expires,'used_bytes',used,'pending_count',pending,'files',files);
end $$;

create function pomar_private.media_set_link(p_project uuid,p_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare project public.pomar_projects;
begin
 if not pomar_private.is_owner() then raise exception using errcode='42501',message='POMAR_ACCESS'; end if;
 select * into project from public.pomar_projects p where p.id=p_project and p.owner_id=auth.uid() for update;
 if project.id is null then raise exception using errcode='P0001',message='POMAR_NOT_FOUND'; end if;
 if p_hash is not null and (project.client_id is null or project.status='cancelled') then
  raise exception using errcode='P0001',message='POMAR_NOT_ACTIVE';
 end if;
 update pomar_private.media_links set revoked_at=now() where project_id=p_project and owner_id=auth.uid() and revoked_at is null;
 if p_hash is not null then
  insert into pomar_private.media_links(owner_id,project_id,client_id,token_hash,expires_at)
  values(auth.uid(),p_project,project.client_id,p_hash,now()+interval '7 days');
 end if;
 return pomar_private.media_project(p_project);
end $$;

create function public.pomar_media_project(p_project uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select pomar_private.media_project(p_project);
$$;
create function public.pomar_media_set_link(p_project uuid,p_hash text) returns jsonb
language sql security invoker set search_path='' as $$
 select pomar_private.media_set_link(p_project,p_hash);
$$;

create function pomar_private.media_active_link(p_hash text) returns uuid
language sql stable security invoker set search_path='' as $$
 select l.id from pomar_private.media_links l
 join public.pomar_projects p on p.id=l.project_id and p.owner_id=l.owner_id and p.client_id=l.client_id
 where l.token_hash=p_hash and l.revoked_at is null and l.expires_at>now() and p.status<>'cancelled';
$$;

create function pomar_private.media_link_status(p_hash text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare expires timestamptz;
begin
 if session_user<>'pomar_media_worker' then raise exception using errcode='42501',message='POMAR_ACCESS'; end if;
 select expires_at into expires from pomar_private.media_links where id=pomar_private.media_active_link(p_hash);
 if expires is null then return null; end if;
 return jsonb_build_object('expires_at',expires);
end $$;

create function pomar_private.media_reserve(p_hash text,p_id uuid,p_name text,p_type text,p_size integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare link pomar_private.media_links; upload pomar_private.media_uploads; bytes bigint; files bigint; valid_until timestamptz;
begin
 if session_user<>'pomar_media_worker' then raise exception using errcode='42501',message='POMAR_ACCESS'; end if;
 select * into link from pomar_private.media_links where id=pomar_private.media_active_link(p_hash) for update;
 if link.id is null or link.revoked_at is not null or link.expires_at<=now() then return null; end if;
 valid_until:=least(link.expires_at,now()+interval '10 minutes');
 -- As cotas consideram envios ainda não confirmados e são verificadas sob o mesmo lock.
 perform pg_advisory_xact_lock(82473691);
 select * into upload from pomar_private.media_uploads where id=p_id;
 if upload.id is not null then
  if (upload.link_id,upload.file_name,upload.content_type,upload.size_bytes) is distinct from (link.id,p_name,p_type,p_size) then
   raise exception using errcode='P0001',message='POMAR_KEY_REUSED';
  end if;
 else
  select coalesce(sum(size_bytes),0),count(*) into bytes,files from pomar_private.media_uploads;
  if bytes+p_size>8000000000 or files>=3000 then raise exception using errcode='P0001',message='POMAR_MEDIA_QUOTA'; end if;
  select coalesce(sum(u.size_bytes),0),count(*) into bytes,files
  from pomar_private.media_uploads u join pomar_private.media_links l on l.id=u.link_id where l.project_id=link.project_id;
  if bytes+p_size>2000000000 or files>=100 then raise exception using errcode='P0001',message='POMAR_MEDIA_QUOTA'; end if;
  insert into pomar_private.media_uploads(id,link_id,file_name,content_type,size_bytes)
  values(p_id,link.id,p_name,p_type,p_size) returning * into upload;
 end if;
 return jsonb_build_object('valid_until',valid_until,'received',upload.received_at is not null);
end $$;

create function pomar_private.media_check(p_hash text,p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare upload pomar_private.media_uploads;
begin
 if session_user<>'pomar_media_worker' then raise exception using errcode='42501',message='POMAR_ACCESS'; end if;
 select * into upload from pomar_private.media_uploads
 where id=p_id and link_id=pomar_private.media_active_link(p_hash) for update;
 if upload.id is null then return null; end if;
 if upload.received_at is null then
  if upload.check_count>=20 then
   raise exception using errcode='P0001',message='POMAR_MEDIA_CHECK_LIMIT';
  end if;
  if upload.next_check_at>now() then
   raise exception using errcode='P0001',message='POMAR_MEDIA_CHECK_WAIT';
  end if;
  update pomar_private.media_uploads set next_check_at=now()+interval '4 seconds',check_count=check_count+1 where id=p_id;
 end if;
 return jsonb_build_object('size_bytes',upload.size_bytes,'content_type',upload.content_type,'received',upload.received_at is not null);
end $$;

create function pomar_private.media_confirm(p_hash text,p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if session_user<>'pomar_media_worker' then raise exception using errcode='42501',message='POMAR_ACCESS'; end if;
 update pomar_private.media_uploads set received_at=coalesce(received_at,now())
 where id=p_id and link_id=pomar_private.media_active_link(p_hash) and check_count>0;
 return found;
end $$;

revoke all on function pomar_private.media_project(uuid),pomar_private.media_set_link(uuid,text),
 public.pomar_media_project(uuid),public.pomar_media_set_link(uuid,text)
 from public,anon,pomar_media_worker,pomar_billing_worker,pomar_notification_worker;
grant execute on function pomar_private.media_project(uuid),pomar_private.media_set_link(uuid,text),
 public.pomar_media_project(uuid),public.pomar_media_set_link(uuid,text) to authenticated;
revoke all on function pomar_private.media_active_link(text) from public,anon,authenticated,pomar_media_worker,pomar_billing_worker,pomar_notification_worker;
revoke all on function pomar_private.media_link_status(text),pomar_private.media_reserve(text,uuid,text,text,integer),
 pomar_private.media_check(text,uuid),pomar_private.media_confirm(text,uuid)
 from public,anon,authenticated,pomar_billing_worker,pomar_notification_worker;
grant execute on function pomar_private.media_link_status(text),pomar_private.media_reserve(text,uuid,text,text,integer),
 pomar_private.media_check(text,uuid),pomar_private.media_confirm(text,uuid) to pomar_media_worker;

notify pgrst,'reload schema';
commit;
