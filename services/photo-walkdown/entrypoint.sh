#!/bin/sh
# Hosts such as Railway mount the volume root-owned, which the unprivileged
# app user cannot write to. Fix ownership of the data directory, then drop to
# that user before running anything of ours.
set -e
chown walkdown /data
exec setpriv --reuid=walkdown --regid=walkdown --init-groups "$@"
