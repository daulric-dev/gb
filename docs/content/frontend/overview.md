---
sidebar_label: Overview
---

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
| jsPDF + jspdf-autotable | Client-side PDF generation (class summaries) |
| @react-pdf/renderer | React-based PDF generation (student report cards, exam broadsheets) |
| xlsx (SheetJS 0.20.3) | Client-side Excel/CSV generation (installed from CDN tarball, not npm) |
| web-haptics | Global haptic feedback on all buttons/interactive elements (mobile) |
| react-easy-crop | Client-side image cropping with zoom/rotation (avatar upload) |
| @dnd-kit | Drag-and-drop for sortable lists |
| input-otp | OTP input component |

## Project Structure

```
frontend/
├── app/                           # Pages (App Router)
│   ├── layout.tsx                 # Root layout (fonts, theme, toaster)
│   ├── page.tsx                   # / → public landing page (unauthenticated users)
│   ├── globals.css                # Tailwind v4 entry + design tokens + animations
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
│               │   ├── page.tsx   # Reports list (live grades)
│               │   └── student/
│               │       └── page.tsx # Individual student report (live data + PDF download)
│               └── class-report/
│                   └── page.tsx   # Class summary with exports
├── components/
│   ├── layout/                    # Core layout components
│   │   ├── theme-provider.tsx     # next-themes provider
│   │   ├── mode-toggle.tsx        # Dark/light theme toggle
│   │   ├── app-sidebar.tsx        # Sidebar navigation
│   │   ├── haptics-provider.tsx   # Global haptic feedback listener
│   │   └── header.tsx             # Top navigation bar
│   ├── auth/
│   │   └── auth-page-shell.tsx    # Centered layout for auth pages
│   ├── dashboard/
│   │   ├── dashboard-page-header.tsx  # Page title + description
│   │   ├── back-title-toolbar.tsx     # Back button + title toolbar
│   │   └── avatar-crop-dialog.tsx     # Profile picture crop/resize dialog
│   ├── marketing/
│   │   └── policy-page.tsx        # Reusable policy/legal page component
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
│   ├── api.ts                     # API client with auth, token refresh, and multipart upload
│   ├── auth.ts                    # Token storage (localStorage + cookie)
│   ├── utils.ts                   # cn() utility for class merging
│   ├── use-profile.ts            # Profile fetching hook
│   └── reports/                   # Report-related utilities (barrel-exported via index.ts)
│       ├── index.ts               # Re-exports all report modules
│       ├── api.ts                 # Reporting schema API functions and types
│       ├── calculations.ts        # Calculation endpoint API functions and types
│       ├── pdf.ts                 # PDF generation (individual + term class summary) [jsPDF]
│       ├── year-pdf.ts            # PDF generation (year-based reports) [jsPDF]
│       ├── exam-report-pdf.tsx    # Class exam broadsheet PDF [react-pdf/renderer]
│       ├── student-report-pdf.tsx # Individual student report card PDF [react-pdf/renderer]
│       ├── export.ts              # CSV/XLSX export (term-based class summary)
│       └── year-export.ts         # CSV/XLSX export (year-based class summary)
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
