#!/bin/sh

echo "Starting Professor Y Bot..."

# Run database setup first (no-op when DATABASE_URL is unset)
echo "Setting up database..."
yarn prod:db:setup

# Start the server
echo "Starting server..."
yarn start
