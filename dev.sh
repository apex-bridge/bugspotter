#!/bin/bash
# ============================================================================
# BugSpotter - Local Development Environment Manager
# ============================================================================

set -e

COMPOSE_FILE="docker-compose.dev.yml"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to print colored messages
log_info() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to show usage
show_usage() {
    cat << EOF
Usage: ./dev.sh [command]

Commands:
  start       Start development dependencies (postgres, redis, minio)
  stop        Stop development dependencies
  restart     Restart development dependencies
  clean       Stop and remove containers, networks, and volumes (DESTRUCTIVE)
  logs        Show logs from all containers
  status      Show status of all containers
  db          Connect to PostgreSQL database
  redis       Connect to Redis CLI
  migrate     Run database migrations
  build       Build backend and admin for testing
  backend     Start backend API server locally
  admin       Start admin panel locally
  worker      Start background worker locally
  dev         Start backend + admin + worker in tmux/screen
  help        Show this help message

Examples:
  ./dev.sh start              # Start dependencies
  ./dev.sh migrate            # Run migrations
  ./dev.sh backend            # Start API locally
  ./dev.sh admin              # Start admin locally
  ./dev.sh logs               # Follow logs
  ./dev.sh db                 # Connect to postgres
  ./dev.sh clean              # Clean everything and start fresh
EOF
}

# Function to start development dependencies
start_deps() {
    log_info "Starting development dependencies..."
    docker-compose -f "$COMPOSE_FILE" up -d
    log_info "Waiting for services to be healthy..."
    sleep 5
    docker-compose -f "$COMPOSE_FILE" ps
    
    log_info "Development dependencies started!"
    echo ""
    log_info "PostgreSQL: localhost:5432"
    log_info "Redis: localhost:6379"
    log_info "MinIO: localhost:9000 (Console: localhost:9001)"
    echo ""
    log_info "Run 'pnpm --filter @bugspotter/backend dev' to start the API server"
    log_info "Run 'pnpm --filter @bugspotter/admin dev' to start the admin panel"
}

# Function to stop dependencies
stop_deps() {
    log_info "Stopping development dependencies..."
    docker-compose -f "$COMPOSE_FILE" stop
    log_info "Dependencies stopped"
}

# Function to restart dependencies
restart_deps() {
    log_info "Restarting development dependencies..."
    docker-compose -f "$COMPOSE_FILE" restart
    log_info "Dependencies restarted"
}

# Function to clean everything
clean_all() {
    log_warn "This will remove all containers, networks, and volumes!"
    read -p "Are you sure? (yes/no): " confirm
    if [ "$confirm" = "yes" ]; then
        log_info "Stopping containers..."
        docker-compose -f "$COMPOSE_FILE" down -v --remove-orphans
        log_info "Clean complete - all data removed"
    else
        log_info "Clean cancelled"
    fi
}

# Function to show logs
show_logs() {
    docker-compose -f "$COMPOSE_FILE" logs -f "$@"
}

# Function to show status
show_status() {
    docker-compose -f "$COMPOSE_FILE" ps
}

# Function to connect to database
connect_db() {
    log_info "Connecting to PostgreSQL..."
    docker exec -it bugspotter-postgres-dev psql -U bugspotter -d bugspotter
}

# Function to connect to redis
connect_redis() {
    log_info "Connecting to Redis..."
    docker exec -it bugspotter-redis-dev redis-cli
}

# Function to build services
build_services() {
    log_info "Building backend and admin..."
    pnpm build
    log_info "Build complete"
}

# Function to run migrations
run_migrations() {
    log_info "Running database migrations..."
    
    # Ensure .env exists
    if [ ! -f "packages/backend/.env" ]; then
        if [ -f "packages/backend/.env.local" ]; then
            log_info "Creating .env from .env.local..."
            cp packages/backend/.env.local packages/backend/.env
        else
            log_error ".env.local not found. Please create it first."
            exit 1
        fi
    fi
    
    log_info "Using packages/backend/.env configuration"
    
    # Load env and run migrations
    cd packages/backend
    set -a
    source .env
    set +a
    pnpm migrate up
    cd ../..
    
    log_info "Migrations complete"
}

# Function to start backend locally
start_backend() {
    log_info "Starting backend API server..."
    log_info "Make sure dependencies are running: ./dev.sh start"
    
    # Ensure .env exists
    if [ ! -f "packages/backend/.env" ]; then
        log_info "Creating .env from .env.local..."
        cp packages/backend/.env.local packages/backend/.env
    fi
    
    cd packages/backend
    pnpm dev
}

# Function to start admin locally
start_admin() {
    log_info "Starting admin panel..."
    
    # Ensure .env exists
    if [ ! -f "apps/admin/.env" ]; then
        log_info "Creating .env from .env.local..."
        cp apps/admin/.env.local apps/admin/.env
    fi
    
    cd apps/admin
    pnpm dev
}

# Function to start worker locally
start_worker() {
    log_info "Starting background worker..."
    
    # Ensure .env exists
    if [ ! -f "packages/backend/.env" ]; then
        log_info "Creating .env from .env.local..."
        cp packages/backend/.env.local packages/backend/.env
    fi
    
    cd packages/backend
    pnpm worker
}

# Function to start all services
start_all_dev() {
    log_info "Starting all development services..."
    log_warn "This requires tmux or screen to be installed"
    
    # Check for tmux
    if command -v tmux &> /dev/null; then
        log_info "Using tmux for multiple terminals"
        
        # Create new tmux session
        tmux new-session -d -s bugspotter
        tmux rename-window -t bugspotter:0 'backend'
        tmux send-keys -t bugspotter:0 './dev.sh backend' C-m
        
        # Split window for admin
        tmux split-window -h -t bugspotter:0
        tmux send-keys -t bugspotter:0.1 './dev.sh admin' C-m
        
        # Split window for worker
        tmux split-window -v -t bugspotter:0.0
        tmux send-keys -t bugspotter:0.2 './dev.sh worker' C-m
        
        # Attach to session
        log_info "Attaching to tmux session 'bugspotter'"
        log_info "Use Ctrl+B then D to detach"
        tmux attach -t bugspotter
    else
        log_error "tmux not found. Install with: sudo apt install tmux"
        log_info "Or run manually in separate terminals:"
        log_info "  Terminal 1: ./dev.sh backend"
        log_info "  Terminal 2: ./dev.sh admin"
        log_info "  Terminal 3: ./dev.sh worker"
        exit 1
    fi
}

# Main script logic
case "${1:-help}" in
    start)
        start_deps
        ;;
    stop)
        stop_deps
        ;;
    restart)
        restart_deps
        ;;
    clean)
        clean_all
        ;;
    logs)
        show_logs "${@:2}"
        ;;
    status)
        show_status
        ;;
    db)
        connect_db
        ;;
    redis)
        connect_redis
        ;;
    migrate)
        run_migrations
        ;;
    build)
        build_services
        ;;
    backend)
        start_backend
        ;;
    admin)
        start_admin
        ;;
    worker)
        start_worker
        ;;
    dev)
        start_all_dev
        ;;
    help|--help|-h)
        show_usage
        ;;
    *)
        log_error "Unknown command: $1"
        echo ""
        show_usage
        exit 1
        ;;
esac
