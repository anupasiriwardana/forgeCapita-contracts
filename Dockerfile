FROM node:22

WORKDIR /app

# Copy dependency files first to utilize Docker's layer caching
COPY package*.json ./
RUN npm install

# Copy the rest of the contract workspace
COPY . .

# Expose Hardhat default port
EXPOSE 8545

CMD ["npx", "hardhat", "node"]