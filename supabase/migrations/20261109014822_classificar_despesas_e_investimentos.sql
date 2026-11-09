-- A classificação gerencial é opcional e preserva as categorias existentes.
begin;

create table public.pomar_expense_purposes (
 expense_id uuid primary key,
 owner_id uuid not null references auth.users(id),
 purpose text check (purpose in ('tools','paid_traffic','investment','personal')),
 foreign key(owner_id,expense_id) references public.pomar_expenses(owner_id,id)
);
alter table public.pomar_expense_purposes enable row level security;
alter table public.pomar_expense_purposes force row level security;
revoke all on public.pomar_expense_purposes from public,anon,authenticated,pomar_billing_worker,pomar_notification_worker;
grant select,insert,update on public.pomar_expense_purposes to authenticated;
create policy owner_access on public.pomar_expense_purposes to authenticated
 using(owner_id=(select auth.uid()) and (select pomar_private.is_owner()))
 with check(owner_id=(select auth.uid()) and (select pomar_private.is_owner()));

alter function public.pomar_command(uuid,jsonb) rename to pomar_command_before_expense_purposes;
alter function public.pomar_command_before_expense_purposes(uuid,jsonb) set schema pomar_private;

create function public.pomar_command(p_key uuid,p_command jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v jsonb:=p_command->'value'; uid uuid:=auth.uid(); n integer; saved jsonb;
begin
 if p_command->>'type' is distinct from 'saveExpense' or not coalesce(v ? 'purpose',false) then
  return pomar_private.pomar_command_before_expense_purposes(p_key,p_command);
 end if;
 if not pomar_private.is_owner() then raise exception using errcode='42501',message='POMAR_ACCESS'; end if;
 if p_key is null or jsonb_typeof(v) is distinct from 'object' or v->>'version' is null then
  raise exception using errcode='22023',message='POMAR_BAD_COMMAND';
 end if;
 insert into public.pomar_command_log(owner_id,command_id,payload) values(uid,p_key,p_command) on conflict do nothing;
 get diagnostics n=row_count;
 if n=0 then
  select payload into saved from public.pomar_command_log where owner_id=uid and command_id=p_key;
  if saved is distinct from p_command then raise exception using errcode='P0001',message='POMAR_KEY_REUSED'; end if;
  return jsonb_build_object('duplicate',true);
 end if;
 perform pomar_private.save_entity('expenses',v-array['purpose','version','created_at','updated_at'],(v->>'version')::integer);
 insert into public.pomar_expense_purposes(expense_id,owner_id,purpose) values((v->>'id')::uuid,uid,v->>'purpose')
 on conflict(expense_id) do update set purpose=excluded.purpose;
 return jsonb_build_object('duplicate',false);
end $$;

create function public.pomar_workspace_expense_purposes() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare snapshot jsonb; expenses jsonb;
begin
 if to_regprocedure('public.pomar_workspace_collection_queue()') is not null then
  snapshot:=public.pomar_workspace_collection_queue();
 elsif to_regprocedure('public.pomar_workspace_client_terms()') is not null then
  snapshot:=public.pomar_workspace_client_terms();
 elsif to_regprocedure('public.pomar_workspace_cards()') is not null then
  snapshot:=public.pomar_workspace_cards();
 else
  snapshot:=public.pomar_workspace_results();
 end if;
 select coalesce(jsonb_agg(j.value||jsonb_build_object('purpose',p.purpose) order by j.position),'[]'::jsonb)
  into expenses from jsonb_array_elements(snapshot->'expenses') with ordinality as j(value,position)
  left join public.pomar_expense_purposes p on p.expense_id=(j.value->>'id')::uuid and p.owner_id=auth.uid();
 return snapshot||jsonb_build_object('expense_purposes_ready',true,'expenses',expenses);
end $$;

revoke all on function public.pomar_command(uuid,jsonb),public.pomar_workspace_expense_purposes() from public,anon,pomar_billing_worker,pomar_notification_worker;
grant execute on function public.pomar_command(uuid,jsonb),public.pomar_workspace_expense_purposes() to authenticated;
notify pgrst,'reload schema';
commit;
