FROM oven/bun:latest

WORKDIR /app

# Copy package.json and bun.lockb (if exists)
COPY package.json ./
COPY bun.lockb* ./

# Install dependencies
RUN bun install --production

# Copy the source code
COPY src/ ./src/

# Create temp directory for audio files
RUN mkdir -p temp

# Set environment variables
ENV NODE_ENV=production

# Run the bot
CMD ["bun", "src/index.js"] 