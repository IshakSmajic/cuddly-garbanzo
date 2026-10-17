// Deleting your own account. The delete-account Edge Function
// (supabase/functions/delete-account) checks the password again and deletes
// the user; the foreign keys decide what goes with it (spec section 11).
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase.ts'

/**
 * Set once the account is deleted, for the sign-in page's note. Not router
 * state: signing out makes the route guard replace the settings page at
 * once, so it can't navigate anywhere itself.
 */
export const accountDeletion = { done: false }

export async function deleteAccount(password: string): Promise<void> {
  const { error } = await supabase.functions.invoke('delete-account', { body: { password } })
  if (!error) {
    accountDeletion.done = true
    // The server session is already gone; just forget it here. The route
    // guard then shows the sign-in page.
    await supabase.auth.signOut({ scope: 'local' })
    return
  }
  const status = error instanceof FunctionsHttpError ? (error.context as Response).status : 0
  if (status === 403) throw new Error("That password isn't right.")
  if (status === 401) throw new Error('Your session has ended. Sign in again, then try once more.')
  throw new Error("Couldn't delete your account. Check your connection and try again.")
}
