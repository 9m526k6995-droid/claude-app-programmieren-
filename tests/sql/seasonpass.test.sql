-- Tests für supabase/seasonpass.sql (Season Pass, Aufgaben, Coins/Gems, Shop, Testkäufe, Sammlung, Admin)
\set ON_ERROR_STOP 1
\set QUIET 1

insert into auth.users (id, email) values
  ('5e000000-0000-0000-0000-000000000001', 'sp1@test.de'),
  ('5e000000-0000-0000-0000-000000000002', 'sp2@test.de'),
  ('5e000000-0000-0000-0000-000000000003', 'sp3@test.de'),
  ('5e000000-0000-0000-0000-000000000009', 'sp-admin@test.de');
insert into public.zwip_admins (email) values ('sp-admin@test.de') on conflict do nothing;
\set S1 '''5e000000-0000-0000-0000-000000000001'''
\set S2 '''5e000000-0000-0000-0000-000000000002'''
\set S3 '''5e000000-0000-0000-0000-000000000003'''
\set SA '''5e000000-0000-0000-0000-000000000009'''

set role authenticated;
select t_login(:S1); select set_username('Pass_Paul');
select t_login(:S2); select set_username('Pass_Pia');
select t_login(:SA); select set_username('Pass_Admin');
-- S3 registriert sich gerade erst (für die Einladung)
select t_login(:S3); select set_username('Pass_Neu');

-- ---------- Season ----------
select t_login(:S1);
create temp table t_sp as select get_season_pass() as p;
select t_assert((select (p -> 'season' ->> 'levels')::int = 40 from t_sp), 'Season hat 40 Stufen');
select t_assert((select (p -> 'season' ->> 'ends_at')::timestamptz - (p -> 'season' ->> 'starts_at')::timestamptz = interval '42 days' from t_sp),
                'Season dauert 6 Wochen');
select t_assert((select jsonb_array_length(p -> 'rewards') = 80 from t_sp), 'Je Stufe eine Gratis- und eine Premium-Belohnung');
select t_assert((select (p ->> 'level')::int = 0 and (p ->> 'premium')::boolean is false from t_sp), 'Neuer Spieler: Stufe 0, kein Premium');
select t_assert((select r -> 'item' ->> 'exclusive' = 'true' and r -> 'item' ->> 'kind' = 'skin'
                 from t_sp, jsonb_array_elements(p -> 'rewards') r where (r ->> 'level')::int = 40 and r ->> 'track' = 'premium'),
                'Stufe 40 Premium: exklusiver Season-Skin');
select t_assert((select bool_and(r -> 'item' ->> 'kind' is distinct from 'trophy') from t_sp, jsonb_array_elements(p -> 'rewards') r),
                'Keine Belohnung gibt Trophäen');
select t_assert((select jsonb_array_length(p -> 'quests' -> 'daily') = 3 and jsonb_array_length(p -> 'quests' -> 'weekly') = 3 from t_sp),
                '3 tägliche und 3 wöchentliche Aufgaben');
select t_assert((select count(distinct q ->> 'metric') = 3 from t_sp, jsonb_array_elements(p -> 'quests' -> 'daily') q),
                'Tägliche Aufgaben sind verschiedene Arten');
select t_assert(get_season_pass() -> 'quests' = (select p -> 'quests' from t_sp), 'Aufgaben bleiben gleich beim erneuten Öffnen');

-- Feste Aufgaben für planbare Tests
reset role;
delete from public.sp_quests where user_id = :S1;
insert into public.sp_quests (user_id, period, quest_key, kind, title, metric, goal, xp, coins)
select :S1, 'd:' || public.zwip_sp_today(), key, kind, title, metric, goal, xp, coins from public.sp_quest_pool where key in ('d_streak2', 'd_play3', 'd_mini3');
insert into public.sp_quests (user_id, period, quest_key, kind, title, metric, goal, xp, coins)
select :S1, 'w:' || public.zwip_sp_week(), key, kind, title, metric, goal, xp, coins from public.sp_quest_pool where key in ('w_invite', 'w_friend', 'w_daily5');

-- ---------- XP aus Runden ----------
reset role;
select t_play(:S1, t_tasks(15, 2, 0));
set role authenticated; select t_login(:S1);
select t_assert((get_season_pass() ->> 'xp')::int = 120, 'Gewonnene Trophäen-Runde: 120 XP');
select t_assert((get_season_pass() -> 'wallet' ->> 'coins')::int = 10, 'Gewonnene Runde: 10 Coins');
select t_assert((get_season_ping() ->> 'xp')::int = 120, 'Rückmeldung nach der Runde: +120 XP');
select t_assert((get_season_ping() ->> 'xp')::int = 0, 'Rückmeldung kommt nur einmal');
reset role;
select t_play(:S1, t_tasks(15, 2, 0));
set role authenticated; select t_login(:S1);
select t_assert((select bool_or((q ->> 'done')::boolean) from jsonb_array_elements(get_season_pass() -> 'quests' -> 'daily') q where q ->> 'key' = 'd_streak2'),
                'Aufgabe „2 Runden am Stück gewinnen“ geschafft');
select t_assert((get_season_ping() ->> 'quests')::int = 1, 'Rückmeldung: 1 Aufgabe geschafft');
select t_assert((get_season_pass() ->> 'xp')::int = 120 + 120 + 350, 'Aufgaben-XP wird gutgeschrieben');
reset role;
select t_play(:S1, t_tasks(0, 0, 15));
select t_assert((select win_streak from public.sp_progress where user_id = :S1) = 0, 'Verlorene Runde beendet die Siegesserie');
select t_assert((select xp from public.sp_progress where user_id = :S1) = 590 + 60 + 250, 'Verlorene Runde: 60 XP (+ Aufgabe „3 Runden“)');

-- Minigames: ab Stufe 1, "Sieg" ab Stufe 5; Stufe 0 gibt nichts
create temp table t_x0 as select xp from public.sp_progress where user_id = :S1;
select t_run(:S1, 'memory', 0, 0);
select t_assert((select xp from public.sp_progress where user_id = :S1) = (select xp from t_x0), 'Minigame ohne geschaffte Stufe: keine XP');
select t_run(:S1, 'memory', 6, 9000);
select t_assert((select xp from public.sp_progress where user_id = :S1) = (select xp from t_x0) + 60, 'Minigame ab Stufe 5: 60 XP');
select t_run(:S1, 'memory', 2, 3000);
select t_assert((select xp from public.sp_progress where user_id = :S1) = (select xp from t_x0) + 90, 'Minigame Stufe 2: 30 XP');

-- Tageslimit: höchstens 1.500 XP und 150 Coins am Tag aus Runden
do $$ begin for i in 1..30 loop perform public.zwip_sp_on_round('5e000000-0000-0000-0000-000000000002', 'trophy', true, 0); end loop; end $$;
select t_assert((select day_xp from public.sp_progress where user_id = :S2) = 1500, 'Höchstens 1.500 Runden-XP am Tag');
select t_assert((select day_coins from public.sp_progress where user_id = :S2) = 150, 'Höchstens 150 Runden-Coins am Tag');

-- Daily (einmal pro Tag)
create temp table t_x1 as select xp from public.sp_progress where user_id = :S1;
create temp table t_day as select public.zwip_sp_today() - date '2026-09-30' as d;
grant select on t_day to authenticated;
set role authenticated; select t_login(:S1);
select mark_daily_played((select d from t_day), 1);
select mark_daily_played((select d from t_day), 1);
reset role;
select t_assert((select xp from public.sp_progress where user_id = :S1) = (select xp from t_x1) + 150, 'Daily gibt einmal 150 XP');
select t_assert((select progress from public.sp_quests where user_id = :S1 and quest_key = 'w_daily5') = 1, 'Wochenaufgabe zählt die Daily');

-- Trophäen bleiben unberührt
select t_assert(not exists (select 1 from information_schema.routines where routine_schema = 'public' and routine_name like '%sp%'
                and routine_definition ilike '%update public.profiles set trophies%'), 'Season Pass ändert nie Trophäen');

-- ---------- Belohnungen abholen ----------
reset role;
update public.sp_progress set xp = 1500 * 3 where user_id = :S1;
set role authenticated; select t_login(:S1);
select t_assert((get_season_pass() ->> 'level')::int = 3, '4.500 XP = Stufe 3');
select t_assert(t_error_of($$select claim_season_reward(10, 'free')$$) = 'reward_locked', 'Noch nicht erreichte Stufe ist gesperrt');
select t_assert(t_error_of($$select claim_season_reward(1, 'premium')$$) = 'premium_required', 'Premium-Belohnung nur mit Pass');
create temp table t_c0 as select (get_season_pass() -> 'wallet' ->> 'coins')::int c;
select claim_season_reward(1, 'free');
select t_assert((get_season_pass() -> 'wallet' ->> 'coins')::int = (select c from t_c0) + 50, 'Gratis-Belohnung Stufe 1: 50 Coins');
select t_assert(t_error_of($$select claim_season_reward(1, 'free')$$) = 'already_claimed', 'Belohnung nur einmal');
select claim_season_reward();
select t_assert(exists (select 1 from jsonb_array_elements(get_my_cosmetics() -> 'items') i where i ->> 'id' = 'av_fox'),
                '„Alle abholen“: Fuchs-Profilbild (Stufe 3) ist in der Sammlung');

-- ---------- Echtgeld-Käufe im Testmodus ----------
select t_assert((get_shop() ->> 'can_buy')::boolean is false, 'Testkäufe sind standardmäßig nur für Admins');
select t_assert(t_error_of($$select buy_product_test('pass')$$) = 'payments_unavailable', 'Normale Spieler können nicht testkaufen');
select t_login(:SA);
select t_assert((get_shop() ->> 'can_buy')::boolean, 'Admin darf testkaufen');
select admin_sp_set_setting('test_purchases', 'all');
select t_login(:S1);
select t_assert((select (p ->> 'price_cents')::int = 499 from jsonb_array_elements(get_shop() -> 'products') p where p ->> 'id' = 'pass'),
                'Season Pass kostet 4,99 €');
select buy_product_test('pass');
select t_assert((get_season_pass() ->> 'premium')::boolean, 'Pass gekauft → Premium');
select t_assert((select count(*) = 3 from jsonb_array_elements(get_season_pass() -> 'rewards') r
                 where r ->> 'track' = 'premium' and (r ->> 'claimed')::boolean), 'Premium-Belohnungen der Stufen 1–3 nachträglich bekommen');
select t_assert(t_error_of($$select buy_product_test('pass')$$) = 'already_owned', 'Pass nur einmal pro Season');
select t_assert(exists (select 1 from jsonb_array_elements(get_shop() -> 'products') p where p ->> 'id' = 'pass' and (p ->> 'owned')::boolean),
                'Shop zeigt: Pass schon gekauft');
create temp table t_g0 as select (get_shop() -> 'wallet' ->> 'gems')::int g;
select buy_product_test('gems_s');
select t_assert((get_shop() -> 'wallet' ->> 'gems')::int = (select g from t_g0) + 80, '80 Gems für 0,99 €');
select buy_product_test('starter');
select t_assert(t_error_of($$select buy_product_test('starter')$$) = 'already_owned', 'Starter-Paket nur einmal');
select t_assert(exists (select 1 from jsonb_array_elements(get_my_cosmetics() -> 'items') i where i ->> 'id' = 'fr_starter'), 'Starter-Paket: Rahmen erhalten');
reset role;
select t_assert((select count(*) from public.sp_purchases where user_id = :S1 and provider = 'test') = 3, 'Testkäufe werden gespeichert');
select t_assert(not exists (select 1 from public.sp_purchases where provider = 'test' and provider_tx is not null), 'Testkäufe haben keine Store-Transaktion');

-- Echte Store-Käufe: nur Server, jede Transaktion nur einmal
set role authenticated; select t_login(:S2);
select t_assert(t_error_of($$select public.zwip_sp_store_purchase(auth.uid(), 'apple', 'tx1', 'gems_m')$$) like 'permission denied%',
                'Store-Käufe kann nur der Server gutschreiben');
reset role;
select public.zwip_sp_store_purchase(:S2, 'apple', 'tx1', 'gems_m');
select public.zwip_sp_store_purchase(:S2, 'apple', 'tx1', 'gems_m');
select t_assert((select gems from public.sp_wallets where user_id = :S2) = 500, 'Gleiche Store-Transaktion nur einmal gutgeschrieben');

-- ---------- Tages-Shop ----------
set role authenticated; select t_login(:S2);
create temp table t_shop as select get_shop() s;
select t_assert((select jsonb_array_length(s -> 'items') = 6 from t_shop), 'Tages-Shop zeigt 6 Items');
select t_assert(get_shop() -> 'items' = (select s -> 'items' from t_shop), 'Tages-Shop ist den ganzen Tag gleich');
select t_assert((select bool_and(i ->> 'exclusive' = 'false') from t_shop, jsonb_array_elements(s -> 'items') i), 'Keine Season-Items im Shop');
create temp table t_pick as select i ->> 'id' as id, (i ->> 'price_gems')::int as gems from t_shop, jsonb_array_elements(s -> 'items') i
  where i ->> 'price_gems' is not null order by (i ->> 'price_gems')::int limit 1;
select t_assert(t_error_of(format('select buy_shop_item(%L, %L)', 'av_star', 'gems')) = 'not_in_shop', 'Nur Items aus dem heutigen Shop');
select buy_shop_item((select id from t_pick), 'gems');
select t_assert((get_shop() -> 'wallet' ->> 'gems')::int = 500 - (select gems from t_pick), 'Gems werden abgezogen');
select t_assert(t_error_of(format('select buy_shop_item(%L, %L)', (select id from t_pick), 'gems')) = 'already_owned', 'Nichts doppelt kaufen');
select t_login(:S3);
select t_assert(t_error_of(format('select buy_shop_item(%L, %L)', (select id from t_pick), 'gems')) = 'not_enough_gems', 'Ohne Gems kein Kauf');
reset role;
select t_assert(not exists (select 1 from public.sp_wallets where coins < 0 or gems < 0), 'Kein Konto im Minus');

-- ---------- Sammlung & Ausrüsten ----------
set role authenticated; select t_login(:S1);
select t_assert(t_error_of($$select equip_cosmetic('skin', 'sk_lava')$$) = 'not_owned', 'Nur eigene Items ausrüsten');
select t_assert(t_error_of($$select equip_cosmetic('frame', 'av_fox')$$) = 'not_owned', 'Item muss zur Art passen');
select equip_cosmetic('avatar', 'av_fox');
select equip_cosmetic('frame', 'fr_starter');
select t_assert(get_my_cosmetics() -> 'equipped' -> 'avatar' ->> 'id' = 'av_fox', 'Profilbild ausgerüstet');
select t_login(:S2);
select t_assert(get_player_cosmetics('pass_paul') -> 'frame' ->> 'id' = 'fr_starter', 'Andere sehen den Rahmen');
select t_login(:S1);
select equip_cosmetic('frame', null);
select t_assert(get_my_cosmetics() -> 'equipped' -> 'frame' = 'null'::jsonb, 'Rahmen ablegen');

-- ---------- Einladung & Freunde ----------
select t_login(:S3);
select t_assert((claim_referral('Pass_Paul') ->> 'ok')::boolean, 'Neuer Spieler über Einladung');
select t_assert((claim_referral('Pass_Paul') ->> 'ok')::boolean is false, 'Einladung zählt nur einmal');
select t_login(:S2);
select t_assert((claim_referral('Pass_Pia') ->> 'ok')::boolean is false, 'Sich selbst einladen geht nicht');
reset role;
update auth.users set created_at = now() - interval '10 days' where id = :S2;
set role authenticated; select t_login(:S2);
select t_assert((claim_referral('Pass_Paul') ->> 'ok')::boolean is false, 'Alte Konten zählen nicht als Einladung');
reset role;
select t_assert((select done_at is not null from public.sp_quests where user_id = :S1 and quest_key = 'w_invite'), 'Aufgabe „Freund einladen“ geschafft');
set role authenticated; select t_login(:S1);
select send_friend_request('Pass_Pia');
select t_login(:S2);
select respond_friend_request('Pass_Paul', true);
reset role;
select t_assert((select done_at is not null from public.sp_quests where user_id = :S1 and quest_key = 'w_friend'), 'Aufgabe „Neuer Freund“ geschafft');

-- ---------- Datenauskunft ----------
set role authenticated; select t_login(:S1);
select t_assert(jsonb_array_length(export_my_data() -> 'season_pass' -> 'purchases') = 3, 'Käufe stehen in „Meine Daten herunterladen“');

-- ---------- Sicherheit ----------
set role authenticated; select t_login(:S1);
select t_assert(t_error_of($$update public.sp_wallets set gems = 99999$$) like 'permission denied%', 'Gems lassen sich nicht direkt ändern');
select t_assert(t_error_of($$insert into public.sp_inventory values (auth.uid(), 'sk_lava', 'x')$$) like 'permission denied%', 'Items lassen sich nicht selbst eintragen');
select t_assert(t_error_of($$select public.zwip_sp_add_xp(auth.uid(), 100000)$$) like 'permission denied%', 'XP lässt sich nicht selbst vergeben');
select t_assert(t_error_of($$select admin_sp_overview()$$) = 'not_admin', 'Shop-Verwaltung nur für Admins');
reset role; set role anon; select t_login('');
select t_assert(t_error_of($$select get_season_pass()$$) like 'permission denied%', 'Ohne Anmeldung kein Pass');
reset role;

-- ---------- Admin ----------
set role authenticated; select t_login(:SA);
select t_assert(t_error_of($$select admin_sp_save_item('sk_bad', 'skin', 'Böse', 'rare', '{"a":"red;background:url(x)","b":"#000000"}')$$) = 'invalid_item_data',
                'Ungültige Farben werden abgelehnt');
select t_assert(t_error_of($$select admin_sp_save_item('em_bad', 'emote', 'Böse', 'rare', '{"e":"<img>"}')$$) = 'invalid_item_data',
                'HTML in Emotes wird abgelehnt');
select admin_sp_save_item('sk_test', 'skin', 'Testskin', 'rare', '{"a":"#112233","b":"#445566"}');
select t_assert(exists (select 1 from jsonb_array_elements(admin_sp_overview() -> 'items') i where i ->> 'id' = 'sk_test'), 'Admin legt Item an');
select admin_sp_set_shop('sk_test', 900, null, true, true);
select t_assert(exists (select 1 from jsonb_array_elements(get_shop() -> 'items') i where i ->> 'id' = 'sk_test'), 'Dauerangebot ist immer im Shop');
create temp table t_cur as select (admin_sp_overview() ->> 'current')::int id;
select t_assert(t_error_of(format('select admin_sp_set_shop(%L, 100, null, false, true)', 'sk_season_' || (select id from t_cur))) = 'exclusive_item',
                'Exklusive Season-Items dürfen nicht in den Shop');
select admin_sp_set_reward((select id from t_cur), 5, 'free', 'sk_test', 0, 5);
select t_assert(exists (select 1 from jsonb_array_elements(admin_sp_rewards((select id from t_cur))) r
                        where (r ->> 'level')::int = 5 and r ->> 'track' = 'free' and r ->> 'item_id' = 'sk_test'), 'Admin ändert Belohnung');
select admin_sp_set_product('gems_s', '80 Gems', 129, 80, 0, true);
select t_assert((select (p ->> 'price_cents')::int = 129 from jsonb_array_elements(get_shop() -> 'products') p where p ->> 'id' = 'gems_s'), 'Admin ändert Preis');
select t_assert(t_error_of($$select admin_sp_create_season('Zu früh', now(), 6)$$) = 'season_overlap', 'Seasons dürfen sich nicht überschneiden');
select admin_sp_create_season('Halloween', (select (x ->> 'ends_at')::timestamptz from jsonb_array_elements(admin_sp_overview() -> 'seasons') x where (x ->> 'id')::int = (select id from t_cur)), 4);
reset role;
select t_assert((select count(*) from public.sp_rewards r join public.sp_seasons s on s.id = r.season_id where s.name = 'Halloween') = 80,
                'Neue Season übernimmt die Belohnungen');
select t_assert((select r.item_id from public.sp_rewards r join public.sp_seasons s on s.id = r.season_id
                 where s.name = 'Halloween' and r.level = 40 and r.track = 'premium') = 'sk_season_' || (select id from public.sp_seasons where name = 'Halloween'),
                'Neue Season bekommt einen eigenen exklusiven Skin');

-- Automatischer Wechsel, wenn eine Season abläuft
delete from public.sp_seasons where name = 'Halloween';
update public.sp_seasons set starts_at = now() - interval '42 days' - interval '1 minute', ends_at = now() - interval '1 minute' where id = (select id from t_cur);
create temp table t_new as select * from public.zwip_sp_current_season();
select t_assert((select id from t_new) <> (select id from t_cur) and (select num from t_new) = 2, 'Abgelaufene Season → nächste startet automatisch');
select t_assert((select ends_at - starts_at from t_new) = interval '42 days', 'Neue Season wieder 6 Wochen');
select t_assert((select count(*) from public.sp_rewards where season_id = (select id from t_new)) = 80, 'Belohnungen werden übernommen');
set role authenticated; select t_login(:S1);
select t_assert((get_season_pass() ->> 'xp')::int = 0 and (get_season_pass() ->> 'premium')::boolean is false, 'Neue Season: Fortschritt und Premium zurückgesetzt');
select t_assert(exists (select 1 from jsonb_array_elements(get_my_cosmetics() -> 'items') i where i ->> 'id' = 'av_fox'), 'Gesammelte Items bleiben');
reset role;
\echo 'ALLE SEASON-PASS-TESTS BESTANDEN'
