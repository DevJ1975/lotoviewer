#!/bin/sh
# Creates every storage bucket the application uses in the S3-compatible store.
# Uses the real AWS CLI, so this exercises the same client calls the AWS
# deployment will make. Safe to re-run: existing buckets are left alone.
#
# The list is the union of buckets the code reads and buckets the migrations
# insert. loto-photos, policy-uploads and fleet-docs are not created by any
# migration, so on Supabase they were made by hand in the dashboard.
set -eu

for bucket in \
  chat-attachments chemical-sds equipment-evidence fleet-docs loto-photos \
  module-manuals policy-uploads profile-pictures safety-board-attachments \
  strike-media tenant-logos
do
  if aws s3api head-bucket --bucket "$bucket" >/dev/null 2>&1; then
    echo "exists  $bucket"
  else
    aws s3api create-bucket --bucket "$bucket" >/dev/null
    echo "created $bucket"
  fi
done
