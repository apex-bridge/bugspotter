# Local Development Setup

This guide explains how to run BugSpotter locally with containerized dependencies.

## Quick Start

### 1. Start Development Dependencies

```bash
# Start postgres, redis, and minio in containers
./dev.sh start
```

This will start:

- PostgreSQL on `localhost:5432`
- Redis on `localhost:6379`
- MinIO on `localhost:9000` (Console: `localhost:9001`)

### 2. Run Database Migrations

```bash
./dev.sh migrate
```

### 3. Start Services Locally

#### Option A: All services in tmux (recommended)

```bash
./dev.sh dev
```

This starts backend, admin, and worker in separate tmux panes.

- Use `Ctrl+B` then `D` to detach
- Reattach with `tmux attach -t bugspotter`

#### Option B: Separate terminals

```bash
# Terminal 1: Backend API
./dev.sh backend

# Terminal 2: Admin Panel
./dev.sh admin

# Terminal 3: Background Worker
./dev.sh worker
```

## Available Commands

```bash
./dev.sh start       # Start dependencies (postgres, redis, minio)
./dev.sh stop        # Stop dependencies
./dev.sh restart     # Restart dependencies
./dev.sh clean       # Clean everything (removes all data!)
./dev.sh migrate     # Run database migrations
./dev.sh backend     # Start backend API locally
./dev.sh admin       # Start admin panel locally
./dev.sh worker      # Start background worker locally
./dev.sh dev         # Start all services in tmux
./dev.sh logs        # Show container logs
./dev.sh status      # Show container status
./dev.sh db          # Connect to PostgreSQL
./dev.sh redis       # Connect to Redis CLI
./dev.sh build       # Build all packages
```

## Access Points

- **Backend API**: http://localhost:3000
- **Admin Panel**: http://localhost:5173 (Vite dev server)
- **MinIO Console**: http://localhost:9001
  - Username: `minioadmin123456`
  - Password: `minioadmin123456789012345678901234`

## Configuration

Environment files are located at:

- Backend: `packages/backend/.env.local`
- Admin: `apps/admin/.env.local`

These are automatically copied to `.env` when running commands.

## Clean Database

To start fresh with an empty database:

```bash
./dev.sh clean      # Remove all containers and volumes
./dev.sh start      # Start fresh
./dev.sh migrate    # Create schema
```

## Troubleshooting

### Port Already in Use

If ports are already in use, stop existing containers:

```bash
docker stop $(docker ps -q --filter name=bugspotter)
```

### Database Connection Failed

Check if postgres is running:

```bash
./dev.sh status
```

### MinIO Access Denied

Make sure credentials in `.env` match the container configuration (16+ chars for access key, 32+ for secret).

### Can't Connect to API

Ensure backend is running and dependencies are healthy:

```bash
./dev.sh status
./dev.sh logs api
```

## Development Workflow

1. Start dependencies: `./dev.sh start`
2. Run migrations: `./dev.sh migrate`
3. Start services: `./dev.sh dev`
4. Make changes to code (hot reload enabled)
5. Test changes
6. Stop: `Ctrl+C` or `Ctrl+B D` (tmux)

## Docker Compose Files

- `docker-compose.dev.yml` - Development dependencies only
- `docker-compose.yml` - Full production stack

Use `docker-compose.dev.yml` for local development with the backend running on your host.
