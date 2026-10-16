-- Milestone 7: live updates through Supabase Realtime (postgres_changes).
--
-- Realtime reads changes from the supabase_realtime publication and sends
-- each one only to subscribers whose SELECT policy allows that row: inserts
-- and updates are checked as the subscriber. Deletes cannot be: the row is
-- gone, so Realtime sends the old primary key to *every* subscriber of the
-- table. That decides what may be published:
--
--   messages          yes: rows are deleted only when both accounts are gone,
--                     and the key is a meaningless number
--   friend_requests   yes: the key is a random uuid
--   friendships       NO: the key is the two user ids (who unfriended whom)
--   conversation_members  NO: the key says who was in which conversation
--   blocks            NO: the key says who blocked whom
--
-- supabase/tests/database/realtime.test.sql checks the exact list, so adding
-- a table here is a deliberate decision.

alter publication supabase_realtime add table public.messages, public.friend_requests;
