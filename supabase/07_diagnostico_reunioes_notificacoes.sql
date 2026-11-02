-- Apenas metadados; não retorna reuniões, clientes, endpoints ou segredos.
select
 to_regprocedure('public.pomar_workspace_scheduled()') is not null as agenda_instalada,
 to_regprocedure('public.pomar_notifications_list()') is not null as avisos_instalados,
 exists(select 1 from pg_roles where rolname='pomar_notification_worker' and rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole and not rolbypassrls and not rolinherit) as worker_restrito_com_login,
 (select bool_and(relrowsecurity and relforcerowsecurity) and count(*)=2 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('pomar_meetings','pomar_notifications')) as rls_forcado;
