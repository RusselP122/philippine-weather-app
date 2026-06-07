# Stage 1: Build the Vite frontend
FROM node:20-bookworm AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production environment
FROM debian:bookworm-slim

# Install Node.js, Python, and pre-compiled GIS/scientific dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
    python3 \
    python3-numpy \
    python3-pandas \
    python3-matplotlib \
    python3-cartopy \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built frontend from Stage 1
COPY --from=build /app/dist ./dist

# Copy package files and install production-only dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy Python scripts, manifest, and assets needed for trends map generation
COPY generate_trends_map.py ./
COPY public/data ./public/data

# Copy production server script
COPY server.js ./

EXPOSE 10000

# Run the server
CMD ["node", "server.js"]
