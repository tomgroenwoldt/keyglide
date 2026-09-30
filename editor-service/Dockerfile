# Stage 1: Build the Rust editor-service.
FROM clux/muslrust:stable AS editor-service-builder

# Install Rust target for musl to produce a static binary.
RUN rustup target add x86_64-unknown-linux-musl

# Set working directory to editor-service.
WORKDIR /app/editor-service

# Install custom helix.
ENV RUSTFLAGS="-C target-feature=-crt-static -C link-arg=-lm"
ENV HELIX_DISABLE_AUTO_GRAMMAR_BUILD=1
RUN git clone -b also-auto-save-in-insert-mode --single-branch https://github.com/tomgroenwoldt/helix.git /tmp/helix && \
    cd /tmp/helix
RUN cargo install \
    --profile opt \
    --config 'build.rustflags="-C target-cpu=native"' \
    --path /tmp/helix/helix-term \
    --target x86_64-unknown-linux-musl \
    --locked
RUN cp /tmp/helix/target/x86_64-unknown-linux-musl/opt/hx /usr/bin/helix

# Copy the Rust project.
COPY editor-service /app/editor-service
COPY common /app/common
RUN cargo build --release --target x86_64-unknown-linux-musl

# Stage 2: Get the helix binary via pacman. We only use it for the runtime folder.
FROM archlinux:latest AS helix-builder

# Install latest release of helix.
RUN pacman -Sy helix --noconfirm

# Stage 3: Final image
# TODO: Try to move to alpine?
FROM debian:testing-slim

RUN apt update && apt install -y bubblewrap

# Copy the compiled Rust binary.
COPY --from=editor-service-builder /app/editor-service/target/x86_64-unknown-linux-musl/release/editor-service /usr/bin/editor-service

# Copy helix, its runtimes and a basic config to enable true colors.
COPY --from=editor-service-builder /usr/bin/helix /usr/bin/helix
COPY --from=helix-builder /usr/lib/helix/runtime /root/.config/helix/runtime
COPY editor-service/helix /root/.config/helix

# Set the working directory and expose port 3001.
WORKDIR /root
EXPOSE 3001

# Start the Axum application.
CMD ["/usr/bin/editor-service"]
