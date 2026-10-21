#!/bin/bash

# ============================================
# gb - Generate Supabase Database Types
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
  --schema file_manager \
  --schema chat \
  --schema course \
  > src/types/database.types.ts

if [ $? -eq 0 ]; then
  echo "Types generated: src/types/database.types.ts"
  echo ""
  echo "   Schemas included:"
  echo "     - public (school, user_profile, academic_year, term, announcement)"
  echo "     - student (student, parent_link)"
  echo "     - grading (activity, submission, quiz_*, grade_scale)"
  echo "     - course (course, course_staff, course_student, module, module_item, page, assignment_group)"
  echo "     - reporting, staff (legacy, read-only until the cleanup migration)"
  echo "     - file_manager (file, file_share)"
  echo "     - chat (conversation, conversation_member, message)"
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
  echo "       --schema reporting --schema staff --schema file_manager --schema chat --schema course \\"
  echo "       > src/types/database.types.ts"
fi