# Stage 1: Build the React frontend.
FROM node:23-slim AS frontend-builder
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Set working directory to frontend.
WORKDIR /app/frontend

# Copy the rest of the React source files and build the project.
COPY frontend/ ./

# Install the frontend dependencies.
RUN pnpm install

# Remove the example environment variable file as it would override our set environment.
RUN rm .env.example

# Build the frontend release.
ARG VITE_SUPABASE_URL=stub
ARG VITE_SUPABASE_PUBLISHABLE_KEY=stub
ARG VITE_GA_MEASUREMENT_ID=
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_GA_MEASUREMENT_ID=$VITE_GA_MEASUREMENT_ID
RUN pnpm run build

# Stage 2: Build the Rust backend.
FROM clux/muslrust:stable AS backend-builder

# Install Rust target for musl to produce a static binary.
RUN rustup target add x86_64-unknown-linux-musl

# Set working directory to backend.
WORKDIR /app/backend

# Copy the built React frontend. The backend embeds the frontend.
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Copy the Rust project.
COPY backend/ ./
COPY common /app/common
RUN cargo build --release --target x86_64-unknown-linux-musl

# Stage 3: Final image
FROM debian:bullseye-slim

# Copy the compiled Rust binary.
COPY --from=backend-builder /app/backend/target/x86_64-unknown-linux-musl/release/backend /app/backend

# Set the working directory and expose port 3000.
WORKDIR /app
EXPOSE 3000

# Start the application.
ENTRYPOINT ["/app/backend"]

