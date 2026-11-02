-- Somente metadados. Não retorna perfis, textos internos ou dados financeiros.
select
 exists(select 1 from information_schema.columns where table_schema='public' and table_name='pomar_projects' and column_name='completed_on') as conclusao_disponivel,
 to_regprocedure('public.pomar_workspace_personalized()') is not null as metodologias_e_perfil,
 to_regprocedure('public.pomar_touch_session_v2()') is not null as sessao_atualizada,
 coalesce((select not public and file_size_limit=2097152 and allowed_mime_types=array['image/webp'] from storage.buckets where id='pomar-profile'),false) as bucket_privado,
 (select count(*)=2 and bool_and(relrowsecurity and relforcerowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('pomar_methodologies','pomar_profiles')) as rls_forcado,
 not has_table_privilege('anon','public.pomar_settings','select') as anonimo_restrito;
