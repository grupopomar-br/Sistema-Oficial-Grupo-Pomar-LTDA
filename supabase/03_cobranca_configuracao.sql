-- OPCIONAL. Execute somente ao preparar a integração, após as três migrações e 02_proprietario.sql.
-- Faça primeiro em homologação. Não salve a versão preenchida no Git ou em arquivos compartilhados.
begin;
do $$
declare
 owner_uuid uuid:='00000000-0000-0000-0000-000000000000';
 collector text:='SUBSTITUA_PELO_ID_DA_CONTA_DE_TESTE';
 payment_mode text:='test';
 worker_password text:='SUBSTITUA_POR_UM_SEGREDO_LONGO_DO_SEU_GERENCIADOR';
begin
 if owner_uuid='00000000-0000-0000-0000-000000000000' or collector !~ '^\d{1,30}$' or worker_password='SUBSTITUA_POR_UM_SEGREDO_LONGO_DO_SEU_GERENCIADOR' or char_length(worker_password)<32 then raise exception 'Preencha proprietário, ID do recebedor de teste e segredo do worker em ambiente privado.';end if;
 if payment_mode<>'test' then raise exception 'Este roteiro inicial habilita somente homologação. A produção exige checklist separado.';end if;
 if not exists(select 1 from pomar_private.owner_registry where owner_id=owner_uuid and active) then raise exception 'Proprietário não configurado neste projeto.';end if;
 if exists(select 1 from pomar_private.billing_config where owner_id<>owner_uuid or collector_id<>collector or mode<>payment_mode) then raise exception 'Já existe outra configuração de cobrança. Não substitua uma conta/ambiente por este roteiro.';end if;
 if exists(select 1 from pg_auth_members m join pg_roles r on r.oid=m.member where r.rolname='pomar_billing_worker') then raise exception 'O worker possui associação a outro papel; revise antes de habilitar.';end if;
 execute format('alter role pomar_billing_worker login password %L',worker_password);
 insert into pomar_private.billing_config(singleton,owner_id,collector_id,mode,enabled) values(true,owner_uuid,collector,payment_mode,true)
 on conflict(singleton) do update set enabled=true;
end $$;
commit;
