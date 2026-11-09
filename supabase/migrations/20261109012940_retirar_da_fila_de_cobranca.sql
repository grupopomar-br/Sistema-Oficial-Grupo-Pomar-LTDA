-- Retirada reversível da fila de trabalho. Cada decisão integra o histórico.
begin;

alter table public.pomar_collection_actions
 drop constraint pomar_collection_actions_kind_check,
 add constraint pomar_collection_actions_kind_check
 check (kind in ('contact','reminder','promise','dispute','withdraw','resume')),
 add constraint pomar_collection_queue_internal
 check (kind not in ('withdraw','resume') or (channel='manual' and promise_on is null));

-- Clientes de versões antigas continuam a receber os tipos que conhecem.
create or replace function pomar_private.pomar_workspace_v2() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; rows jsonb; t text; n bigint; condition text;
begin
 result:=pomar_private.pomar_workspace_v1();
 foreach t in array array['ideas','collection_agreements','collection_actions'] loop
  condition:=case when t='collection_actions' then ' and kind not in (''withdraw'',''resume'')' else '' end;
  execute format('select count(*) from public.pomar_%I where owner_id=$1%s',t,condition)
   into n using auth.uid();
  if n>(case when t='collection_actions' then 20000 else 10000 end) then
   raise exception using errcode='P0001',message='POMAR_SNAPSHOT_LIMIT';
  end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(r)-''owner_id'' order by created_at,id),''[]''::jsonb) from public.pomar_%I r where owner_id=$1%s',t,condition)
   into rows using auth.uid();
  result:=result||jsonb_build_object(t,rows);
 end loop;
 return result;
end $$;

create function public.pomar_workspace_collection_queue() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare snapshot jsonb; actions jsonb;
begin
 if to_regprocedure('public.pomar_workspace_client_terms()') is not null then
  snapshot:=public.pomar_workspace_client_terms();
 elsif to_regprocedure('public.pomar_workspace_cards()') is not null then
  snapshot:=public.pomar_workspace_cards();
 else
  snapshot:=public.pomar_workspace_results();
 end if;
 if (select count(*) from public.pomar_collection_actions where owner_id=auth.uid())>20000 then
  raise exception using errcode='P0001',message='POMAR_SNAPSHOT_LIMIT';
 end if;
 select coalesce(jsonb_agg(to_jsonb(a)-'owner_id' order by created_at,id),'[]'::jsonb)
  into actions from public.pomar_collection_actions a where owner_id=auth.uid();
 return snapshot||jsonb_build_object('collection_queue_ready',true,'collection_actions',actions);
end $$;

revoke all on function public.pomar_workspace_collection_queue() from public,anon,pomar_billing_worker,pomar_notification_worker;
grant execute on function public.pomar_workspace_collection_queue() to authenticated;
notify pgrst,'reload schema';
commit;
