import { Button, Field, Icon, cx } from '../../components/ui'
import type { BookingGuest } from '../../lib/queries/bookings'
import type { BookingType } from '../../lib/types'

export function emptyGuest(): BookingGuest {
  return {
    name: '',
    age: null,
    gender: null,
    contactNumber: null,
    idProofType: null,
    idProofNumber: null,
  }
}

/*
  Captured for OTHER and COMBINE only (ARCHITECTURE.md §5). What the list means
  differs between them, and the wording says so: for OTHER the booker is not
  staying, for COMBINE they are, and that difference changes the capacity check.
*/
export function GuestListEditor({
  bookingType,
  guests,
  onChange,
  error,
  disabled,
}: {
  bookingType: BookingType
  guests: BookingGuest[]
  onChange: (guests: BookingGuest[]) => void
  error?: string
  disabled?: boolean
}) {
  if (bookingType === 'SELF') return null

  function update(index: number, patch: Partial<BookingGuest>) {
    onChange(guests.map((guest, i) => (i === index ? { ...guest, ...patch } : guest)))
  }

  function remove(index: number) {
    onChange(guests.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="font-medium">Guests staying</h3>
          <p className="text-sm text-[var(--text-secondary)]">
            {bookingType === 'OTHER'
              ? 'Everyone staying. The person who booked is not counted.'
              : 'The others staying with you — you are counted automatically.'}
          </p>
        </div>
        <p className="tabular text-sm text-[var(--text-muted)]">
          {guests.length} listed
        </p>
      </div>

      {guests.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border-strong)] px-4 py-6 text-center">
          <p className="text-sm text-[var(--text-muted)]">
            No guests added yet.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => onChange([emptyGuest()])}
            disabled={disabled}
          >
            Add first guest
          </Button>
        </div>
      ) : (
        <ul className="space-y-2">
          {guests.map((guest, index) => (
            <li
              key={index}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3"
            >
              <div className="flex items-start gap-2">
                <span className="tabular mt-2.5 w-5 shrink-0 text-center text-sm text-[var(--text-muted)]">
                  {index + 1}
                </span>

                <div className="min-w-0 flex-1 space-y-2">
                  <div className="grid gap-2 sm:grid-cols-[1fr_5rem_7rem]">
                    <Field
                      label="Name"
                      placeholder="Full name"
                      value={guest.name}
                      onChange={(event) => update(index, { name: event.target.value })}
                      disabled={disabled}
                    />
                    <Field
                      label="Age"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={129}
                      placeholder="—"
                      value={guest.age ?? ''}
                      onChange={(event) =>
                        update(index, {
                          age: event.target.value === '' ? null : Number(event.target.value),
                        })
                      }
                      disabled={disabled}
                    />
                    <div className="space-y-1.5">
                      <label
                        htmlFor={`guest-gender-${index}`}
                        className="block text-sm font-medium text-[var(--text-secondary)]"
                      >
                        Gender
                      </label>
                      <select
                        id={`guest-gender-${index}`}
                        value={guest.gender ?? ''}
                        onChange={(event) =>
                          update(index, { gender: event.target.value || null })
                        }
                        disabled={disabled}
                        className="input-base"
                      >
                        <option value="">—</option>
                        <option value="MALE">Male</option>
                        <option value="FEMALE">Female</option>
                        <option value="OTHER">Other</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-3">
                    <Field
                      label="ID type"
                      placeholder="Aadhaar, Passport…"
                      value={guest.idProofType ?? ''}
                      onChange={(event) =>
                        update(index, { idProofType: event.target.value || null })
                      }
                      disabled={disabled}
                    />
                    <Field
                      label="ID number"
                      placeholder="Optional"
                      value={guest.idProofNumber ?? ''}
                      onChange={(event) =>
                        update(index, { idProofNumber: event.target.value || null })
                      }
                      disabled={disabled}
                    />
                    <Field
                      label="Phone"
                      type="tel"
                      placeholder="Optional"
                      value={guest.contactNumber ?? ''}
                      onChange={(event) =>
                        update(index, { contactNumber: event.target.value || null })
                      }
                      disabled={disabled}
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => remove(index)}
                  disabled={disabled}
                  aria-label={`Remove guest ${index + 1}`}
                  className={cx(
                    'mt-7 flex size-8 shrink-0 items-center justify-center rounded-lg',
                    'text-[var(--text-muted)] transition-colors',
                    'hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400',
                  )}
                >
                  <Icon name="trash" className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {guests.length > 0 && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onChange([...guests, emptyGuest()])}
          disabled={disabled}
          icon={<Icon name="users" className="size-4" />}
        >
          Add another guest
        </Button>
      )}

      {error && (
        <p role="alert" className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
          <Icon name="alert" className="size-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}
