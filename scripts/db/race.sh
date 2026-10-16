#!/usr/bin/env bash
# Concurrency checks for the friend-request functions. pgTAP runs in one
# session and one transaction, so it can't show two users acting at the same
# moment; this opens two real database sessions that overlap in time.
#
# Each race: session 1 calls a function and then holds its transaction open
# for a second (pg_sleep), still holding the pair lock; session 2 starts
# 0.3 s later on the same pair and must wait, then see session 1's result.
# Needs the local stack (npm run db:start). Creates and deletes its own users.
set -euo pipefail

DB=${DB_CONTAINER:-supabase_db_cuddly-garbanzo}
A=eeeeeeee-0000-0000-0000-00000000000a
B=eeeeeeee-0000-0000-0000-00000000000b
failed=0
tmp=$(mktemp -d)

sql() { docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qtA "$@"; }

# One transaction as the given user; extra SQL (e.g. a sleep) runs before commit.
as_user() {
  local user=$1 call=$2 hold=${3:-}
  sql 2>&1 <<SQL || true
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "$user", "role": "authenticated"}', true) \\g /dev/null
select $call;
$hold
commit;
SQL
}

check() {
  if [ "$1" = "$2" ]; then echo "PASS  $3"; else echo "FAIL  $3 (expected '$2', got '$1')"; failed=1; fi
}

reset_pair() {
  sql <<SQL
delete from auth.users where id in ('$A', '$B');
insert into auth.users (id, email) values ('$A', 'race-a@example.com'), ('$B', 'race-b@example.com');
update public.profiles set username = 'race_a' where user_id = '$A';
update public.profiles set username = 'race_b' where user_id = '$B';
SQL
}

state() {
  sql -c "select
    (select count(*) from public.friendships where user_low_id = '$A' and user_high_id = '$B'),
    (select count(*) from public.friend_requests where status = 'pending' and '$A' in (requester_id, recipient_id)),
    (select count(*) from public.blocks where blocker_id = '$A'),
    (select count(*) from public.direct_conversations where user_low_id = '$A' and user_high_id = '$B'),
    (select count(*) from public.conversation_members m
     join public.direct_conversations d using (conversation_id)
     where d.user_low_id = '$A' and d.user_high_id = '$B')"
}

hold="select pg_sleep(1) \\g /dev/null"

echo "1. A and B send each other a request at the same moment"
reset_pair
as_user $A "public.send_friend_request('$B')" "$hold" > "$tmp/1" &
/bin/sleep 0.3
second=$(as_user $B "public.send_friend_request('$A')")
wait
check "$(cat "$tmp/1")" "pending" "the first send creates a request"
check "$second" "friends" "the second waits, then finds the request and accepts it"
check "$(state)" "1|0|0|1|2" "one friendship and one conversation with both members, no pending request left"

echo "2. B accepts while A blocks B"
reset_pair
as_user $A "public.send_friend_request('$B')" > /dev/null
req=$(sql -c "select id from public.friend_requests where requester_id = '$A' and status = 'pending'")
as_user $B "public.respond_to_friend_request('$req', true)" "$hold" > "$tmp/2" &
/bin/sleep 0.3
as_user $A "public.block_user('$B')" > /dev/null
wait
check "$(cat "$tmp/2")" "accepted" "the accept finishes first"
check "$(state)" "0|0|1|1|2" "the block then removes the new friendship; the conversation stays"

echo "3. A blocks B while B accepts"
reset_pair
as_user $A "public.send_friend_request('$B')" > /dev/null
req=$(sql -c "select id from public.friend_requests where requester_id = '$A' and status = 'pending'")
as_user $A "public.block_user('$B')" "$hold" > /dev/null &
/bin/sleep 0.3
second=$(as_user $B "public.respond_to_friend_request('$req', true)")
wait
check "$(echo "$second" | grep -o 'no longer pending' || true)" "no longer pending" \
  "the accept waits, then finds the request cancelled"
check "$(state)" "0|0|1|0|0" "no friendship and no conversation, the block stays"

sql -c "delete from auth.users where id in ('$A', '$B')"
rm -rf "$tmp"
[ $failed = 0 ] && echo "All race checks passed" || { echo "Some race checks FAILED"; exit 1; }
