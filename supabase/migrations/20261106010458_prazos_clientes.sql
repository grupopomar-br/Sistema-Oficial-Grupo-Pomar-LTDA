-- Datas informadas pelo proprietário. Cadastros existentes começam sem prazo.
-- Esta migração pode ser aplicada com ou sem a migração de cartão.
begin;

alter table public.pomar_clients
 add column closed_on date,
 add column ends_on date,
 add constraint pomar_client_term_dates check (
  (closed_on is null or closed_on between date '0001-01-01' and date '9999-12-31')
  and (ends_on is null or (closed_on is not null and ends_on between closed_on and date '9999-12-31'))
 );

-- A lista explícita mantém as validações e o versionamento dos comandos.
-- Omissão conserva uma data existente. Null explícito permite apagar a data.
create or replace function pomar_private.save_entity(p_entity text,p_value jsonb,p_version integer) returns void
language plpgsql security invoker set search_path='' as $$
declare cols text[]; col_list text; assignments text; table_name text; existing integer; changed integer;
begin
 cols:=case p_entity
 when 'clients' then array['name','kind','city','segment','contact_name','email','phone','website','notes','status']
 when 'areas' then array['name','color','archived']
 when 'projects' then array['name','client_id','contractor_id','area_id','status','priority','started_on','due_on','next_action','next_action_on','waiting_for','notes']
 when 'tasks' then array['title','project_id','priority','status','due_on','focus_on','description','completed_at']
 when 'expenses' then array['title','category','project_id','amount_cents','due_on','paid_on','status','notes']
 when 'opportunities' then array['title','client_id','stage','value_cents','next_action','next_contact_on','notes','lost_reason','project_id']
 else null end;
 if p_entity='clients' then
  cols:=cols||array(select c from unnest(array['closed_on','ends_on']) c where p_value ? c);
 end if;
 if cols is null or exists(select 1 from jsonb_object_keys(p_value) k where not (k=any(cols||array['id']))) then raise exception using errcode='22023',message='POMAR_BAD_COMMAND'; end if;
 table_name:='pomar_'||p_entity;
 select string_agg(format('%I',c),',') into col_list from unnest(cols) c;
 select string_agg(format('%I = r.%I',c,c),',') into assignments from unnest(cols) c;
 execute format('select version from public.%I where owner_id=$1 and id=$2',table_name) into existing using auth.uid(),(p_value->>'id')::uuid;
 if existing is null then
  if p_version<>1 then raise exception using errcode='P0001',message='POMAR_CONFLICT'; end if;
  execute format('insert into public.%I(id,owner_id,%s) select r.id,$1,%s from jsonb_populate_record(null::public.%I,$2) r',table_name,col_list,col_list,table_name) using auth.uid(),p_value;
 else
  execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I,$1) r where t.id=r.id and t.owner_id=$2 and t.version=$3',table_name,assignments,table_name) using p_value,auth.uid(),p_version;
  get diagnostics changed=row_count;
  if changed<>1 then raise exception using errcode='P0001',message='POMAR_CONFLICT'; end if;
 end if;
end $$;

-- O snapshot de base continua compatível com aplicações anteriores.
create or replace function pomar_private.pomar_workspace_v1() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; settings jsonb; t text; rows jsonb; max_rows integer; total bigint; hidden_columns text[];
begin
 if not pomar_private.is_owner() then raise exception using errcode='42501',message='POMAR_ACCESS'; end if;
 select to_jsonb(s)-array['id','owner_id','version','created_at','updated_at'] into settings from public.pomar_settings s where owner_id=auth.uid();
 if settings is null then raise exception using errcode='P0001',message='POMAR_NOT_INITIALIZED'; end if;
 result:=jsonb_build_object('schema_version',1,'revision',settings->'revision','settings',settings-'revision','processed_commands','[]'::jsonb);
 foreach t in array array['clients','areas','projects','tasks','contracts','installments','receipts','allocations','expenses','opportunities','updates'] loop
  max_rows:=case when t='areas' then 100 when t in('tasks','installments','receipts','allocations','updates') then 20000 else 10000 end;
  execute format('select count(*) from public.pomar_%I where owner_id=$1',t) into total using auth.uid();
  if total>max_rows then raise exception using errcode='P0001',message='POMAR_SNAPSHOT_LIMIT'; end if;
  hidden_columns:=case when t='clients' then array['owner_id','closed_on','ends_on'] else array['owner_id'] end;
  execute format('select coalesce(jsonb_agg(to_jsonb(r)-$2 order by r.created_at,r.id),''[]''::jsonb) from public.pomar_%I r where owner_id=$1',t)
   into rows using auth.uid(),hidden_columns;
  result:=result||jsonb_build_object(t,rows);
 end loop;
 select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc,a.id),'[]'::jsonb) into rows from
  (select id,entity_type,entity_id,action,summary,created_at from public.pomar_audit_events where owner_id=auth.uid() order by created_at desc,id limit 1000) a;
 return result||jsonb_build_object('history',rows);
end $$;

create function public.pomar_workspace_client_terms() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare snapshot jsonb; clients jsonb;
begin
 if to_regprocedure('public.pomar_workspace_cards()') is null then
  snapshot:=public.pomar_workspace_results();
 else
  snapshot:=public.pomar_workspace_cards();
 end if;
 select coalesce(jsonb_agg(j.value||jsonb_build_object('closed_on',c.closed_on,'ends_on',c.ends_on) order by j.position),'[]'::jsonb)
  into clients
  from jsonb_array_elements(snapshot->'clients') with ordinality as j(value,position)
  join public.pomar_clients c on c.id=(j.value->>'id')::uuid and c.owner_id=auth.uid();
 return snapshot||jsonb_build_object('client_terms_ready',true,'clients',clients);
end $$;
revoke all on function public.pomar_workspace_client_terms() from public,anon,pomar_billing_worker,pomar_notification_worker;
grant execute on function public.pomar_workspace_client_terms() to authenticated;
notify pgrst,'reload schema';

commit;
