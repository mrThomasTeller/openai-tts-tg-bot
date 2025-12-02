FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install --production

# Copy the source code
COPY src/ ./src/

# Create temp directory for audio files
RUN mkdir -p temp

# Set environment variables
ENV NODE_ENV=production

# Run the bot (exec form with shell for proper signal handling and unbuffered output)
CMD ["node", "--no-warnings", "src/index.js"] 