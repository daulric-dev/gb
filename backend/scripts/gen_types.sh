#!/bin/bash

# ============================================
# GGBv2 - Generate Supabase Database Types
# Run from the backend/ directory:
#   chmod +x scripts/gen-types.sh
#   ./scripts/gen-types.sh
# ============================================

# Load .env file
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
else
  echo ".env file not found. Run this from the backend/ directory."
  exit 1
fi

# Check SUPABASE_URL is set
if [ -z "$SUPABASE_URL" ]; then
  echo "SUPABASE_URL is not set in .env"
  exit 1
fi

# Extract project ID from URL
# https://abcdefghijk.supabase.co -> abcdefghijk
PROJECT_ID=$(echo "$SUPABASE_URL" | sed -E 's|https://([^.]+)\.supabase\.co.*|\1|')

if [ -z "$PROJECT_ID" ]; then
  echo "Could not extract project ID from SUPABASE_URL"
  echo "   Expected format: https://your-project-id.supabase.co"
  exit 1
fi

echo "Project ID: $PROJECT_ID"
echo "Generating types..."

# Create types directory if it doesn't exist
mkdir -p src/types

# Generate types for all schemas
supabase gen types typescript \
  --project-id "$PROJECT_ID" \
  --schema public \
  --schema student \
  --schema grading \
  --schema reporting \
  --schema staff \
  > src/types/database.types.ts

if [ $? -eq 0 ]; then
  echo "Types generated: src/types/database.types.ts"
  echo ""
  echo "   Schemas included:"
  echo "     - public (school, user_profile, academic_year, student_group, term, subject)"
  echo "     - student (student, enrollment, subject_profile, parent_link)"
  echo "     - grading (assessment, grade)"
  echo "     - reporting (report_book, report_book_entry)"
  echo "     - staff (teacher_group_assignment, teacher_subject_assignment)"
  echo ""
  echo "   Import in your code:"
  echo "     import { Database } from '../types/database.types';"
else
  echo "Failed to generate types."
  echo ""
  echo "   Make sure you're logged in:"
  echo "     supabase login"
  echo ""
  echo "   Or generate with the service role key directly:"
  echo "     supabase gen types typescript \\"
  echo "       --project-id $PROJECT_ID \\"
  echo "       --schema public --schema student --schema grading \\"
  echo "       --schema reporting --schema staff \\"
  echo "       > src/types/database.types.ts"
fi