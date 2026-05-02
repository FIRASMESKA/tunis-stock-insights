-- Restrict execute on SECURITY DEFINER functions
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.match_chunks(vector, int, uuid) from public, anon;
-- match_chunks remains callable by authenticated users (filtered server-side via p_user_id)
grant execute on function public.match_chunks(vector, int, uuid) to authenticated;