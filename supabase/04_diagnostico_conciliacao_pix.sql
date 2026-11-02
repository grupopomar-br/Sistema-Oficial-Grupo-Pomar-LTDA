-- Leitura de metadados: não consulta nem altera pagamentos, credenciais ou clientes.
select
  current_setting('server_version_num')::integer / 10000 as versao_postgres,
  coalesce((
    select case md5(p.prosrc)
      when '24733c96f5688ff4d22f277029c8a532' then 'original'
      when '25e638e51f1439a3af98b7c6f7b540c8' then 'atualizada'
      else 'diferente'
    end
    from pg_catalog.pg_proc p
    where p.oid=to_regprocedure('public.pomar_billing_apply_payment(jsonb)')
      and p.prosecdef
  ), 'ausente_ou_incompativel') as funcao,
  (
    select count(*)=2 from pg_catalog.pg_trigger t
    where not t.tgisinternal and t.tgdeferrable and t.tginitdeferred
      and t.tgenabled in ('O','A')
      and t.tgfoid=to_regprocedure('pomar_private.check_financial_totals()')
      and ((t.tgrelid=to_regclass('public.pomar_receipts') and t.tgname='receipt_total')
        or (t.tgrelid=to_regclass('public.pomar_allocations') and t.tgname='allocation_total'))
  ) as gatilhos_conferem,
  coalesce(
    not has_table_privilege('pomar_billing_worker',to_regclass('public.pomar_receipts'),'select')
    and not has_table_privilege('pomar_billing_worker',to_regclass('public.pomar_allocations'),'insert')
    and has_function_privilege('pomar_billing_worker',to_regprocedure('public.pomar_billing_apply_payment(jsonb)'),'execute')
    and not has_function_privilege('anon',to_regprocedure('public.pomar_billing_apply_payment(jsonb)'),'execute')
    and not has_function_privilege('authenticated',to_regprocedure('public.pomar_billing_apply_payment(jsonb)'),'execute'),
    false
  ) as acesso_restrito;
