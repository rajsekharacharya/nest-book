import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Field, Icon, cx } from '../../components/ui'
import { Modal, useToast } from '../../components/feedback'
import { friendlyError } from '../../lib/errors'
import { parseRoomNumbers } from '../../lib/room-numbers'
import { listRoomTypes } from '../../lib/queries/room-types'
import { createRoomsBulk } from '../../lib/queries/rooms'

/*
  The primary way rooms are configured (ARCHITECTURE.md §9.2): a guest house
  usually has several identical rooms of one type, so the operator sets type,
  rate and capacity once and supplies the numbers as a list or range.

  Everything is previewed before saving. Discovering a clash after submitting —
  one number at a time — is the failure mode this screen exists to avoid.
*/
export function BulkAddRoomsDialog({
  open,
  guestHouseId,
  existingNumbers,
  remainingSlots,
  onClose,
}: {
  open: boolean
  guestHouseId: string
  existingNumbers: string[]
  remainingSlots: number
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { notify } = useToast()

  const [roomTypeId, setRoomTypeId] = useState('')
  const [rate, setRate] = useState('')
  const [capacity, setCapacity] = useState('2')
  const [numbersInput, setNumbersInput] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const [seeded, setSeeded] = useState(false)
  if (open && !seeded) {
    setSeeded(true)
    setRoomTypeId('')
    setRate('')
    setCapacity('2')
    setNumbersInput('')
    setErrors({})
  }

  function close() {
    setSeeded(false)
    onClose()
  }

  const typesQuery = useQuery({
    queryKey: ['room-types'],
    queryFn: listRoomTypes,
    enabled: open,
  })

  const activeTypes = useMemo(
    () => (typesQuery.data ?? []).filter((type) => type.isActive),
    [typesQuery.data],
  )

  const parsed = useMemo(() => parseRoomNumbers(numbersInput), [numbersInput])

  // Clashes are found against the rooms already loaded, so the operator sees
  // them while typing. The server checks again — that is the authority.
  const clashes = useMemo(() => {
    const existing = new Set(existingNumbers)
    return parsed.numbers.filter((number) => existing.has(number))
  }, [parsed.numbers, existingNumbers])

  const valid = parsed.numbers.filter((number) => !clashes.includes(number))
  const overCap = valid.length > remainingSlots

  const mutation = useMutation({
    mutationFn: () =>
      createRoomsBulk({
        guestHouseId,
        roomTypeId,
        roomNumbers: valid,
        rate: Number(rate),
        capacity: Number(capacity),
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['rooms', guestHouseId] })
      void queryClient.invalidateQueries({ queryKey: ['guest-house', guestHouseId] })
      void queryClient.invalidateQueries({ queryKey: ['guest-houses'] })
      notify(`${result.created} room${result.created === 1 ? '' : 's'} added.`)
      close()
    },
    onError: (error) => setErrors({ form: friendlyError(error) }),
  })

  function submit() {
    const next: Record<string, string> = {}
    if (!roomTypeId) next.roomTypeId = 'Choose a room type.'
    if (!rate.trim()) next.rate = 'Set the nightly rate.'
    else if (Number(rate) < 0 || Number.isNaN(Number(rate))) next.rate = 'Enter a valid rate.'
    if (!Number.isInteger(Number(capacity)) || Number(capacity) < 1)
      next.capacity = 'At least 1.'
    if (valid.length === 0) next.numbers = 'Enter at least one new room number.'

    setErrors(next)
    if (Object.keys(next).length > 0 || overCap) return
    mutation.mutate()
  }

  const busy = mutation.isPending

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add rooms"
      description={`${remainingSlots} room${remainingSlots === 1 ? '' : 's'} left to configure.`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={valid.length === 0 || overCap}>
            {valid.length > 0 ? `Add ${valid.length} room${valid.length === 1 ? '' : 's'}` : 'Add rooms'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {errors.form && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
          >
            <Icon name="alert" className="mt-px size-4 shrink-0" />
            <span>{errors.form}</span>
          </div>
        )}

        {activeTypes.length === 0 && !typesQuery.isLoading ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
            No room types exist yet. Create one first — every room belongs to a type.
          </div>
        ) : (
          <div className="space-y-1.5">
            <label
              htmlFor="bulk-room-type"
              className="block text-sm font-medium text-[var(--text-secondary)]"
            >
              Room type
            </label>
            <select
              id="bulk-room-type"
              value={roomTypeId}
              onChange={(event) => setRoomTypeId(event.target.value)}
              disabled={busy || typesQuery.isLoading}
              aria-invalid={Boolean(errors.roomTypeId)}
              className={cx('input-base', errors.roomTypeId && 'input-error')}
            >
              <option value="">Choose a type…</option>
              {activeTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
            {errors.roomTypeId && (
              <p className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
                <Icon name="alert" className="size-3.5 shrink-0" />
                {errors.roomTypeId}
              </p>
            )}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Rate per night"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            placeholder="1200"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
            error={errors.rate}
            disabled={busy}
            hint={errors.rate ? undefined : 'Applies to every room in this batch.'}
          />
          <Field
            label="Sleeps"
            type="number"
            inputMode="numeric"
            min={1}
            placeholder="2"
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
            error={errors.capacity}
            disabled={busy}
            hint={errors.capacity ? undefined : 'Maximum guests per room.'}
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="bulk-numbers"
            className="block text-sm font-medium text-[var(--text-secondary)]"
          >
            Room numbers
          </label>
          <textarea
            id="bulk-numbers"
            rows={2}
            placeholder="101, 102, 103-105"
            value={numbersInput}
            onChange={(event) => setNumbersInput(event.target.value)}
            disabled={busy}
            aria-invalid={Boolean(errors.numbers)}
            aria-describedby="bulk-numbers-hint"
            className={cx('input-base h-auto resize-y py-2.5 font-mono', errors.numbers && 'input-error')}
          />
          <p id="bulk-numbers-hint" className="text-sm text-[var(--text-muted)]">
            Separate with commas. Use a dash for a range — <span className="font-mono">103-105</span>{' '}
            makes three rooms. Names like <span className="font-mono">G-2</span> work too.
          </p>
          {errors.numbers && (
            <p className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
              <Icon name="alert" className="size-3.5 shrink-0" />
              {errors.numbers}
            </p>
          )}
        </div>

        {/* Preview: what will actually be created, before committing to it. */}
        {(parsed.numbers.length > 0 || parsed.errors.length > 0) && (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium">
                {valid.length > 0
                  ? `Will create ${valid.length} room${valid.length === 1 ? '' : 's'}`
                  : 'Nothing to create'}
              </h3>
              {valid.length > 0 && (
                <p className="tabular text-sm text-[var(--text-muted)]">
                  {existingNumbers.length + valid.length} of{' '}
                  {existingNumbers.length + remainingSlots} configured
                </p>
              )}
            </div>

            {valid.length > 0 && (
              <ul className="mt-2.5 flex flex-wrap gap-1.5">
                {valid.map((number) => (
                  <li
                    key={number}
                    className="tabular rounded-md bg-[var(--surface-card)] px-2 py-1 text-xs font-medium ring-1 ring-[var(--border-subtle)] ring-inset"
                  >
                    {number}
                  </li>
                ))}
              </ul>
            )}

            {clashes.length > 0 && (
              <p className="mt-3 flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400">
                <Icon name="alert" className="mt-px size-3.5 shrink-0" />
                <span>
                  Already in this guest house, so they will be skipped:{' '}
                  <span className="tabular font-medium">{clashes.join(', ')}</span>
                </span>
              </p>
            )}

            {parsed.duplicates.length > 0 && (
              <p className="mt-2 flex items-start gap-1.5 text-sm text-[var(--text-muted)]">
                <Icon name="alert" className="mt-px size-3.5 shrink-0" />
                <span>
                  Typed more than once, counted once:{' '}
                  <span className="tabular">{parsed.duplicates.join(', ')}</span>
                </span>
              </p>
            )}

            {parsed.errors.map((message) => (
              <p
                key={message}
                className="mt-2 flex items-start gap-1.5 text-sm text-red-600 dark:text-red-400"
              >
                <Icon name="alert" className="mt-px size-3.5 shrink-0" />
                {message}
              </p>
            ))}

            {overCap && (
              <p
                role="alert"
                className="mt-3 flex items-start gap-1.5 text-sm font-medium text-red-600 dark:text-red-400"
              >
                <Icon name="alert" className="mt-px size-3.5 shrink-0" />
                <span>
                  That is {valid.length - remainingSlots} more than this guest house declares.
                  Raise its total rooms, or shorten the list.
                </span>
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
