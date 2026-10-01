-- 테스트 전용: Supabase가 제공하는 auth 스키마·역할을 최소한으로 흉내 낸다(실제 Supabase에는 이미 있음).
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
-- Supabase 기본 권한: public 스키마의 새 테이블에 anon/authenticated 전체 권한이 기본 부여된다.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
