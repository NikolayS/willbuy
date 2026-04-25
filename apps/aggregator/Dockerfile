# syntax=docker/dockerfile:1.7
# willbuy.dev aggregator image — Python 3.12 + pinned scientific stack.
# Determinism (spec §17) is guaranteed only across byte-identical copies of
# this image digest; bumping ANY pinned version (here, in pyproject.toml, or
# in the base image) requires a new image digest and a re-validation of the
# clustering reproducibility test.
#
# Multi-stage:
#   1) builder: install pinned deps into a venv, pre-download fastembed weights.
#   2) runtime: copy venv + weights into a slim base, drop privileges to UID 1001.

# Pin base image by digest. python:3.12.4-slim-bookworm at the time of writing.
# Using a tag is fine for the source build; we cosign-sign the resulting image
# (spec §5.16 covers capture-container provenance; the aggregator inherits the
# same posture).
FROM python:3.12.4-slim-bookworm AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# build-essential needed for hdbscan==0.8.33 (cython compile path) on slim.
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy ONLY the dependency manifest first so Docker caches the heavy install.
COPY apps/aggregator/pyproject.toml ./pyproject.toml

# Create the venv we will copy into the runtime stage.
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# The pyproject.toml pins every version; --no-deps would skip transitive pins,
# so we install with deps but rely on the resolver to honour our pins.
# We also write a tiny fake README so that pip's PEP 517 backend doesn't error
# out when the package has no source under /build/src yet.
COPY apps/aggregator/src ./src
# Non-editable install so the `aggregator` package lives under venv
# site-packages and is importable when we copy /opt/venv into the runtime
# stage.
RUN pip install --upgrade pip==24.0 \
 && pip install .[dev]

# Pre-download fastembed weights at build time so runtime works offline.
# fastembed caches under ~/.cache/fastembed by default; we redirect it to
# /opt/fastembed-cache and ship that directory into the runtime stage.
ENV FASTEMBED_CACHE_PATH=/opt/fastembed-cache
RUN python -c "from fastembed import TextEmbedding; m = TextEmbedding(model_name='BAAI/bge-small-en-v1.5'); list(m.embed(['warmup']))"


# ---- runtime stage ---------------------------------------------------------
FROM python:3.12.4-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FASTEMBED_CACHE_PATH=/opt/fastembed-cache \
    PATH="/opt/venv/bin:$PATH" \
    OPENBLAS_NUM_THREADS=1 \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    BLIS_NUM_THREADS=1 \
    NUMEXPR_NUM_THREADS=1

# libgomp1 is required at runtime by hdbscan/scikit-learn.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 1001 willbuy \
 && useradd --uid 1001 --gid willbuy --no-create-home --shell /usr/sbin/nologin willbuy

COPY --from=builder /opt/venv /opt/venv
COPY --from=builder /opt/fastembed-cache /opt/fastembed-cache
COPY --from=builder /build/src /app/src
COPY --from=builder /build/pyproject.toml /app/pyproject.toml
COPY apps/aggregator/tests /app/tests

WORKDIR /app
RUN chown -R willbuy:willbuy /app /opt/fastembed-cache
USER 1001:1001

ENTRYPOINT ["/opt/venv/bin/aggregator"]
CMD ["--help"]
