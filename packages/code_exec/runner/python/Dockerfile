# Runner image for untrusted python code. Contains only the interpreter
# and the entrypoint; all sandboxing flags come from the service's
# `docker run` invocation.
FROM python:3.13-slim

# Unbuffered so partial output survives a timeout kill; HOME on tmpfs
# because the rootfs is read-only at run time.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOME=/tmp

COPY entrypoint.sh /usr/local/bin/runner-entrypoint.sh
RUN chmod 0755 /usr/local/bin/runner-entrypoint.sh

WORKDIR /workspace

ENTRYPOINT ["runner-entrypoint.sh"]
