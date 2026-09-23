import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, Field, Icon, cx } from '../../components/ui'
import { Modal, useToast } from '../../components/feedback'
import { friendlyError } from '../../lib/errors'
import {
  createGuestHouse,
  removeGuestHouseImage,
  updateGuestHouse,
  uploadGuestHouseImage,
  type GuestHouse,
} from '../../lib/queries/guest-houses'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const ACCEPTED = 'image/jpeg,image/png,image/webp,image/avif'

export function GuestHouseDialog({
  open,
  house,
  onClose,
}: {
  open: boolean
  house: GuestHouse | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { notify } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [totalRooms, setTotalRooms] = useState('')
  const [locationUrl, setLocationUrl] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Image state: the path already saved, a newly chosen file, and a local
  // preview. Kept apart so cancelling cannot orphan an upload.
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [removeExisting, setRemoveExisting] = useState(false)

  const key = house?.id ?? '__new__'
  const [seededFor, setSeededFor] = useState<string | null>(null)
  if (open && seededFor !== key) {
    setSeededFor(key)
    setName(house?.name ?? '')
    setAddress(house?.address ?? '')
    setTotalRooms(house ? String(house.totalRooms) : '')
    setLocationUrl(house?.googleLocationUrl ?? '')
    setContactName(house?.contactPersonName ?? '')
    setContactPhone(house?.contactPersonPhone ?? '')
    setSavedPath(house?.imagePath ?? null)
    setPreview(house?.imageUrl ?? null)
    setPendingFile(null)
    setRemoveExisting(false)
    setErrors({})
  }

  function close() {
    if (preview && pendingFile) URL.revokeObjectURL(preview)
    setSeededFor(null)
    onClose()
  }

  function chooseFile(file: File | undefined) {
    if (!file) return

    // Mirrors the bucket's own limits so the operator hears about it here
    // rather than after a failed upload. The bucket is the real control.
    if (!ACCEPTED.split(',').includes(file.type)) {
      setErrors((e) => ({ ...e, image: 'Choose a JPEG, PNG, WebP or AVIF image.' }))
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setErrors((e) => ({ ...e, image: 'That image is over 5 MB. Choose a smaller one.' }))
      return
    }

    if (preview && pendingFile) URL.revokeObjectURL(preview)
    setPendingFile(file)
    setPreview(URL.createObjectURL(file))
    setRemoveExisting(false)
    setErrors((e) => ({ ...e, image: '' }))
  }

  function clearImage() {
    if (preview && pendingFile) URL.revokeObjectURL(preview)
    setPendingFile(null)
    setPreview(null)
    setRemoveExisting(Boolean(savedPath))
    if (fileRef.current) fileRef.current.value = ''
  }

  const mutation = useMutation({
    mutationFn: async () => {
      // Upload first: if it fails, nothing has been written, and the operator
      // still has everything they typed.
      let imagePath: string | null | undefined
      if (pendingFile) imagePath = await uploadGuestHouseImage(pendingFile)
      else if (removeExisting) imagePath = null

      const input = {
        name,
        address,
        totalRooms: Number(totalRooms),
        googleLocationUrl: locationUrl,
        contactPersonName: contactName,
        contactPersonPhone: contactPhone,
        ...(imagePath !== undefined ? { imagePath } : {}),
      }

      if (house) await updateGuestHouse(house.id, input)
      else await createGuestHouse(input)

      // Only once the row points elsewhere. Deleting first would leave a broken
      // image if the save then failed.
      if (savedPath && imagePath !== undefined && savedPath !== imagePath) {
        await removeGuestHouseImage(savedPath)
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['guest-houses'] })
      if (house) void queryClient.invalidateQueries({ queryKey: ['guest-house', house.id] })
      notify(house ? 'Guest house updated.' : 'Guest house added.')
      close()
    },
    onError: (error) => setErrors({ form: friendlyError(error) }),
  })

  function submit() {
    const next: Record<string, string> = {}
    if (!name.trim()) next.name = 'Give the guest house a name.'
    if (!address.trim()) next.address = 'Enter the address.'

    const rooms = Number(totalRooms)
    if (!totalRooms.trim()) next.totalRooms = 'How many rooms does it have?'
    else if (!Number.isInteger(rooms) || rooms < 1) next.totalRooms = 'Enter a whole number, at least 1.'
    else if (house && rooms < house.roomCount)
      next.totalRooms = `${house.roomCount} rooms are already configured. Remove some first.`

    if (!contactName.trim()) next.contactName = 'Who should guests contact?'
    if (!contactPhone.trim()) next.contactPhone = 'Enter a contact number.'

    if (locationUrl.trim() && !/^https?:\/\//i.test(locationUrl.trim()))
      next.locationUrl = 'Paste the full link, starting with https://'

    setErrors(next)
    if (Object.keys(next).length > 0) return
    mutation.mutate()
  }

  const busy = mutation.isPending

  return (
    <Modal
      open={open}
      onClose={close}
      title={house ? 'Edit guest house' : 'Add a guest house'}
      description={
        house
          ? undefined
          : 'The property itself. Rooms are configured afterwards, in batches.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            {house ? 'Save changes' : 'Add guest house'}
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

        {/* Photo ------------------------------------------------------------ */}
        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-[var(--text-secondary)]">Photo</span>

          {preview ? (
            <div className="relative overflow-hidden rounded-xl border border-[var(--border-subtle)]">
              <img src={preview} alt="" className="aspect-[16/9] w-full object-cover" />
              <div className="absolute top-2 right-2 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  className="rounded-lg bg-slate-900/70 px-2.5 py-1.5 text-xs font-medium text-white backdrop-blur transition-colors hover:bg-slate-900/85"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={clearImage}
                  disabled={busy}
                  aria-label="Remove photo"
                  className="flex size-7 items-center justify-center rounded-lg bg-slate-900/70 text-white backdrop-blur transition-colors hover:bg-red-600"
                >
                  <Icon name="close" className="size-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className={cx(
                'flex aspect-[16/9] w-full flex-col items-center justify-center gap-2 rounded-xl',
                'border-2 border-dashed border-[var(--border-strong)] text-[var(--text-muted)]',
                'transition-colors hover:border-brand-500 hover:bg-[var(--surface-hover)] hover:text-brand-600',
              )}
            >
              <Icon name="building" className="size-7" />
              <span className="text-sm font-medium">Add a photo</span>
              <span className="text-xs">JPEG, PNG or WebP · up to 5 MB</span>
            </button>
          )}

          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED}
            className="hidden"
            onChange={(event) => chooseFile(event.target.files?.[0])}
          />

          {errors.image ? (
            <p className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
              <Icon name="alert" className="size-3.5 shrink-0" />
              {errors.image}
            </p>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">
              Optional. Shown in the list and on the guest's booking link.
            </p>
          )}
        </div>

        <Field
          label="Name"
          autoFocus
          placeholder="Hillview Guest House"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={errors.name}
          disabled={busy}
        />

        <div className="space-y-1.5">
          <label
            htmlFor="gh-address"
            className="block text-sm font-medium text-[var(--text-secondary)]"
          >
            Address
          </label>
          <textarea
            id="gh-address"
            rows={2}
            placeholder="14 Ridge Road, Shillong, Meghalaya 793001"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            disabled={busy}
            aria-invalid={Boolean(errors.address)}
            className={cx('input-base h-auto resize-y py-2.5', errors.address && 'input-error')}
          />
          {errors.address && (
            <p className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
              <Icon name="alert" className="size-3.5 shrink-0" />
              {errors.address}
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Total rooms"
            type="number"
            inputMode="numeric"
            min={1}
            placeholder="12"
            value={totalRooms}
            onChange={(event) => setTotalRooms(event.target.value)}
            error={errors.totalRooms}
            disabled={busy}
            hint={house ? undefined : 'The cap on how many rooms you can configure.'}
          />
          <Field
            label="Contact number"
            type="tel"
            placeholder="+91 98765 43210"
            value={contactPhone}
            onChange={(event) => setContactPhone(event.target.value)}
            error={errors.contactPhone}
            disabled={busy}
          />
        </div>

        <Field
          label="Contact person"
          placeholder="Anita Rao"
          value={contactName}
          onChange={(event) => setContactName(event.target.value)}
          error={errors.contactName}
          disabled={busy}
        />

        <Field
          label="Google Maps link"
          type="url"
          placeholder="https://maps.google.com/..."
          value={locationUrl}
          onChange={(event) => setLocationUrl(event.target.value)}
          error={errors.locationUrl}
          disabled={busy}
          hint={errors.locationUrl ? undefined : 'Optional — helps guests find the property.'}
        />
      </div>
    </Modal>
  )
}
