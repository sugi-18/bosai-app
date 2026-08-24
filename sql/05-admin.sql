-- ============================================================
--  地域防災力評価システム / 追加スキーマ 第4弾
--
--  目的：
--    ・複数の自治会を1つの管理画面から扱えるようにする
--    ・自治会の新規作成を管理画面からできるようにする
--
--  実行方法：Supabase の SQL Editor に全文を貼って Run するだけです。
--            何度実行しても壊れません（同じ結果になります）。
-- ============================================================


-- ============================================================
--  1. 自治会の書き換えを許可する
--     これまでは「読むだけ」だったため、名称の修正もできませんでした。
--     自分が管理者になっている自治会に限り、書き換えられるようにします。
-- ============================================================
drop policy if exists p_assoc_write on associations;

create policy p_assoc_write on associations for update
  using (is_association_admin(id))
  with check (is_association_admin(id));


-- ============================================================
--  2. 自治会を新しく作るRPC
--
--     新規作成だけはRLSで許可できません。
--     「自分が管理者である自治会だけ触れる」という規則のもとでは、
--     まだ存在しない自治会の管理者にはなりようがないためです。
--     そこで、作成と管理者登録をひとまとめにしたRPCを用意します。
--     実行した本人が、そのままその自治会の owner になります。
-- ============================================================
create or replace function create_association(
  p_name            text,
  p_municipality    text default null,
  p_household_count integer default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'ログインが必要です';
  end if;

  if coalesce(btrim(p_name), '') = '' then
    raise exception '自治会の名称を入力してください';
  end if;

  insert into associations (name, municipality, household_count)
  values (btrim(p_name), nullif(btrim(p_municipality), ''), p_household_count)
  returning id into v_id;

  insert into association_admins (association_id, user_id, role)
  values (v_id, v_uid, 'owner');

  return v_id;
end $$;

revoke all on function create_association(text, text, integer) from public;
grant execute on function create_association(text, text, integer) to authenticated;


-- ============================================================
--  3. 確認
--     実行後、下の行を選択して Run すると、自分が管理している自治会が見られます
-- ============================================================
-- select a.name, aa.role
--   from associations a
--   join association_admins aa on aa.association_id = a.id
--  where aa.user_id = auth.uid();
