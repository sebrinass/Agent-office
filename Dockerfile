# Stage 1: Build the application
FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN pnpm build

# Stage 2: Production - based on the original image
FROM heizicao/office-website:latest AS production

# Copy our built files, but EXCLUDE x2t directories to keep the original complete versions
# First copy everything to a temp location
COPY --from=builder /app/out /tmp/out

# Remove the incomplete x2t directories from our build
RUN rm -rf /tmp/out/x2t /tmp/out/x2t-1

# Copy our files (without x2t) to the nginx directory
RUN cp -r /tmp/out/* /usr/share/nginx/html/

# Expose port
EXPOSE 80
