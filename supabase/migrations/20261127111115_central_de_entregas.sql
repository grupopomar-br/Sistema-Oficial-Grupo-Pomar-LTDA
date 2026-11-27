-- Homologar primeiro em banco de teste. O módulo escreve somente em tarefas e dados operacionais.
begin;

create table pomar_private.service_playbooks (
 key text not null check(char_length(key) between 1 and 80),
 version integer not null check(version>0),
 definition jsonb not null check(jsonb_typeof(definition)='object'),
 primary key(key,version)
);
create table pomar_private.delivery_plans (
 id uuid primary key, owner_id uuid not null references auth.users(id),
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 project_id uuid not null, contract_id uuid not null, methodology_id uuid,
 playbook_key text not null, playbook_version integer not null,
 scope_reference text not null check(char_length(btrim(scope_reference)) between 5 and 3000),
 starts_on date not null, ends_on date not null, implementation_due_on date not null,
 status text not null default 'active' check(status in('active','paused','archived')),
 recurrence_rules jsonb not null default '[]'::jsonb check(jsonb_typeof(recurrence_rules)='array' and jsonb_array_length(recurrence_rules)<=20),
 check(ends_on>=starts_on and ends_on-starts_on<=3660),
 check(implementation_due_on between starts_on and ends_on),
 unique(owner_id,id),
 foreign key(owner_id,project_id) references public.pomar_projects(owner_id,id),
 foreign key(owner_id,contract_id) references public.pomar_contracts(owner_id,id),
 foreign key(owner_id,methodology_id) references public.pomar_methodologies(owner_id,id),
 foreign key(playbook_key,playbook_version) references pomar_private.service_playbooks(key,version)
);
create unique index delivery_plan_active_service on pomar_private.delivery_plans(owner_id,project_id,playbook_key) where status<>'archived';
create index delivery_plan_contract on pomar_private.delivery_plans(owner_id,contract_id);
create index delivery_plan_methodology on pomar_private.delivery_plans(owner_id,methodology_id) where methodology_id is not null;
create index delivery_plan_playbook on pomar_private.delivery_plans(playbook_key,playbook_version);
create table pomar_private.delivery_items (
 id uuid primary key, owner_id uuid not null references auth.users(id), plan_id uuid not null,
 phase text not null check(phase in('implementation','recurring')),
 step_key text not null check(char_length(step_key) between 1 and 80),
 group_key text not null check(char_length(group_key) between 1 and 80),
 group_title text not null check(char_length(group_title) between 3 and 120),
 criteria jsonb not null check(jsonb_typeof(criteria)='array' and jsonb_array_length(criteria) between 1 and 10),
 required boolean not null, critical boolean not null,
 weight integer not null check(weight between 1 and 10), depends_on jsonb not null default '[]', final_review boolean not null default false,
 period_start date, period_end date,
 target_quantity integer not null check(target_quantity between 1 and 1000),
 completed_quantity integer not null default 0 check(completed_quantity>=0 and completed_quantity<=target_quantity),
 accepted_criteria jsonb not null default '[]' check(jsonb_typeof(accepted_criteria)='array' and jsonb_array_length(accepted_criteria)<=10),
 next_action text not null default '' check(char_length(next_action)<=1000),
 dependency text not null default '' check(char_length(dependency)<=1000),
 reason text not null default '' check(char_length(reason)<=2000),
 original_due_on date not null, validated_at timestamptz,
 check((phase='implementation' and period_start is null and period_end is null) or
       (phase='recurring' and period_start is not null and period_end>=period_start)),
 unique(owner_id,id),
 foreign key(owner_id,id) references public.pomar_tasks(owner_id,id),
 foreign key(owner_id,plan_id) references pomar_private.delivery_plans(owner_id,id)
);
create unique index delivery_item_once on pomar_private.delivery_items(owner_id,plan_id,step_key,coalesce(period_start,'0001-01-01'::date));
create index delivery_item_due on pomar_private.delivery_items(owner_id,original_due_on);
create table pomar_private.delivery_evidence (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), item_id uuid not null,
 reference text not null check(char_length(btrim(reference)) between 5 and 2000),
 performed_on date not null, quantity integer not null check(quantity between 0 and 1000),
 created_at timestamptz not null default now(),
 foreign key(owner_id,item_id) references pomar_private.delivery_items(owner_id,id)
);
create index delivery_evidence_item on pomar_private.delivery_evidence(owner_id,item_id,created_at,id);
create table pomar_private.delivery_events (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 plan_id uuid not null, item_id uuid,
 operation text not null check(operation in('create','schedule','update','validate','reopen','exclude','status')),
 summary text not null check(char_length(summary)<=500), reason text not null check(char_length(reason)<=2000),
 before_state jsonb, after_state jsonb, created_at timestamptz not null default now(),
 foreign key(owner_id,plan_id) references pomar_private.delivery_plans(owner_id,id),
 foreign key(owner_id,item_id) references pomar_private.delivery_items(owner_id,id)
);
create index delivery_events_plan on pomar_private.delivery_events(owner_id,plan_id,created_at,id);
create index delivery_events_item on pomar_private.delivery_events(owner_id,item_id) where item_id is not null;

do $$ declare name text; begin
 foreach name in array array['service_playbooks','delivery_plans','delivery_items','delivery_evidence','delivery_events'] loop
  execute format('alter table pomar_private.%I enable row level security',name);
  execute format('alter table pomar_private.%I force row level security',name);
  execute format('revoke all on pomar_private.%I from public,anon,authenticated',name);
  execute format('grant select on pomar_private.%I to authenticated',name);
  if name='service_playbooks' then
   execute format('create policy delivery_owner on pomar_private.%I for select to authenticated using ((select pomar_private.is_owner()))',name);
  else
   execute format('create policy delivery_owner on pomar_private.%I for select to authenticated using (owner_id=(select auth.uid()) and (select pomar_private.is_owner()))',name);
  end if;
 end loop;
end $$;
create trigger touch_record before insert or update on pomar_private.delivery_plans for each row execute function pomar_private.touch_record();

create function pomar_private.delivery_immutable() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception using errcode='P0001',message='POMAR_IMMUTABLE'; end $$;
create trigger immutable_playbook before update or delete on pomar_private.service_playbooks for each row execute function pomar_private.delivery_immutable();
create trigger immutable_evidence before update or delete on pomar_private.delivery_evidence for each row execute function pomar_private.delivery_immutable();
create trigger immutable_delivery_event before update or delete on pomar_private.delivery_events for each row execute function pomar_private.delivery_immutable();

alter table public.pomar_tasks drop constraint pomar_tasks_status_check, drop constraint pomar_tasks_check;
alter table public.pomar_tasks add constraint pomar_tasks_status_check check(status in('pending','doing','waiting_client','blocked','review','done','not_applicable')),
 add constraint pomar_tasks_completion_check check((status in('done','not_applicable'))=(completed_at is not null));

-- Apenas o comando privado autorizado pode alterar a execução de uma tarefa de entrega.
-- O planejamento de foco continua usando o comando comum do sistema.
create function pomar_private.delivery_task_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare managed boolean; trusted boolean;
begin
 trusted:=current_user=pg_catalog.pg_get_userbyid((select relowner from pg_catalog.pg_class where oid='pomar_private.delivery_items'::regclass));
 if trusted then return new; end if;
 select exists(select 1 from pomar_private.delivery_items where id=new.id and owner_id=new.owner_id) into managed;
 if managed and tg_op='UPDATE' then
  if (to_jsonb(new)-array['focus_on','version','updated_at']) is distinct from (to_jsonb(old)-array['focus_on','version','updated_at']) then
   raise exception using errcode='P0001',message='POMAR_DELIVERY_TASK';
  end if;
 elsif new.status not in('pending','doing','blocked','done') then
  raise exception using errcode='P0001',message='POMAR_DELIVERY_TASK';
 end if;
 return new;
end $$;
create trigger delivery_task_guard before insert or update on public.pomar_tasks for each row execute function pomar_private.delivery_task_guard();

create function pomar_private.delivery_event(
 p_plan uuid,p_item uuid,p_operation text,p_summary text,p_reason text,p_before jsonb,p_after jsonb
) returns void language plpgsql security invoker set search_path='' as $$
begin
 if (select count(*) from pomar_private.delivery_events where owner_id=auth.uid())>=40000 then
  raise exception using errcode='P0001',message='POMAR_SNAPSHOT_LIMIT';
 end if;
 insert into pomar_private.delivery_events(owner_id,plan_id,item_id,operation,summary,reason,before_state,after_state)
 values(auth.uid(),p_plan,p_item,p_operation,left(p_summary,500),p_reason,p_before,p_after);
 insert into public.pomar_audit_events(owner_id,entity_type,entity_id,action,summary)
 select auth.uid(),'project',project_id,'delivery_'||p_operation,left(p_summary,500)
 from pomar_private.delivery_plans where id=p_plan and owner_id=auth.uid();
 update public.pomar_settings set revision=revision+1 where owner_id=auth.uid();
end $$;
create function pomar_private.delivery_state(p_task public.pomar_tasks,p_item pomar_private.delivery_items)
 returns jsonb language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('status',p_task.status,'due_on',p_task.due_on,
  'completed_quantity',p_item.completed_quantity,'accepted_criteria',p_item.accepted_criteria,
  'next_action',p_item.next_action,'dependency',p_item.dependency);
$$;

create function pomar_private.delivery_command(p_key uuid,p_command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare
 uid uuid:=auth.uid(); kind text:=p_command->>'type'; saved jsonb;
 project public.pomar_projects; contract public.pomar_contracts;
 plan pomar_private.delivery_plans; item pomar_private.delivery_items; task public.pomar_tasks;
 dependent pomar_private.delivery_items; dependent_task public.pomar_tasks;
 definition jsonb; step jsonb; rule jsonb; rules jsonb;
 starts date; ends date; implementation_due date; period_start date; period_end date; due date; performed date;
 month integer; created integer:=0; task_capacity integer; iid uuid; quantity integer; criteria jsonb; before_state jsonb;
 target_status text; next_action text; dependency text; reason text; evidence text;
 was_closed boolean; reopened text[]; changed boolean;
begin
 if pomar_private.is_owner() is distinct from true then raise exception using errcode='42501',message='POMAR_ACCESS'; end if;
 if p_key is null or jsonb_typeof(p_command) is distinct from 'object' or kind is null or kind not in
  ('createDeliveryPlan','recordDeliveryTask','scheduleDeliveryRecurrence','setDeliveryPlanStatus') then
  raise exception using errcode='22023',message='POMAR_BAD_COMMAND';
 end if;
 insert into public.pomar_command_log(owner_id,command_id,payload) values(uid,p_key,p_command) on conflict do nothing;
 if not found then
  select payload into saved from public.pomar_command_log where owner_id=uid and command_id=p_key;
  if saved is distinct from p_command then raise exception using errcode='P0001',message='POMAR_KEY_REUSED'; end if;
  return jsonb_build_object('duplicate',true);
 end if;

 if kind='createDeliveryPlan' then
  select * into project from public.pomar_projects where owner_id=uid and id=(p_command->>'project_id')::uuid for update;
  if not found or project.status in('completed','cancelled') or exists(select 1 from pomar_private.project_removals where owner_id=uid and project_id=project.id) then
   raise exception using errcode='P0001',message='POMAR_DELIVERY_PROJECT';
  end if;
  select * into contract from public.pomar_contracts where owner_id=uid and id=(p_command->>'contract_id')::uuid for share;
  if not found or contract.status<>'active' or contract.project_id is distinct from project.id or (contract.client_id is distinct from project.client_id and contract.client_id is distinct from project.contractor_id) then
   raise exception using errcode='P0001',message='POMAR_DELIVERY_CONTRACT';
  end if;
  if project.version is distinct from (p_command->>'expected_project_version')::integer or contract.version is distinct from (p_command->>'expected_contract_version')::integer then
   raise exception using errcode='P0001',message='POMAR_CONFLICT';
  end if;
  if (p_command->>'methodology_id') is not null and not exists(select 1 from public.pomar_methodologies where owner_id=uid and id=(p_command->>'methodology_id')::uuid and not archived) then
   raise exception using errcode='P0001',message='POMAR_NOT_FOUND';
  end if;
  select p.definition into definition from pomar_private.service_playbooks p where p.key=p_command->>'playbook_key' and p.version=(p_command->>'playbook_version')::integer;
  if not found then raise exception using errcode='P0001',message='POMAR_NOT_FOUND'; end if;
  starts:=(p_command->>'starts_on')::date;ends:=(p_command->>'ends_on')::date;implementation_due:=(p_command->>'implementation_due_on')::date;
  if starts is null or ends is null or ends<starts or ends-starts>3660 or (starts+interval '120 months')::date<=ends
   or implementation_due is null or implementation_due not between starts and ends
   or char_length(btrim(coalesce(p_command->>'scope_reference',''))) not between 5 and 3000 then
   raise exception using errcode='22023',message='POMAR_BAD_COMMAND';
  end if;
  if (select count(*) from public.pomar_tasks where owner_id=uid)+jsonb_array_length(definition->'steps')>20000
    or (select count(*) from pomar_private.delivery_plans where owner_id=uid)>=1000 then
   raise exception using errcode='P0001',message='POMAR_SNAPSHOT_LIMIT';
  end if;
  insert into pomar_private.delivery_plans(id,owner_id,project_id,contract_id,methodology_id,playbook_key,playbook_version,scope_reference,starts_on,ends_on,implementation_due_on)
  values((p_command->>'id')::uuid,uid,project.id,contract.id,(p_command->>'methodology_id')::uuid,p_command->>'playbook_key',(p_command->>'playbook_version')::integer,btrim(p_command->>'scope_reference'),starts,ends,implementation_due) returning * into plan;
  for step in select value from jsonb_array_elements(definition->'steps') loop
   iid:=gen_random_uuid();
   insert into public.pomar_tasks(id,owner_id,title,project_id,priority,status,due_on,description)
   values(iid,uid,step->>'title',project.id,project.priority,'pending',implementation_due,(select string_agg(value,E'\n') from jsonb_array_elements_text(step->'criteria')));
   insert into pomar_private.delivery_items(id,owner_id,plan_id,phase,step_key,group_key,group_title,criteria,required,critical,weight,depends_on,final_review,target_quantity,next_action,original_due_on)
   values(iid,uid,plan.id,'implementation',step->>'key',step->>'group_key',step->>'group_title',step->'criteria',(step->>'required')::boolean,(step->>'critical')::boolean,(step->>'weight')::integer,step->'depends_on',(step->>'final_review')::boolean,1,step->>'title',implementation_due);
  end loop;
  perform pomar_private.delivery_event(plan.id,null,'create','Plano de implantação criado a partir do escopo confirmado.',plan.scope_reference,null,null);
  return jsonb_build_object('duplicate',false);
 end if;

 if kind='recordDeliveryTask' then
  select plan_id into iid from pomar_private.delivery_items where owner_id=uid and id=(p_command->>'id')::uuid;
 else iid:=coalesce((p_command->>'plan_id')::uuid,(p_command->>'id')::uuid); end if;
 select * into plan from pomar_private.delivery_plans where owner_id=uid and id=iid for update;
 if not found then raise exception using errcode='P0001',message='POMAR_NOT_FOUND'; end if;
 if kind='setDeliveryPlanStatus' then
  if plan.version is distinct from (p_command->>'expected_version')::integer then raise exception using errcode='P0001',message='POMAR_CONFLICT'; end if;
  if p_command->>'status' is null or p_command->>'status' not in('active','paused','archived') or char_length(btrim(coalesce(p_command->>'reason',''))) not between 5 and 2000 then raise exception using errcode='22023',message='POMAR_BAD_COMMAND'; end if;
  update pomar_private.delivery_plans set status=p_command->>'status' where id=plan.id and owner_id=uid;
  perform pomar_private.delivery_event(plan.id,null,'status',case p_command->>'status' when 'active' then 'Plano retomado.' when 'paused' then 'Plano pausado.' else 'Plano arquivado.' end,btrim(p_command->>'reason'),null,null);
  return jsonb_build_object('duplicate',false);
 end if;
 select * into project from public.pomar_projects where owner_id=uid and id=plan.project_id for share;
 if plan.status<>'active' or project.status='cancelled' or exists(select 1 from pomar_private.project_removals where owner_id=uid and project_id=project.id) then
  raise exception using errcode='P0001',message='POMAR_DELIVERY_PROJECT';
 end if;

 if kind='scheduleDeliveryRecurrence' then
  if plan.version is distinct from (p_command->>'expected_version')::integer then raise exception using errcode='P0001',message='POMAR_CONFLICT'; end if;
  select * into contract from public.pomar_contracts where id=plan.contract_id and owner_id=uid for share;
  if not found or contract.status<>'active' then raise exception using errcode='P0001',message='POMAR_DELIVERY_CONTRACT'; end if;
  rules:=p_command->'rules';
  if jsonb_typeof(rules) is distinct from 'array' or jsonb_array_length(rules) not between 1 and 20 then raise exception using errcode='22023',message='POMAR_BAD_COMMAND'; end if;
  if plan.recurrence_rules<>'[]'::jsonb and plan.recurrence_rules is distinct from rules then raise exception using errcode='P0001',message='POMAR_DELIVERY_SCHEDULE'; end if;
  if (select count(distinct value->>'key') from jsonb_array_elements(rules))<>jsonb_array_length(rules) then raise exception using errcode='22023',message='POMAR_BAD_COMMAND'; end if;
  for rule in select value from jsonb_array_elements(rules) loop
   if (rule->>'key') is null or char_length(btrim(coalesce(rule->>'title',''))) not between 3 and 160 or (rule->>'target_quantity') is null or (rule->>'target_quantity')::integer not between 1 and 1000
    or jsonb_typeof(rule->'criteria') is distinct from 'array' or jsonb_array_length(rule->'criteria') not between 1 and 10
    or (rule->>'due_offset')::integer not between 0 and 30
    or exists(select 1 from jsonb_array_elements_text(rule->'criteria') c where char_length(btrim(c)) not between 3 and 500)
    or (select count(distinct value) from jsonb_array_elements_text(rule->'criteria'))<>jsonb_array_length(rule->'criteria') then
    raise exception using errcode='22023',message='POMAR_BAD_COMMAND';
   end if;
   perform (rule->>'key')::uuid;
  end loop;
  task_capacity:=20000-(select count(*) from public.pomar_tasks where owner_id=uid);
  for month in 0..119 loop
   period_start:=(plan.starts_on+make_interval(months=>month))::date;
   exit when period_start>plan.ends_on;
   period_end:=least((plan.starts_on+make_interval(months=>month+1))::date-1,plan.ends_on);
   for rule in select value from jsonb_array_elements(rules) loop
    if exists(select 1 from pomar_private.delivery_items where owner_id=uid and plan_id=plan.id and step_key=rule->>'key' and delivery_items.period_start=period_start) then continue; end if;
    if created>=task_capacity then raise exception using errcode='P0001',message='POMAR_SNAPSHOT_LIMIT'; end if;
    due:=case when rule->>'due_offset' is null then period_end else least(period_start+(rule->>'due_offset')::integer,period_end) end;
    iid:=gen_random_uuid();
    insert into public.pomar_tasks(id,owner_id,title,project_id,priority,status,due_on,description)
    values(iid,uid,btrim(rule->>'title'),plan.project_id,project.priority,'pending',due,(select string_agg(value,E'\n') from jsonb_array_elements_text(rule->'criteria')));
    insert into pomar_private.delivery_items(id,owner_id,plan_id,phase,step_key,group_key,group_title,criteria,required,critical,weight,period_start,period_end,target_quantity,next_action,original_due_on)
    values(iid,uid,plan.id,'recurring',rule->>'key','recurring','Operação recorrente',rule->'criteria',true,true,1,period_start,period_end,(rule->>'target_quantity')::integer,btrim(rule->>'title'),due);
    created:=created+1;
   end loop;
  end loop;
  if created>0 then
   update pomar_private.delivery_plans set recurrence_rules=rules where id=plan.id and owner_id=uid;
   perform pomar_private.delivery_event(plan.id,null,'schedule',created||' obrigações contratuais programadas.',plan.scope_reference,null,null);
  end if;
  return jsonb_build_object('duplicate',false,'created',created);
 end if;
 select * into item from pomar_private.delivery_items where owner_id=uid and id=(p_command->>'id')::uuid and plan_id=plan.id for update;
 if not found then raise exception using errcode='P0001',message='POMAR_NOT_FOUND'; end if;
 select * into task from public.pomar_tasks where owner_id=uid and id=item.id for update;
 if task.version is distinct from (p_command->>'expected_version')::integer then raise exception using errcode='P0001',message='POMAR_CONFLICT'; end if;
 target_status:=p_command->>'status';quantity:=(p_command->>'completed_quantity')::integer;
 criteria:=p_command->'accepted_criteria';due:=(p_command->>'due_on')::date;
 next_action:=btrim(p_command->>'next_action');dependency:=btrim(p_command->>'dependency');reason:=btrim(p_command->>'reason');
 evidence:=btrim(p_command->>'evidence_reference');performed:=(p_command->>'performed_on')::date;
 if target_status is null or target_status not in('pending','doing','waiting_client','blocked','review','done','not_applicable')
  or quantity is null or quantity not between 0 and item.target_quantity or due is null
  or jsonb_typeof(criteria) is distinct from 'array' or jsonb_array_length(criteria)>10
  or next_action is null or char_length(next_action)>1000 or dependency is null or char_length(dependency)>1000
  or reason is null or char_length(reason)>2000 or evidence is null or char_length(evidence)>2000
  or exists(select 1 from jsonb_array_elements(criteria) c where not (item.criteria @> jsonb_build_array(c)))
  or (select count(distinct value) from jsonb_array_elements(criteria))<>jsonb_array_length(criteria) then
  raise exception using errcode='22023',message='POMAR_BAD_COMMAND';
 end if;
 was_closed:=task.status in('done','not_applicable');
 if was_closed and (target_status in('done','not_applicable') or char_length(reason)<5) then
  raise exception using errcode='P0001',message='POMAR_DELIVERY_REOPEN';
 end if;
 if target_status='not_applicable' and (item.required or char_length(reason)<5 or quantity<>0) then
  raise exception using errcode='P0001',message='POMAR_DELIVERY_EXCLUDE';
 end if;
 if target_status in('blocked','waiting_client') and (char_length(dependency)<5 or char_length(next_action)<3) then
  raise exception using errcode='P0001',message='POMAR_DELIVERY_DEPENDENCY';
 end if;
 if (task.due_on is distinct from due or quantity<item.completed_quantity) and char_length(reason)<5 then
  raise exception using errcode='P0001',message='POMAR_DELIVERY_REASON';
 end if;
 if evidence<>'' and (char_length(evidence)<5 or performed is null or performed>(now() at time zone 'America/Fortaleza')::date
   or (evidence~*'^https?:' and evidence!~*'^https://[^[:space:]@/]+([/?#]|$)')) then
  raise exception using errcode='P0001',message='POMAR_DELIVERY_EVIDENCE';
 end if;
 if quantity>item.completed_quantity and evidence='' then raise exception using errcode='P0001',message='POMAR_DELIVERY_EVIDENCE'; end if;
 if target_status='done' then
  if task.status<>'review' or quantity<>item.target_quantity or jsonb_array_length(criteria)<>jsonb_array_length(item.criteria) then
   raise exception using errcode='P0001',message='POMAR_DELIVERY_ACCEPTANCE';
  end if;
  if evidence='' and not exists(select 1 from pomar_private.delivery_evidence where owner_id=uid and item_id=item.id) then
   raise exception using errcode='P0001',message='POMAR_DELIVERY_EVIDENCE';
  end if;
  if exists(select 1 from pomar_private.delivery_items d join public.pomar_tasks t on t.id=d.id and t.owner_id=d.owner_id
    where d.owner_id=uid and d.plan_id=plan.id and d.id<>item.id and d.phase='implementation'
      and (item.final_review or item.depends_on ? d.step_key) and t.status not in('done','not_applicable')) then
   raise exception using errcode='P0001',message='POMAR_DELIVERY_DEPENDENCY';
  end if;
 end if;
 before_state:=pomar_private.delivery_state(task,item);
 if evidence<>'' then
  if (select count(*) from pomar_private.delivery_evidence where owner_id=uid)>=40000 then raise exception using errcode='P0001',message='POMAR_SNAPSHOT_LIMIT'; end if;
  insert into pomar_private.delivery_evidence(owner_id,item_id,reference,performed_on,quantity)
  values(uid,item.id,evidence,performed,greatest(0,quantity-item.completed_quantity));
 end if;
 update pomar_private.delivery_items set completed_quantity=quantity,accepted_criteria=criteria,
  next_action=next_action,dependency=dependency,reason=reason,validated_at=case when target_status='done' then now() else null end
 where owner_id=uid and id=item.id returning * into item;
 update public.pomar_tasks set status=target_status,due_on=due,
  completed_at=case when target_status in('done','not_applicable') then now() else null end
 where owner_id=uid and id=item.id returning * into task;
 perform pomar_private.delivery_event(plan.id,item.id,
  case when was_closed then 'reopen' when target_status='done' then 'validate' when target_status='not_applicable' then 'exclude' else 'update' end,
  task.title||case when target_status='done' then ' · entrega validada' when target_status='not_applicable' then ' · dispensa justificada' else ' · acompanhamento atualizado' end,
  reason,before_state,pomar_private.delivery_state(task,item));
 if was_closed and item.phase='implementation' then
  reopened:=array[item.step_key];changed:=true;
  while changed loop
   changed:=false;
   for dependent in select d.* from pomar_private.delivery_items d join public.pomar_tasks t on t.id=d.id and t.owner_id=d.owner_id
    where d.owner_id=uid and d.plan_id=plan.id and d.phase='implementation' and t.status='done'
     and (d.final_review or d.depends_on ?| reopened) order by d.id loop
    select * into dependent_task from public.pomar_tasks where id=dependent.id and owner_id=uid for update;
    before_state:=pomar_private.delivery_state(dependent_task,dependent);
    update pomar_private.delivery_items set validated_at=null where id=dependent.id and owner_id=uid returning * into dependent;
    update public.pomar_tasks set status='review',completed_at=null where id=dependent.id and owner_id=uid returning * into dependent_task;
    perform pomar_private.delivery_event(plan.id,dependent.id,'reopen','Revalidar '||dependent_task.title,'Uma entrega necessária foi reaberta.',before_state,pomar_private.delivery_state(dependent_task,dependent));
    reopened:=array_append(reopened,dependent.step_key);changed:=true;
   end loop;
  end loop;
 end if;
 return jsonb_build_object('duplicate',false);
end $$;

create function public.pomar_delivery_command(p_key uuid,p_command jsonb) returns jsonb
language sql security invoker set search_path='' as $$
 select pomar_private.delivery_command(p_key,p_command);
$$;

-- A versão anterior recebe os estados que seu domínio reconhece.
alter function public.pomar_workspace_project_updates() rename to pomar_workspace_pre_deliveries;
create function public.pomar_workspace_project_updates() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare snapshot jsonb; tasks jsonb;
begin
 snapshot:=public.pomar_workspace_pre_deliveries();
 select coalesce(jsonb_agg(
  case t.value->>'status'
   when 'waiting_client' then t.value||jsonb_build_object('status','blocked')
   when 'review' then t.value||jsonb_build_object('status','doing')
   when 'not_applicable' then t.value||jsonb_build_object('status','done')
   else t.value end order by t.position),'[]'::jsonb)
 into tasks from jsonb_array_elements(snapshot->'tasks') with ordinality t(value,position);
 return snapshot||jsonb_build_object('tasks',tasks);
end $$;
revoke all on function public.pomar_workspace_project_updates() from public,anon;
grant execute on function public.pomar_workspace_project_updates() to authenticated;

-- Snapshot anterior continua disponível para retorno de versão da aplicação.
create function public.pomar_workspace_deliveries() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; rows jsonb; name text; total integer; limit_rows integer;
begin
 if pomar_private.is_owner() is distinct from true then raise exception using errcode='42501',message='POMAR_ACCESS'; end if;
 result:=public.pomar_workspace_pre_deliveries();
 select coalesce(jsonb_agg(definition order by key,version),'[]') into rows from pomar_private.service_playbooks;
 result:=result||jsonb_build_object('service_playbooks',rows,'delivery_ready',true);
 foreach name in array array['delivery_plans','delivery_items','delivery_evidence','delivery_events'] loop
  limit_rows:=case name when 'delivery_plans' then 1000 when 'delivery_items' then 20000 else 40000 end;
  execute format('select count(*) from pomar_private.%I where owner_id=$1',name) into total using auth.uid();
  if total>limit_rows then raise exception using errcode='P0001',message='POMAR_SNAPSHOT_LIMIT'; end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(r)-''owner_id'' order by r.id),''[]''::jsonb) from pomar_private.%I r where owner_id=$1',name) into rows using auth.uid();
  result:=result||jsonb_build_object(name,rows);
 end loop;
 return result;
end $$;

revoke all on function pomar_private.delivery_immutable(),pomar_private.delivery_task_guard(),
 pomar_private.delivery_event(uuid,uuid,text,text,text,jsonb,jsonb),
 pomar_private.delivery_state(public.pomar_tasks,pomar_private.delivery_items),
 pomar_private.delivery_command(uuid,jsonb),public.pomar_delivery_command(uuid,jsonb),public.pomar_workspace_deliveries()
 from public,anon,authenticated;
grant execute on function pomar_private.delivery_command(uuid,jsonb),public.pomar_delivery_command(uuid,jsonb),public.pomar_workspace_deliveries() to authenticated;

-- Versão publicada do modelo. Novas revisões usam outra versão e preservam planos existentes.
insert into pomar_private.service_playbooks(key,version,definition) values
 ('google-business-profile',1,$playbook$
{
  "key": "google-business-profile",
  "version": 1,
  "title": "Perfil da Empresa no Google",
  "family": "google",
  "reviewed_on": "2026-11-27",
  "sources": [
    "https://support.google.com/business/answer/3038177?hl=pt-BR",
    "https://support.google.com/business/answer/7091?hl=pt-BR",
    "https://support.google.com/business/answer/9455399?hl=pt-BR",
    "https://support.google.com/business/answer/6103862?hl=pt-BR",
    "https://support.google.com/contributionpolicy/answer/7400114?hl=pt-BR",
    "https://support.google.com/business/answer/7342169?hl=pt-BR"
  ],
  "steps": [
    {
      "key": "scope",
      "group_key": "onboarding",
      "group_title": "Onboarding",
      "title": "Confirmar contrato, escopo e exclusões",
      "criteria": [
        "Referência do contrato e entregas prometidas conferidas com o cliente.",
        "Limites da implantação, recorrência e responsabilidades registrados."
      ],
      "required": true,
      "critical": true,
      "weight": 4,
      "depends_on": [],
      "final_review": false
    },
    {
      "key": "authorization",
      "group_key": "onboarding",
      "group_title": "Onboarding",
      "title": "Conferir autorização e acesso ao perfil",
      "criteria": [
        "Responsável autorizou a gestão e mantém a titularidade do perfil.",
        "Acesso por usuário autorizado testado e situação de verificação registrada."
      ],
      "required": true,
      "critical": true,
      "weight": 4,
      "depends_on": [
        "scope"
      ],
      "final_review": false
    },
    {
      "key": "briefing",
      "group_key": "onboarding",
      "group_title": "Onboarding",
      "title": "Validar informações e pendências do cliente",
      "criteria": [
        "Dados recebidos foram conferidos com uma fonte do negócio.",
        "Materiais e informações pendentes possuem responsável e próxima ação."
      ],
      "required": true,
      "critical": false,
      "weight": 2,
      "depends_on": [
        "scope",
        "authorization"
      ],
      "final_review": false
    },
    {
      "key": "audit",
      "group_key": "diagnosis",
      "group_title": "Diagnóstico",
      "title": "Auditar elegibilidade e informações do perfil",
      "criteria": [
        "Duplicidade, elegibilidade, sugestões de edição e riscos avaliados.",
        "Problemas encontrados e correções propostas documentados."
      ],
      "required": true,
      "critical": true,
      "weight": 4,
      "depends_on": [
        "scope",
        "authorization"
      ],
      "final_review": false
    },
    {
      "key": "market",
      "group_key": "diagnosis",
      "group_title": "Diagnóstico",
      "title": "Mapear demanda e concorrência local",
      "criteria": [
        "Serviços reais, área atendida e pesquisas relevantes registrados.",
        "Concorrentes locais observados com data e contexto da busca."
      ],
      "required": true,
      "critical": false,
      "weight": 3,
      "depends_on": [
        "scope",
        "authorization"
      ],
      "final_review": false
    },
    {
      "key": "baseline",
      "group_key": "diagnosis",
      "group_title": "Diagnóstico",
      "title": "Registrar o marco zero",
      "criteria": [
        "Situação inicial e métricas disponíveis registradas com período e fonte.",
        "Ausências de dados foram identificadas para comparação futura."
      ],
      "required": true,
      "critical": false,
      "weight": 3,
      "depends_on": [
        "scope",
        "authorization"
      ],
      "final_review": false
    },
    {
      "key": "identity",
      "group_key": "information",
      "group_title": "Informações empresariais",
      "title": "Validar o nome real da empresa",
      "criteria": [
        "Nome corresponde à identidade usada pelo negócio no mundo real.",
        "Qualquer mudança foi autorizada e conferida após o processamento."
      ],
      "required": true,
      "critical": true,
      "weight": 4,
      "depends_on": [
        "scope",
        "authorization",
        "briefing",
        "audit"
      ],
      "final_review": false
    },
    {
      "key": "categories",
      "group_key": "information",
      "group_title": "Informações empresariais",
      "title": "Conferir categorias principal e adicionais",
      "criteria": [
        "Categorias disponíveis representam as atividades efetivamente prestadas.",
        "Categoria principal e eventuais alterações aprovadas e conferidas."
      ],
      "required": true,
      "critical": true,
      "weight": 4,
      "depends_on": [
        "scope",
        "authorization"
      ],
      "final_review": false
    },
    {
      "key": "location",
      "group_key": "information",
      "group_title": "Informações empresariais",
      "title": "Conferir endereço, pino e área atendida",
      "criteria": [
        "Endereço ou cobertura corresponde ao funcionamento real e à elegibilidade.",
        "Visibilidade do endereço e localização foram conferidas com o responsável."
      ],
      "required": true,
      "critical": true,
      "weight": 4,
      "depends_on": [
        "scope",
        "authorization"
      ],
      "final_review": false
    },
    {
      "key": "hours",
      "group_key": "information",
      "group_title": "Informações empresariais",
      "title": "Validar funcionamento e horários especiais",
      "criteria": [
        "Horários foram confirmados e condizem com o atendimento real.",
        "Exceções, feriados e atendimento por agendamento avaliados."
      ],
      "required": true,
      "critical": true,
      "weight": 3,
      "depends_on": [
        "scope",
        "authorization"
      ],
      "final_review": false
    },
    {
      "key": "contact",
      "group_key": "information",
      "group_title": "Informações empresariais",
      "title": "Testar os canais de contato disponíveis",
      "criteria": [
        "Telefone e canais habilitados direcionam ao negócio correto.",
        "Site, WhatsApp ou agendamento foram testados quando disponíveis e contratados."
      ],
      "required": true,
      "critical": true,
      "weight": 3,
      "depends_on": [
        "scope",
        "authorization"
      ],
      "final_review": false
    },
    {
      "key": "description",
      "group_key": "information",
      "group_title": "Informações empresariais",
      "title": "Revisar a descrição empresarial",
      "criteria": [
        "Texto descreve serviços e diferenciais verdadeiros de forma natural.",
        "Conteúdo foi revisado conforme as diretrizes do campo e conferido no perfil."
      ],
      "required": true,
      "critical": false,
      "weight": 3,
      "depends_on": [
        "scope",
        "authorization"
      ],
      "final_review": false
    },
    {
      "key": "attributes",
      "group_key": "information",
      "group_title": "Informações empresariais",
      "title": "Revisar os atributos aplicáveis",
      "criteria": [
        "Atributos disponíveis foram avaliados com o cliente.",
        "Somente características confirmadas do negócio foram informadas."
      ],
      "required": false,
      "critical": false,
      "weight": 2,
      "depends_on": [
        "scope",
        "authorization"
      ],
      "final_review": false
    },
    {
      "key": "services",
      "group_key": "content",
      "group_title": "Serviços e conteúdo",
      "title": "Organizar serviços efetivamente prestados",
      "criteria": [
        "Lista confirmada pelo negócio e organizada nas categorias disponíveis.",
        "Descrições úteis, naturais e conferidas após a publicação."
      ],
      "required": false,
      "critical": false,
      "weight": 3,
      "depends_on": [
        "scope",
        "authorization"
      ],
      "final_review": false
    },
    {
      "key": "products",
      "group_key": "content",
      "group_title": "Serviços e conteúdo",
      "title": "Organizar produtos quando previstos",
      "criteria": [
        "Recurso disponível para o perfil e incluído no escopo contratado.",
        "Produtos e informações reais aprovados e conferidos publicamente."
      ],
      "required": false,
      "critical": false,
      "weight": 2,
      "depends_on": [
        "scope",
        "authorization"
      ],
      "final_review": false
    },
    {
      "key": "posts",
      "group_key": "content",
      "group_title": "Serviços e conteúdo",
      "title": "Definir e executar o conteúdo inicial contratado",
      "criteria": [
        "Tema e quantidade conferidos no escopo e autorizados.",
        "Publicações e destinos do botão foram revisados e estão visíveis."
      ],
      "required": false,
      "critical": false,
      "weight": 3,
      "depends_on": [
        "scope",
        "authorization"
      ],
      "final_review": false
    },
    {
      "key": "assets",
      "group_key": "media",
      "group_title": "Mídias",
      "title": "Organizar logotipo e mídias reais",
      "criteria": [
        "Material autorizado, identificado e adequado aos requisitos de publicação.",
        "Pendências de imagens e vídeos registradas com o responsável."
      ],
      "required": false,
      "critical": false,
      "weight": 2,
      "depends_on": [
        "scope",
        "authorization"
      ],
      "final_review": false
    },
    {
      "key": "media_publish",
      "group_key": "media",
      "group_title": "Mídias",
      "title": "Conferir as mídias publicadas",
      "criteria": [
        "Quantidade prevista e autoria dos arquivos conferidas.",
        "Arquivos aparecem no perfil após a revisão do Google."
      ],
      "required": false,
      "critical": false,
      "weight": 3,
      "depends_on": [
        "scope",
        "authorization"
      ],
      "final_review": false
    },
    {
      "key": "reviews_audit",
      "group_key": "reputation",
      "group_title": "Reputação",
      "title": "Auditar avaliações e respostas",
      "criteria": [
        "Avaliações existentes e necessidade de resposta avaliadas.",
        "Riscos e comentários que precisam de encaminhamento documentados."
      ],
      "required": true,
      "critical": false,
      "weight": 2,
      "depends_on": [
        "scope",
        "authorization"
      ],
      "final_review": false
    },
    {
      "key": "reviews_reply",
      "group_key": "reputation",
      "group_title": "Reputação",
      "title": "Responder às avaliações previstas no escopo",
      "criteria": [
        "Respostas individualizadas preservam privacidade e informações confirmadas.",
        "Respostas publicadas foram conferidas no perfil."
      ],
      "required": false,
      "critical": false,
      "weight": 3,
      "depends_on": [
        "scope",
        "authorization"
      ],
      "final_review": false
    },
    {
      "key": "reviews_process",
      "group_key": "reputation",
      "group_title": "Reputação",
      "title": "Estruturar a solicitação legítima de avaliações",
      "criteria": [
        "Fluxo solicita experiências autênticas sem recompensa ou seleção por nota.",
        "Link e orientação foram testados e entregues ao responsável."
      ],
      "required": false,
      "critical": false,
      "weight": 2,
      "depends_on": [
        "scope",
        "authorization"
      ],
      "final_review": false
    },
    {
      "key": "consistency",
      "group_key": "presence",
      "group_title": "Presença local",
      "title": "Conferir a consistência das informações locais",
      "criteria": [
        "Nome, contato, endereço ou cobertura foram comparados nas fontes relevantes.",
        "Divergências foram corrigidas ou registradas como pendência."
      ],
      "required": true,
      "critical": false,
      "weight": 3,
      "depends_on": [
        "scope",
        "authorization"
      ],
      "final_review": false
    },
    {
      "key": "directories",
      "group_key": "presence",
      "group_title": "Presença local",
      "title": "Avaliar e ajustar diretórios relevantes",
      "criteria": [
        "Cada diretório escolhido tem utilidade real para o negócio e consta do escopo.",
        "Informações e publicação foram conferidas sem cadastros artificiais em massa."
      ],
      "required": false,
      "critical": false,
      "weight": 2,
      "depends_on": [
        "scope",
        "authorization"
      ],
      "final_review": false
    },
    {
      "key": "website",
      "group_key": "presence",
      "group_title": "Presença local",
      "title": "Conferir a integração com site e SEO local",
      "criteria": [
        "Site existente e trabalho contratado foram confirmados.",
        "Contato, conteúdo local e links pertinentes foram testados no site."
      ],
      "required": false,
      "critical": false,
      "weight": 3,
      "depends_on": [
        "scope",
        "authorization"
      ],
      "final_review": false
    },
    {
      "key": "public_check",
      "group_key": "quality",
      "group_title": "Auditoria e entrega",
      "title": "Auditar a versão pública do perfil",
      "criteria": [
        "Informações, contatos, conteúdos e mídias conferidos na Pesquisa e no Maps.",
        "Alterações em processamento e pendências do Google estão identificadas."
      ],
      "required": true,
      "critical": true,
      "weight": 4,
      "depends_on": [
        "scope",
        "authorization"
      ],
      "final_review": false
    },
    {
      "key": "handover",
      "group_key": "quality",
      "group_title": "Auditoria e entrega",
      "title": "Validar a implantação e entregar o relatório",
      "criteria": [
        "Todas as entregas aplicáveis foram conferidas e possuem evidência.",
        "Relatório entregue com mudanças, pendências externas e próximos compromissos."
      ],
      "required": true,
      "critical": true,
      "weight": 5,
      "depends_on": [
        "scope",
        "authorization"
      ],
      "final_review": true
    }
  ]
}
$playbook$::jsonb);

notify pgrst,'reload schema';
commit;
