# E2E Test Scripts

## start-e2e-backend.sh

Automatically starts the backend API on **port 4000** connected to the E2E testcontainer database.

### Usage

```bash
# Terminal 1: Start E2E tests
cd apps/admin
pnpm test:e2e:ui

# Terminal 2: Start E2E backend on port 4000
cd apps/admin
./scripts/start-e2e-backend.sh
```

### What it does

1. Waits for E2E tests to create the testcontainer (max 120s)
2. Reads `DATABASE_URL` from `src/tests/e2e/.test-env`
3. Kills any existing processes on port 4000 only
4. Starts backend on port 4000 with the testcontainer DATABASE_URL

### Why is this needed?

E2E tests create an isolated PostgreSQL testcontainer for each test run. The backend API must connect to this container (not the docker-compose database) for tests to pass correctly.

**Why port 4000?**

- Keeps your development backend (port 3000) and test backend (port 4000) completely separate
- No need to stop/restart your development backend
- Both can run simultaneously without conflicts

Without this script, tests like "should return initialized=false when database has no users" will fail because the backend would be querying the wrong database.

### Troubleshooting

**Script exits with "Error: .test-env file not found"**

- Make sure E2E tests are running in another terminal
- The tests create the `.test-env` file during global setup

**Backend fails to start**

- Check if port 4000 is already in use: `lsof -i:4000`
- Kill existing processes on port 4000: `lsof -ti:4000 | xargs kill -9`
- Your development backend on port 3000 should remain untouched

**Tests still fail**

- Verify backend is connected to testcontainer: Check backend logs for the DATABASE_URL
- Ensure testcontainer is running: `docker ps | grep postgres`
