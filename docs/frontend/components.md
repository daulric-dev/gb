# Components

The frontend uses two categories of components: **app-level components** for layout and navigation, and **UI primitives** from shadcn (built on `@base-ui/react`).

## App-Level Components

### Header (`components/header.tsx`)

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

### AuthPageShell (`components/auth-page-shell.tsx`)

A centered full-height container used by login and onboarding pages. Places the theme toggle in the top-right corner and centers its children.

### DashboardPageHeader (`components/dashboard-page-header.tsx`)

A reusable page title component with:
- Title text
- Optional description
- Optional action slot (right-aligned)

### BackTitleToolbar (`components/back-title-toolbar.tsx`)

A toolbar with a back button, title, description, and optional action buttons. Used on the class detail and grading pages.

### ModeToggle (`components/mode-toggle.tsx`)

A ghost button that toggles between light and dark themes using `next-themes`. Displays a Sun or Moon icon based on the current theme.

### ThemeProvider (`components/theme-provider.tsx`)

Re-exports the `ThemeProvider` from `next-themes` with pre-configured settings (attribute-based theming, default system theme).

### AppSidebar (`components/app-sidebar.tsx`)

A sidebar navigation component. **Currently unused** - the dashboard layout uses the Header component instead. Kept for potential future use.

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
