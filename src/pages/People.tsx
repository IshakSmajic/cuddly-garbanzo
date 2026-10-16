import { useState } from 'react'
import { AppHeader } from '../components/AppHeader.tsx'
import { Field } from '../components/Field.tsx'
import { PersonRow } from '../components/PersonRow.tsx'
import { RelationActions } from '../components/RelationActions.tsx'
import { useUserSearch } from '../lib/useUserSearch.ts'
import { USERNAME_MAX } from '../lib/validation.ts'

export function People() {
  const [input, setInput] = useState('')
  const { query, problem, state } = useUserSearch(input)

  const hint =
    problem ?? (state.status === 'searching' ? 'Searching…' : 'Search by the start of a username.')

  return (
    <div className="home">
      <AppHeader />
      <main className="settings page-wide">
        <p className="eyebrow">People</p>
        <h1 className="auth-title">Find your friends.</h1>
        <p className="auth-subtitle">Look someone up by username and send them a request.</p>

        <div className="auth-fields">
          <Field
            label="Username"
            prefix="@"
            type="search"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            maxLength={USERNAME_MAX + 5}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            hint={hint}
            invalid={Boolean(problem)}
          />
        </div>

        {state.status === 'error' && (
          <p className="form-error list-message" role="alert">
            {state.error}
          </p>
        )}
        {state.status === 'done' &&
          (state.results.length === 0 ? (
            <p className="muted list-message" role="status">
              No one's username starts with @{query}.
            </p>
          ) : (
            <ul className="person-list" aria-label="Search results">
              {state.results.map((person) => (
                <PersonRow key={person.user_id} person={person}>
                  {/* Keyed by relation too, so a fresh search resets the buttons. */}
                  <RelationActions
                    key={`${person.relation}:${person.request_id}`}
                    userId={person.user_id}
                    initial={person}
                  />
                </PersonRow>
              ))}
            </ul>
          ))}
      </main>
    </div>
  )
}
