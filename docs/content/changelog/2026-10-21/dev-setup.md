---
sidebar_label: 2026-10-21 · Local setup, demo data, mobile SDK
sidebar_position: 4
---

# 2026-10-21 - Local setup, demo data, mobile SDK alignment

## `bun run preload` uses the dev compose file

`preload` / `postload` ran `infrastructure/docker-compose.yml`, the deployment stack, which needs `infrastructure/.env` with `REDIS_PASSWORD` and does not publish Redis to the host - so every fresh checkout failed with "required variable REDIS_PASSWORD is missing". They now run `docker-compose.dev.yml`: Redis on `127.0.0.1:6379`, no password, matching `backend/.env.example`. The deployment compose file is unchanged.

## Demo data

`backend/scripts/seed-demo.ts` builds a school for trying the LMS, creating course content through the real API:

```bash
cd backend
bun run seed:demo            # Riverside Academy (refuses if it exists)
bun run seed:demo --fresh    # replace it
bun run seed:demo otp <email>  # print a sign-in code; local mail is capped at 2/hour
```

Accounts: `admin@`, `teacher@`, `teacher2@`, `ta@`, `student@`, `student2@`, `student3@demo.test`. Four courses (a full Biology tour, a points-based Algebra, a draft, an archived one), submissions, a quiz attempt, marks, three past attendance sessions, and verified email domains `students.demo.test` / `staff.demo.test`.

The scripts now treat `API_URL` as the API origin (as `.env.example` documents) and add `/api` themselves.

## Mobile SDK alignment

`mobile/package.json` pinned `expo-router` and `expo-system-ui` to SDK 58 while everything else is SDK 57 / React Native 0.86. `expo-router` 58 pulls `@expo/metro-runtime` 58, which imports `react-native/unstable-internals-do-not-use` and failed iOS bundling. `expo install --fix` brought every Expo package back to SDK 57.
