# Design System

What NestBook looks like, and why. The implementation lives in `src/index.css` (tokens) and
`src/components/ui.tsx` (primitives) — this document explains the reasoning behind them.

---

## Principles

1. **Legible before beautiful.** This is a tool someone uses at a front desk, often in a hurry,
   sometimes on a phone. Dense information must stay scannable.
2. **One accent, used sparingly.** A single brand colour marks what is actionable. When everything
   is coloured, nothing reads as important.
3. **Every colour works in both themes.** Dark mode is a first-class requirement, not an
   afterthought bolted on later.
4. **Status is colour plus text, never colour alone.** Roughly one in twelve men has some form of
   colour blindness; a teal chip and an amber chip can look identical.
5. **Numbers must not jitter.** Dates, money and counts use tabular figures so columns stay aligned
   as values change.

---

## Colour

### Brand — deep teal

```
brand-50  #eefbf7    brand-500 #1fa48a    brand-900 #12463e
brand-100 #d5f5eb    brand-600 #12846f ←  brand-950 #032925
brand-300 #78d8c1    brand-700 #116a5b
```

`brand-600` is the primary action colour; `brand-950` anchors the sidebar and dark panels.

Teal rather than the default SaaS blue: it reads as hospitality rather than fintech, and it
leaves blue free to mean something specific in booking statuses.

### Semantic surfaces

Components never reference a raw colour or branch on the active theme. They use a semantic token,
and the correct value follows automatically:

| Token | Purpose |
|---|---|
| `--surface-page` | Page background |
| `--surface-card` | Cards, inputs, raised panels |
| `--surface-sunken` | Recessed areas: table headers, modal footers |
| `--surface-hover` | Row and button hover |
| `--border-subtle` | Default divider |
| `--border-strong` | Input borders — needs to be visible, not merely present |
| `--text-primary` / `--text-secondary` / `--text-muted` | Three levels of emphasis |
| `--sidebar-*` | The sidebar keeps its own scale, since it is dark in both themes |

Light and dark values are declared on `:root` and `.dark` respectively, so adding a theme means
adding a block of variables rather than touching components.

**Dark mode never uses pure black.** Surfaces bottom out at `#0a0f14`. Pure black against white
text produces halation — the text appears to vibrate — and it removes the ability to show depth
through layering.

### Status colours

| Status | Colour | Why |
|---|---|---|
| Booked | Blue | Future, expected, uneventful |
| Checked in | Brand teal | The active state; matches the primary accent |
| Checked out | Slate | Done, deliberately recessive |
| Cancelled | Red | Ended by exception |
| No-show | Amber | Wrong, but different from cancelled — the distinction is operational |

Always accompanied by the label, never conveyed by colour alone.

---

## Typography

**Inter**, served from `rsms.me/inter`, with a system sans-serif fallback stack.

Chosen for a tall x-height that survives small sizes, and for unambiguous digits — room numbers
and dates are read at a glance. OpenType features `cv02 cv03 cv04 cv11` are enabled for
single-storey letterforms that scan more cleanly at UI sizes.

| Use | Size / weight |
|---|---|
| Page title | 1.5rem / 600 |
| Section heading | 1.125rem / 600 |
| Body | 0.9375rem / 400 |
| Secondary, hints | 0.875rem / 400 |
| Labels, badges | 0.75rem / 500 |
| Hero (landing) | 2.5rem mobile → 3.75rem desktop / 600 |

Headings use `tracking-tight`; at larger sizes default letter-spacing looks loose. The `.tabular`
class applies tabular figures wherever numbers appear in a column.

---

## Shape and depth

```
Inputs, buttons   0.625rem
Cards, panels     1rem      (--radius-card)
Modals            1rem, or top-only on mobile where they slide up as a sheet
Badges, avatars   fully round
```

Depth comes from a `1px` border plus a soft shadow, not from heavy drop shadows:

| Level | Use |
|---|---|
| `--shadow-soft` | Cards at rest |
| `--shadow-lift` | Hover, raised elements |
| `--shadow-pop` | Modals, toasts |

---

## Layout

Mobile-first, with three breakpoints: `sm` 640px, `lg` 1024px, `xl` 1280px.

- **Sidebar** is fixed at `17rem` from `lg` up; below that it becomes a slide-in drawer with a
  backdrop, closing on navigation, on Escape, and on backdrop tap. Page scroll is locked while it
  is open.
- **Page padding** steps `1rem` → `1.5rem` → `2rem`.
- **Tables become cards** below `sm`. A horizontally scrolling table is not usable on a phone.
- **Modals** are centred dialogs on desktop and bottom sheets on mobile, capped at `92dvh` so the
  header stays reachable.

`dvh` rather than `vh` throughout, so mobile browser chrome does not clip the layout.

---

## Motion

Short and purposeful. `--ease-out-soft` (`cubic-bezier(0.22, 1, 0.36, 1)`) decelerates naturally.

| Interaction | Treatment |
|---|---|
| Entry | `fade-up`, 400ms — staggered 60–120ms for lists |
| Hover | 150ms colour |
| Press | `scale(0.98)` |
| Theme icon | 300ms rotate and scale crossfade |
| Drawer | 300ms slide |

All animation is disabled under `prefers-reduced-motion`.

---

## Components

Defined in `src/components/ui.tsx` and `feedback.tsx`.

**Button** — `primary` (brand fill), `secondary` (bordered), `ghost` (text only), `danger` (red),
`inverse` (white, for dark brand panels where the teal primary would disappear). Sizes `sm` 36px,
`md` 44px, `lg` 48px. A built-in `loading` state swaps the icon for a spinner and blocks input.

**Field** — label, input, and a slot for error or hint text. Errors take a red border, an icon,
and `aria-invalid`; hints are muted. Leading and trailing slots hold icons and controls such as
password reveal.

**Avatar** — initials on a colour derived from a hash of the name, so a given person is always the
same colour. Five tones, each defined for both themes.

**Badge** — six tones, optional leading dot, always paired with text.

**Modal** — bottom sheet on mobile, centred dialog on desktop. Closes on Escape and backdrop.
Locks body scroll.

**Toast** — bottom-right on desktop, bottom-centre on mobile. Auto-dismisses after 4.5s. Rendered
in a portal with `aria-live="polite"`.

**Empty, loading and error states** — every list has all three. Empty states say what to do next
rather than showing a blank panel; loading uses skeletons shaped like the content, not a spinner.

---

## Accessibility

- Focus is always visible: a 2px brand outline with 2px offset, never removed.
- Body text meets WCAG AA in both themes; `--text-muted` is reserved for supporting text.
- Icons are `aria-hidden`; icon-only buttons carry an `aria-label`.
- Errors use `role="alert"`, toasts `aria-live="polite"`.
- Touch targets are at least 36px, and 44px for primary actions.
- Interactive elements are real `button` and `a` elements, so keyboard and screen readers work
  without extra handling.

---

## Preventing a flash of the wrong theme

An inline script in `index.html` reads the stored preference and applies `.dark` **before first
paint**. Without it, a dark-mode user sees a white flash on every load, because React has not
mounted yet when the browser paints.

Theme preference is stored in `localStorage`, which can throw in private browsing or with site
data blocked, so every read and write is wrapped in `try`/`catch` and the app renders correctly
without it. The default follows the operating system setting.

---

## Not yet done

A full visual design pass was deliberately deferred until the features exist. This document
describes the system built along the way; expect it to be revisited once the booking screens are
real and there is something substantial to look at.
