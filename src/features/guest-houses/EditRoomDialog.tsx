import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Field, Icon, cx } from '../../components/ui'
import { Modal, useToast } from '../../components/feedback'
import { friendlyError } from '../../lib/errors'
import { listRoomTypes } from '../../lib/queries/room-types'
import { updateRoom, type Room } from '../../lib/queries/rooms'

/*
  Rooms are created in batches, but one often differs — a corner room with a
  better rate, or a single that actually sleeps two (§9.2).
*/
export function EditRoomDialog({ room, onClose }: { room: Room | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { notify } = useToast()

  const [roomTypeId, setRoomTypeId] = useState('')
  const [roomNumber, setRoomNumber] = useState('')
  const [rate, setRate] = useState('')
  const [capacity, setCapacity] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const [seededFor, setSeededFor] = useState<string | null>(null)
  if (room && seededFor !== room.id) {
    setSeededFor(room.id)
    setRoomTypeId(room.roomTypeId)
    setRoomNumber(room.roomNumber)
    setRate(String(room.ratePerNight))
    setCapacity(String(room.capacity))
    setErrors({})
  }

  function close() {
    setSeededFor(null)
    onClose()
  }

  const typesQuery = useQuery({
    queryKey: ['room-types'],
    queryFn: listRoomTypes,
    enabled: Boolean(room),
  })

  // A retired type stays selectable if this room already uses it — otherwise
  // editing the rate would silently reassign the room to something else.
  const types = useMemo(() => {
    const all = typesQuery.data ?? []
    return all.filter((type) => type.isActive || type.id === room?.roomTypeId)
  }, [typesQuery.data, room?.roomTypeId])

  const mutation = useMutation({
    mutationFn: () =>
      updateRoom({
        id: room!.id,
        roomTypeId,
        roomNumber,
        rate: Number(rate),
        capacity: Number(capacity),
      }),
    onSuccess: () => {
      if (room) {
        void queryClient.invalidateQueries({ queryKey: ['rooms', room.guestHouseId] })
        void queryClient.invalidateQueries({ queryKey: ['guest-house', room.guestHouseId] })
      }
      notify('Room updated.')
      close()
    },
    onError: (error) => setErrors({ form: friendlyError(error) }),
  })

  function submit() {
    const next: Record<string, string> = {}
    if (!roomTypeId) next.roomTypeId = 'Choose a room type.'
    if (!roomNumber.trim()) next.roomNumber = 'Enter a room number.'
    if (!rate.trim() || Number(rate) < 0 || Number.isNaN(Number(rate)))
      next.rate = 'Enter a valid rate.'
    if (!Number.isInteger(Number(capacity)) || Number(capacity) < 1) next.capacity = 'At least 1.'

    setErrors(next)
    if (Object.keys(next).length > 0) return
    mutation.mutate()
  }

  const busy = mutation.isPending
  const rateChanged = room !== null && Number(rate) !== room.ratePerNight

  return (
    <Modal
      open={Boolean(room)}
      onClose={close}
      title={`Room ${room?.roomNumber ?? ''}`}
      description="Changes apply to this room only."
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Save changes
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

        <div className="space-y-1.5">
          <label
            htmlFor="edit-room-type"
            className="block text-sm font-medium text-[var(--text-secondary)]"
          >
            Room type
          </label>
          <select
            id="edit-room-type"
            value={roomTypeId}
            onChange={(event) => setRoomTypeId(event.target.value)}
            disabled={busy || typesQuery.isLoading}
            aria-invalid={Boolean(errors.roomTypeId)}
            className={cx('input-base', errors.roomTypeId && 'input-error')}
          >
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
                {!type.isActive ? ' (retired)' : ''}
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

        <Field
          label="Room number"
          value={roomNumber}
          onChange={(event) => setRoomNumber(event.target.value)}
          error={errors.roomNumber}
          disabled={busy}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Rate per night"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
            error={errors.rate}
            disabled={busy}
            // Existing bookings keep their own snapshot (§4.5), so this is
            // worth stating plainly rather than leaving someone to wonder.
            hint={rateChanged ? 'Existing bookings keep the rate they were made at.' : undefined}
          />
          <Field
            label="Sleeps"
            type="number"
            inputMode="numeric"
            min={1}
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
            error={errors.capacity}
            disabled={busy}
          />
        </div>
      </div>
    </Modal>
  )
}
