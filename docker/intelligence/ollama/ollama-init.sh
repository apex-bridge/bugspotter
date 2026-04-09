#!/bin/bash
set -e

# Start Ollama in the background
/bin/ollama serve &
OLLAMA_PID=$!

# Graceful shutdown — forward SIGTERM to ollama process
_shutdown() {
  echo "Caught signal, shutting down Ollama..."
  kill -TERM "$OLLAMA_PID" 2>/dev/null || true
  wait "$OLLAMA_PID" 2>/dev/null || true
}
trap _shutdown SIGINT SIGTERM

# Wait for Ollama to be ready
echo "Waiting for Ollama server to start..."
sleep 5

MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if ollama list > /dev/null 2>&1; then
        echo "Ollama server is ready!"
        break
    fi
    echo "Waiting for Ollama... (attempt $((RETRY_COUNT + 1))/$MAX_RETRIES)"
    sleep 2
    RETRY_COUNT=$((RETRY_COUNT + 1))
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo "ERROR: Ollama server failed to start!"
    exit 1
fi

# Pull the model if not already present
MODEL="${OLLAMA_MODEL:-llama3.1:8b}"
echo "Checking if model $MODEL exists..."

if ! ollama show "$MODEL" > /dev/null 2>&1; then
    echo "Pulling model $MODEL (this may take several minutes)..."
    ollama pull "$MODEL"
    echo "Model $MODEL pulled successfully!"
else
    echo "Model $MODEL already exists."
fi

echo "Ollama is ready with model $MODEL"

# Wait for the main ollama process
wait "$OLLAMA_PID"
