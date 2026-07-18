# F1 — Design System & App Shell

## Purpose
The design system and app shell establishes the visual foundation (design tokens, typography, colors, theme, base UI primitives) and global frame controls (fan/organizer layout role, accessibility controls, animations, and reusable UI states) that serve as the layout basis for all subsequent StadiumIQ modules. 

---

## Token Reference

The following design tokens represent the primary visual variables of the application. They are exported as a JavaScript object from `lib/theme/tokens.ts` and mirrored as CSS custom properties in `:root` within `app/globals.css`.

### Colors

| Token Name | Token Path | Value | Description |
| :--- | :--- | :--- | :--- |
| Accent | `color.accent` | `#2563EB` | FIFA Blue — primary accent |
| Accent Hover | `color.accentHover` | `#1D4ED8` | Hover color for primary action items |
| Canvas | `color.canvas` | `#FAFAFA` | Global background canvas |
| Surface | `color.surface` | `#FFFFFF` | Background for cards and popups |
| Border | `color.border` | `#E5E7EB` | Hairline border lines |
| Text Primary | `color.textPrimary` | `#111827` | Primary body and heading text color |
| Text Secondary | `color.textSecondary` | `#6B7280` | Secondary metadata and label text color |
| Inverse | `color.inverse` | `#FFFFFF` | Text/icon color on accent or dark surfaces |
| Surface Hover | `color.surfaceHover` | `#F9FAFB` | Hover state for surface-backed controls |
| Track | `color.track` | `#EDEFF2` | Segmented-control (RoleToggle) track background |
| Danger Subtle | `color.dangerSubtle` | `#FEF2F2` | Subtle danger background (toast, banners) |
| Heatmap Low | `color.heatmapLow` | `#C0DD97` | Green — Clear crowds / density status |
| Heatmap Med | `color.heatmapMed` | `#FAC775` | Amber — Busy crowds / density status |
| Heatmap High | `color.heatmapHigh` | `#F09595` | Red — Crowded / high density status |
| Success | `color.success` | `#16A34A` | Positive action and completion indicators |
| Warning | `color.warning` | `#D97706` | Warning status notification color |
| Danger | `color.danger` | `#DC2626` | High risk and critical error color |

### Border Radiuses

| Token Name | Token Path | Value | Description |
| :--- | :--- | :--- | :--- |
| Card | `radius.card` | `12px` | Card boundaries |
| Control | `radius.control` | `8px` | Stepper and toolbar buttons |
| Pill | `radius.pill` | `999px` | Fully rounded segment sliders |

### Shadows

| Token Name | Token Path | Value | Description |
| :--- | :--- | :--- | :--- |
| Card | `shadow.card` | `0 1px 3px rgba(17, 24, 39, 0.06), 0 1px 2px rgba(17, 24, 39, 0.04)` | Standard card elevation |
| Elevated | `shadow.elevated` | `0 4px 12px rgba(17, 24, 39, 0.08)` | Modal / popover dialog shadow |

### Spacing

| Token Name | Token Path | Value |
| :--- | :--- | :--- |
| XS | `spacing.xs` | `4px` |
| SM | `spacing.sm` | `8px` |
| MD | `spacing.md` | `16px` |
| LG | `spacing.lg` | `24px` |
| XL | `spacing.xl` | `32px` |
| XXL | `spacing.xxl` | `48px` |

---

## Component List

All components are configured to export clean TypeScript definitions.

| Component Name | File Path | Description | Props |
| :--- | :--- | :--- | :--- |
| `AppShell` | `components/AppShell.tsx` | The root page wrapper containing global header and layout margins | `{ children: React.ReactNode }` |
| `RoleToggle` | `components/RoleToggle.tsx` | Two-segment pill switcher driving role selection with layout animations | (None) |
| `A11yControls` | `components/A11yControls.tsx` | Controls for High Contrast, Font Scaling factor and TTS toggle | (None) |
| `LoadingState` | `components/ui/LoadingState.tsx` | Standardized card loading skeleton | `{ label?: string }` |
| `EmptyState` | `components/ui/EmptyState.tsx` | Standardized placeholder for empty items | `{ title: string; description?: string; icon?: React.ReactNode }` |
| `ErrorState` | `components/ui/ErrorState.tsx` | Standardized placeholder card for errors | `{ title: string; description?: string; onRetry?: () => void }` |

### Base UI primitives (`components/ui/`)

These are shadcn-derived primitives that back the composite components above and are
available for later modules. All are token-styled (no raw palette values).

| Primitive | File Path | Source | Notes |
| :--- | :--- | :--- | :--- |
| `Button` | `components/ui/button.tsx` | shadcn registry | CVA variants |
| `Card` | `components/ui/card.tsx` | shadcn registry | Used by state components |
| `Dialog` | `components/ui/dialog.tsx` | shadcn registry | Provisioned for later modules |
| `Skeleton` | `components/ui/skeleton.tsx` | shadcn registry | Used by `LoadingState` |
| `Switch` | `components/ui/switch.tsx` | shadcn registry | Provisioned for later modules |
| `Tooltip` | `components/ui/tooltip.tsx` | shadcn registry | Provisioned for later modules |
| `Toast` | `components/ui/toast.tsx` | **Hand-authored** (see Known Limitations) | Token-styled toast primitive |

---

## How to Extend

To add a new color or design attribute to the design system:
1. **Define in `lib/theme/tokens.ts`**: Add the token key and literal value to the `tokens` object.
2. **Define CSS custom property in `app/globals.css`**: Map the token to a CSS custom property (e.g. `--color-brand-purple: #...;`) inside `:root`.
3. **Map in `tailwind.config.ts`**: Reference the newly created CSS custom property under the appropriate tailwind key (e.g. colors: `brand: 'var(--color-brand-purple)'`).

> [!WARNING]
> You must define the value in all three files. Failing to configure all three layers will prevent Tailwind classes from resolving correctly at build time.

---

## Known Limitations

- **TTS Toggle is a Stub**: Toggling the TTS state changes the boolean state inside `useA11yStore`, but does not trigger actual voice synthesis. Implementation is deferred to the accessibility sound module (M13).
- **No Dark Mode**: StadiumIQ is permanently light-mode only. Dark-mode settings are intentionally disabled.
- **`toast.tsx` is hand-authored (intentional deviation)**: The current shadcn registry ships toast/notifications via `sonner` rather than a standalone `toast` primitive. To keep the notification surface fully token-styled and dependency-light for F1, `components/ui/toast.tsx` was written by hand (custom `forwardRef` primitives: `Toast`, `ToastProvider`, `ToastViewport`, `ToastTitle`, `ToastDescription`, `ToastAction`, `ToastClose`). It is not generated by the shadcn CLI. No runtime toast dispatcher/hook is wired up in F1; that is deferred to the module that first needs notifications.
