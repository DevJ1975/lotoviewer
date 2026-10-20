#!/bin/sh
# Volumes are often mounted root-owned, which the unprivileged app user cannot
# write to. Fix ownership of the data directory, then drop to that user.
set -e
chown studio /data
exec setpriv --reuid=studio --regid=studio --init-groups "$@"
