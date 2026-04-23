# Components

The frontend uses two categories of components: **app-level components** organized into logical subdirectories, and **UI primitives** from shadcn (built on `@base-ui/react`).

## App-Level Components

Components are grouped by their domain:

```
components/
├── layout/          # Core layout and navigation
├── auth/            # Authentication page wrappers
├── dashboard/       # Dashboard-specific utilities
├── marketing/       # Public-facing / legal pages
└── ui/              # shadcn primitives
```

### Layout (`components/layout/`)

#### Header (`layout/header.tsx`)

The main navigation bar displayed at the top of every dashboard page.

**Features:**
- Logo + "GradeBook" brand text
- Desktop navigation links (Dashboard, Academic Years, Classes, Students, Subjects, Terms)
- Mobile hamburger menu using `Sheet` component (slides in from the left)
- Theme toggle (dark/light mode)
- User dropdown menu:
  - Avatar with user initials
  - User name and school name
  - Logout button

**Props:** Receives the user profile from the dashboard layout.

#### ModeToggle (`layout/mode-toggle.tsx`)

A ghost button that toggles between light and dark themes using `next-themes`. Displays a Sun or Moon icon based on the current theme.

#### ThemeProvider (`layout/theme-provider.tsx`)

Re-exports the `ThemeProvider` from `next-themes` with pre-configured settings (attribute-based theming, default system theme).

#### AppSidebar (`layout/app-sidebar.tsx`)

A sidebar navigation component with:
- Logo + "GradeBook" branding with "by daulric.dev" subtitle
- School name display with inline change-school dialog trigger
- Navigation links (Dashboard, Academic Years, Classes, Students, Subjects, Terms)
- Legal links (Terms of Service, Privacy Policy)
- User dropdown with settings and logout
- Collapsible icon mode

Includes an embedded `ChangeSchoolDialog` component that opens a modal with a searchable list of schools. The dialog trigger uses Base UI's `DialogTrigger` with a `<span>` child (not a `<button>`) to avoid nested button hydration errors.

#### HapticsProvider (`layout/haptics-provider.tsx`)

A global haptic feedback component mounted in the root layout. Attaches a single document-level click listener that triggers a `"nudge"` vibration via `web-haptics` whenever the user taps:

- `<button>` elements
- Elements with `role="button"`
- `<a>` links
- `input[type="submit"]` elements

To opt out a specific element, add the `data-no-haptic` attribute. On devices without vibration support, calls are silently ignored.

### Auth (`components/auth/`)

#### AuthPageShell (`auth/auth-page-shell.tsx`)

A centered full-height container used by login and onboarding pages. Places the theme toggle in the top-right corner and centers its children.

### Dashboard (`components/dashboard/`)

#### DashboardPageHeader (`dashboard/dashboard-page-header.tsx`)

A reusable page title component with:
- Title text
- Optional description
- Optional action slot (right-aligned)

#### BackTitleToolbar (`dashboard/back-title-toolbar.tsx`)

A toolbar with a back button, title, description, and optional action buttons. Used on the class detail and grading pages.

### Marketing (`components/marketing/`)

#### PolicyPage (`marketing/policy-page.tsx`)

A reusable page component for legal/policy pages (Terms of Service, Privacy Policy). Accepts structured `PolicyData` with sections, lists, and cross-links.

## UI Primitives (`components/ui/`)

These are shadcn-style components built on `@base-ui/react` headless primitives with Tailwind styling.

### Button (`ui/button.tsx`)

Styled button with variants and sizes via `class-variance-authority`:

**Variants:** `default`, `destructive`, `outline`, `secondary`, `ghost`, `link`  
**Sizes:** `default`, `sm`, `lg`, `icon`

### Card (`ui/card.tsx`)

Card container with sub-components: `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`, `CardAction`.

### Badge (`ui/badge.tsx`)

Small label component with variants: `default`, `secondary`, `destructive`, `outline`.

### Dialog (`ui/dialog.tsx`)

Modal dialog with overlay, content, header, title, description, footer, and close button.

### DropdownMenu (`ui/dropdown-menu.tsx`)

Full dropdown menu system with items, sub-menus, checkbox items, radio items, and separators.

### Table (`ui/table.tsx`)

Scrollable table with semantic elements: `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`, `TableFooter`, `TableCaption`.

### Input (`ui/input.tsx`)

Styled text input with consistent border, focus, and disabled states.

### Label (`ui/label.tsx`)

Form label component.

### Avatar (`ui/avatar.tsx`)

User avatar with image support, fallback text (initials), and optional status badge.

### InputOTP (`ui/input-otp.tsx`)

OTP code input built on the `input-otp` package. Used on the login verification page.

### Separator (`ui/separator.tsx`)

Horizontal or vertical divider line.

### Sheet (`ui/sheet.tsx`)

Side panel that slides in from the edge of the screen. Used for the mobile navigation menu.

### Sidebar (`ui/sidebar.tsx`)

Full sidebar navigation system with provider, trigger, content, menu items, and mobile support. Currently not used in the active layout.

### Skeleton (`ui/skeleton.tsx`)

Pulsing placeholder block for loading states.

### Sonner (`ui/sonner.tsx`)

Toast notification container using the `sonner` library. Configured with theme-aware styling and Lucide icons for success/info/warning/error states.

### Tooltip (`ui/tooltip.tsx`)

Tooltip with trigger, content, and arrow.
