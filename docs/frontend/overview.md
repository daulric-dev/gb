# Frontend Overview

The frontend is a **Next.js 16** application using the **App Router**. It provides the user interface for the GradeBook system - authentication, school management, student enrollment, grading, and class summaries.

## Tech Stack

| Technology | Purpose |
|------------|---------|
| Next.js 16 | React framework with App Router |
| React 19 | UI library |
| TypeScript 5 | Type safety |
| Tailwind CSS 4 | Utility-first styling (CSS-first config, no `tailwind.config.js`) |
| @preact/signals-react | Reactive state management (replaces `useState`) |
| @base-ui/react | Headless UI primitives (shadcn components) |
| sonner | Toast notifications |
| lucide-react | Icons |
| next-themes | Dark/light mode |
| jsPDF + jspdf-autotable | Client-side PDF generation |
| xlsx (SheetJS) | Client-side Excel/CSV generation |
| @dnd-kit | Drag-and-drop for sortable lists |
| input-otp | OTP input component |

## Project Structure

```
frontend/
├── app/                           # Pages (App Router)
│   ├── layout.tsx                 # Root layout (fonts, theme, toaster)
│   ├── page.tsx                   # / → redirects to /dashboard
│   ├── globals.css                # Tailwind v4 entry + design tokens
│   ├── login/
│   │   ├── page.tsx               # Email input for OTP
│   │   └── verify/
│   │       └── page.tsx           # OTP code verification
│   ├── onboard/
│   │   └── page.tsx               # First-time user setup
│   └── dashboard/
│       ├── layout.tsx             # Dashboard shell (header + main)
│       ├── page.tsx               # Dashboard home
│       ├── academic-years/
│       │   └── page.tsx           # Academic year management
│       ├── terms/
│       │   └── page.tsx           # Term management
│       ├── students/
│       │   └── page.tsx           # Student records
│       ├── subjects/
│       │   └── page.tsx           # Subject catalog
│       └── classes/
│           ├── page.tsx           # Class listing
│           └── [classId]/
│               ├── page.tsx       # Class detail (teachers, students, summary)
│               ├── grading/
│               │   └── page.tsx   # Grading sheet
│               ├── reports/
│               │   ├── page.tsx   # Reports list (live grades + persisted status)
│               │   └── [reportId]/
│               │       └── page.tsx # Individual report detail
│               └── class-report/
│                   └── page.tsx   # Class summary with exports
├── components/
│   ├── header.tsx                 # Top navigation bar
│   ├── auth-page-shell.tsx        # Centered layout for auth pages
│   ├── mode-toggle.tsx            # Dark/light theme toggle
│   ├── theme-provider.tsx         # next-themes provider
│   ├── dashboard-page-header.tsx  # Page title + description component
│   ├── back-title-toolbar.tsx     # Back button + title toolbar
│   ├── app-sidebar.tsx            # Sidebar (currently unused)
│   └── ui/                        # shadcn/base-ui primitives
│       ├── button.tsx
│       ├── card.tsx
│       ├── badge.tsx
│       ├── dialog.tsx
│       ├── dropdown-menu.tsx
│       ├── table.tsx
│       ├── input.tsx
│       ├── label.tsx
│       ├── avatar.tsx
│       ├── input-otp.tsx
│       ├── separator.tsx
│       ├── sheet.tsx
│       ├── sidebar.tsx
│       ├── skeleton.tsx
│       ├── sonner.tsx
│       └── tooltip.tsx
├── lib/
│   ├── api.ts                     # API client with auth and token refresh
│   ├── auth.ts                    # Token storage (localStorage + cookie)
│   ├── utils.ts                   # cn() utility for class merging
│   ├── use-profile.ts            # Profile fetching hook
│   ├── reports.ts                 # Reporting schema API functions and types
│   ├── reports.types.ts           # Shared report type definitions
│   ├── year-report.ts             # Calculation endpoint API functions and types
│   ├── report-pdf.ts              # PDF generation (individual + term class summary)
│   ├── report-year-pdf.ts         # PDF generation (year-based reports)
│   ├── report-export.ts           # CSV/XLSX export (term-based class summary)
│   └── report-year-export.ts      # CSV/XLSX export (year-based class summary)
├── hooks/
│   └── use-mobile.ts             # Mobile breakpoint detection
├── proxy.ts                       # Route protection (auth gating)
├── next.config.ts                 # Next.js config (React Compiler enabled)
├── postcss.config.mjs            # Tailwind v4 PostCSS plugin
├── eslint.config.mjs             # ESLint config
├── tsconfig.json                  # TypeScript config
├── components.json                # shadcn configuration
└── package.json                   # Dependencies and scripts
```

## State Management

The app uses **@preact/signals-react** instead of `useState` for reactive state. Key patterns:

```typescript
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";

function MyComponent() {
  useSignals();  // Required at top of component
  const count = useSignal(0);

  // Direct mutation (no setter function needed)
  count.value = 5;

  // Read value
  return <div>{count.value}</div>;
}
```

Benefits over `useState`:
- No need for setter functions - mutate `.value` directly
- Fine-grained reactivity - only re-renders what actually reads the signal
- Works well with React Compiler (enabled in `next.config.ts`)

## Styling

The app uses **Tailwind CSS v4** with the CSS-first configuration approach:
- No `tailwind.config.js` - all config lives in `app/globals.css`
- Uses OKLCH color variables for dark/light mode
- Custom `fade-in-up` animation utilities for page transitions
- `tw-animate-css` for additional animation presets

## Route Protection

`proxy.ts` handles authentication gating at the routing level:

| Route Pattern | Unauthenticated | Authenticated |
|---------------|-----------------|---------------|
| `/dashboard/*` | → Redirect to `/login` | Allow |
| `/onboard/*` | → Redirect to `/login` | Allow |
| `/login` | Allow | → Redirect to `/dashboard` |
| `/login/verify` | Allow | → Redirect to `/dashboard` |

Authentication is determined by the `gb_logged_in` cookie (set when tokens are stored).

## Running the Frontend

```bash
cd frontend
bun install
bun run dev          # Development server (port 3000)
bun run build        # Production build
bun run start        # Production server
bun run lint         # ESLint check
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_API_URL` | No | Backend API base URL (defaults to `http://localhost:3001`) |
