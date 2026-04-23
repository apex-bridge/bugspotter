/**
 * Playwright Global Setup
 * Starts PostgreSQL container and runs migrations for E2E tests
 * Each test run gets a fresh database for complete isolation
 */

import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { exec, spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = promisify(exec);

// State file to persist process/container info for teardown
const STATE_FILE = path.resolve(__dirname, '.e2e-state.json');

// Store container and backend process references globally for cleanup
let postgresContainer: StartedPostgreSqlContainer;
let redisContainer: StartedTestContainer;
let minioContainer: StartedTestContainer;
let backendProcess: ChildProcess | null = null;
let workerProcess: ChildProcess | null = null;

// Save state to file for teardown
async function saveState() {
  const state = {
    backendPid: backendProcess?.pid,
    workerPid: workerProcess?.pid,
    postgresContainerId: postgresContainer?.getId(),
    redisContainerId: redisContainer?.getId(),
    minioContainerId: minioContainer?.getId(),
  };
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

// Load state from file
async function loadState() {
  try {
    const data = await fs.readFile(STATE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export default async function globalSetup() {
  try {
    console.log('\n🔧 Starting E2E test setup with isolated database...\n');

    // Kill any existing backend process on port 4000 from previous test runs
    // Note: Don't kill port 4001 - let Playwright's webServer handle Vite
    try {
      // Detect platform and use appropriate command
      const isWindows = process.platform === 'win32';

      if (isWindows) {
        // Windows: Use netstat to find PID, then taskkill
        try {
          const { stdout } = await execAsync('netstat -ano | findstr :4000 | findstr LISTENING');
          const lines = stdout.split('\n').filter((line) => line.trim());

          for (const line of lines) {
            // Extract PID from netstat output (last column)
            const match = line.trim().match(/\s+(\d+)\s*$/);
            if (match) {
              const pid = match[1];
              try {
                // Use taskkill /F for force kill
                await execAsync(`taskkill /F /PID ${pid}`);
                console.log(`✅ Killed process ${pid} on port 4000`);
              } catch {
                // Process might have already exited
              }
            }
          }
        } catch {
          // No process found on port 4000
        }
      } else {
        // Unix/Linux/macOS: Use lsof
        await execAsync('lsof -ti:4000 | xargs kill 2>/dev/null || true');
        // Give processes time to clean up (1 second)
        await new Promise((resolve) => setTimeout(resolve, 1000));
        // Force kill any remaining processes
        await execAsync('lsof -ti:4000 | xargs kill -9 2>/dev/null || true');
      }

      console.log('✅ Cleaned up port 4000');
    } catch {
      // Port was already free
    }

    // Load environment variables from multiple sources (priority order)
    // 1. Admin .env.e2e (E2E test specific config)
    dotenv.config({ path: path.resolve(__dirname, '../../../.env.e2e') });

    // 2. Backend .env.integration (Jira E2E credentials)
    dotenv.config({
      path: path.resolve(__dirname, '../../../../../packages/backend/.env.integration'),
    });

    // 3. Root .env (fallback)
    dotenv.config({ path: path.resolve(__dirname, '../../../../../.env') });

    // Start all containers in parallel for faster setup (saves ~10-15 seconds)
    console.log('🚀 Starting containers in parallel (PostgreSQL, Redis, MinIO)...');
    const containerStartTime = Date.now();

    const [postgresResult, redisResult, minioResult] = await Promise.all([
      // PostgreSQL container
      new PostgreSqlContainer('postgres:16')
        .withDatabase('bugspotter_e2e_test')
        .withUsername('postgres')
        .withPassword('testpass')
        .withExposedPorts(5432)
        .start()
        .then((container) => {
          console.log('  ✅ PostgreSQL ready');
          return container;
        })
        .catch((error) => {
          console.error('  ❌ PostgreSQL failed:', error.message);
          throw error;
        }),

      // Redis container
      new GenericContainer('redis:7-alpine')
        .withExposedPorts(6379)
        .start()
        .then((container) => {
          console.log('  ✅ Redis ready');
          return container;
        })
        .catch((error) => {
          console.error('  ❌ Redis failed:', error.message);
          throw error;
        }),

      // MinIO container
      new GenericContainer('minio/minio:RELEASE.2024-10-13T13-34-11Z')
        .withExposedPorts(9000, 9001)
        .withEnvironment({
          MINIO_ROOT_USER: 'bugspotter-e2e-admin',
          MINIO_ROOT_PASSWORD: 'bugspotter-e2e-secret-key',
        })
        .withCommand(['server', '/data', '--console-address', ':9001'])
        .start()
        .then((container) => {
          console.log('  ✅ MinIO ready');
          return container;
        })
        .catch((error) => {
          console.error('  ❌ MinIO failed:', error.message);
          throw error;
        }),
    ]);

    postgresContainer = postgresResult;
    redisContainer = redisResult;
    minioContainer = minioResult;

    const containerTime = ((Date.now() - containerStartTime) / 1000).toFixed(1);
    console.log(`✅ All containers started in ${containerTime}s`);

    // Extract connection details
    const connectionUri = postgresContainer.getConnectionUri();
    const redisHost = redisContainer.getHost();
    const redisPort = redisContainer.getMappedPort(6379);
    const redisUrl = `redis://${redisHost}:${redisPort}`;
    const minioHost = minioContainer.getHost();
    const minioPort = minioContainer.getMappedPort(9000);
    const minioEndpoint = `http://${minioHost}:${minioPort}`;

    console.log(`📍 Database: ${connectionUri.replace(/:[^:@]+@/, ':***@')}`);
    console.log(`📍 Redis: ${redisUrl}`);
    console.log(`📍 MinIO: ${minioEndpoint}`);

    // Create bucket in MinIO
    console.log('📦 Creating MinIO bucket...');
    try {
      // Reduced wait time from 3s to 1s (testcontainers ensures container is ready)
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Use mc (MinIO Client) commands via docker exec to create bucket
      const containerId = minioContainer.getId();
      await execAsync(
        `docker exec ${containerId} sh -c "mc alias set local http://localhost:9000 bugspotter-e2e-admin bugspotter-e2e-secret-key && mc mb local/bugspotter-e2e --ignore-existing"`,
        { timeout: 30000 } // 30 second timeout for bucket creation
      );
      console.log('✅ MinIO bucket created');
    } catch (error) {
      console.warn('⚠️  Failed to create bucket, will try during backend startup:', error);
      // Don't throw - backend can create bucket on startup
    }

    // Set environment variables for migrations and tests
    process.env.DATABASE_URL = connectionUri;
    process.env.REDIS_URL = redisUrl;
    process.env.JWT_SECRET = 'test-jwt-secret-for-e2e-tests-min-32-chars-required-here-now';
    process.env.ENCRYPTION_KEY = 'test-encryption-key-for-e2e-tests-32chars+';
    process.env.JWT_EXPIRES_IN = '1h';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'error'; // Reduce log noise

    // Save connection details for tests to use
    const envFilePath = path.resolve(__dirname, '.test-env');
    await fs.writeFile(
      envFilePath,
      `DATABASE_URL=${connectionUri}\n` +
        `REDIS_URL=${redisUrl}\n` +
        `JWT_SECRET=${process.env.JWT_SECRET}\n` +
        `ENCRYPTION_KEY=${process.env.ENCRYPTION_KEY}\n` +
        `JWT_EXPIRES_IN=1h\n` +
        `JWT_REFRESH_EXPIRES_IN=7d\n`
    );

    // Run migrations
    console.log('🚀 Running database migrations...');

    try {
      const backendPath = path.resolve(__dirname, '../../../../../packages/backend');
      // Use npx tsx directly to avoid Corepack issues with pnpm
      const { stdout, stderr } = await execAsync('npx tsx src/db/migrations/migrate.ts', {
        cwd: backendPath,
        env: { ...process.env, DATABASE_URL: connectionUri },
      });

      // Log migration output for visibility
      if (stdout) {
        console.log(stdout);
      }
      if (stderr) {
        console.error(stderr);
      }

      console.log('✅ Migrations completed');
    } catch (error) {
      console.error('❌ Migration failed:', error);
      // Log additional error details if available
      if (error instanceof Error && 'stdout' in error) {
        const execError = error as Error & { stdout?: string; stderr?: string };
        if (execError.stdout) {
          console.error('stdout:', execError.stdout);
        }
        if (execError.stderr) {
          console.error('stderr:', execError.stderr);
        }
      }
      await postgresContainer.stop();
      throw error;
    }

    // Set API_URL for both backend and frontend. Precedence:
    //   1. `API_URL` if explicitly provided (someone pointing tests at a
    //      non-localhost backend, or a port + host combination that can't
    //      be captured via `API_PORT` alone).
    //   2. Otherwise derive from `API_PORT` (default `4000`).
    const apiPort = process.env.API_PORT || '4000';
    const apiUrl = process.env.API_URL || `http://localhost:${apiPort}`;
    process.env.API_URL = apiUrl;
    process.env.VITE_API_URL = apiUrl; // For Vite proxy configuration

    // Resolve the admin (frontend) URL once. `BASE_URL` takes precedence
    // when someone is running Playwright against an already-running admin
    // (in that case Playwright's webServer is skipped); otherwise we
    // honor `E2E_ADMIN_PORT` for Windows/Hyper-V port conflicts; finally
    // default to `:4001`. Normalize via `new URL(...).origin` so a
    // `BASE_URL` that includes a path (`https://host.com/admin`) or a
    // trailing slash doesn't leak into CORS matching — the browser's
    // `Origin` header is always just `scheme://host[:port]`.
    const rawAdminUrl =
      process.env.BASE_URL ?? `http://localhost:${process.env.E2E_ADMIN_PORT ?? '4001'}`;
    let adminUrl: string;
    try {
      adminUrl = new URL(rawAdminUrl).origin;
    } catch {
      throw new Error(`Invalid BASE_URL / E2E_ADMIN_PORT combination: ${rawAdminUrl}`);
    }

    // Normalize apiUrl the same way so a user-provided `API_URL` with
    // a path/trailing slash doesn't leak into CORS matching.
    let apiOrigin: string;
    try {
      apiOrigin = new URL(apiUrl).origin;
    } catch {
      throw new Error(`Invalid API_URL / API_PORT combination: ${apiUrl}`);
    }

    console.log(`🚀 Starting backend server on port ${apiPort}...`);
    const backendPath = path.resolve(__dirname, '../../../../../packages/backend');

    // Use npx tsx to avoid Corepack issues (shell: true required on Windows)
    backendProcess = spawn('npx', ['tsx', 'src/api/index.ts'], {
      cwd: backendPath,
      shell: true,
      env: {
        ...process.env,
        DATABASE_URL: connectionUri,
        REDIS_URL: redisUrl,
        PORT: apiPort,
        NODE_ENV: 'test',
        LOG_LEVEL: 'warn', // Only show warnings and errors (reduce log noise)
        // Honor port overrides so local runs on Windows (Hyper-V
        // reserves 4000/4001) can pick free ports via env vars. Uses
        // the shared `adminUrl` resolved above so `FRONTEND_URL` and
        // the frontend entry in `CORS_ORIGINS` stay in sync even when
        // the admin is served from a non-localhost `BASE_URL`.
        CORS_ORIGINS: `${adminUrl},${apiOrigin}`,
        FRONTEND_URL: adminUrl,
        // Run the backend in SaaS mode so routes gated by `SaaSRoute` in
        // the admin (organizations list, retention, billing, etc.) are
        // reachable during E2E. Without this, the backend defaults to
        // selfhosted, the admin's /deployment endpoint returns
        // `selfhosted`, and those routes silently redirect to /projects
        // — failing any test that navigates to a SaaS-gated page.
        DEPLOYMENT_MODE: 'saas',
        // Increase database pool size for E2E tests
        DB_POOL_MIN: '5',
        DB_POOL_MAX: '20',
        // Allow setup from request body (not just env vars)
        SETUP_MODE: 'minimal',
        // Configure MinIO storage for E2E tests
        STORAGE_BACKEND: 'minio',
        S3_ENDPOINT: minioEndpoint,
        S3_ACCESS_KEY: 'bugspotter-e2e-admin',
        S3_SECRET_KEY: 'bugspotter-e2e-secret-key',
        S3_BUCKET: 'bugspotter-e2e',
        S3_REGION: 'us-east-1',
        S3_FORCE_PATH_STYLE: 'true',
        // Disable strict data residency validation for E2E tests
        DISABLE_STRICT_RESIDENCY_VALIDATION: 'true',
        // Pass notification credentials to backend for E2E tests
        SMTP_HOST: process.env.SMTP_HOST,
        SMTP_PORT: process.env.SMTP_PORT,
        SMTP_SECURE: process.env.SMTP_SECURE,
        SMTP_USER: process.env.SMTP_USER,
        SMTP_PASS: process.env.SMTP_PASS,
        EMAIL_FROM_ADDRESS: process.env.EMAIL_FROM_ADDRESS,
        SLACK_TEST_WEBHOOK_URL: process.env.SLACK_TEST_WEBHOOK_URL,
        SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
        DISCORD_TEST_WEBHOOK_URL: process.env.DISCORD_TEST_WEBHOOK_URL,
        DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Capture backend output for debugging
    backendProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      // Show all output to debug startup issues
      console.log(`Backend stdout: ${output.trim()}`);
    });

    backendProcess.stderr?.on('data', (data) => {
      const error = data.toString();
      // Show all errors to debug startup issues
      console.error(`Backend stderr: ${error.trim()}`);
    });

    backendProcess.on('error', (error) => {
      console.error('Failed to start backend process:', error);
    });

    backendProcess.on('exit', (code, signal) => {
      console.warn(`Backend process exited with code ${code}, signal ${signal}`);
    });

    // Wait for backend to be ready
    console.log('⏳ Waiting for backend to be ready...');
    const maxRetries = 120; // 60s timeout (CI needs more time for cold start)
    const retryDelay = 500; // Check every 500ms

    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(`${apiUrl}/health`);
        if (response.ok) {
          console.log('✅ Backend server is ready');
          break;
        }
        // Throw error for non-ok responses to trigger retry logic
        throw new Error(`Health check failed with status: ${response.status}`);
      } catch (error) {
        // Server not ready yet
        if (i === maxRetries - 1) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          throw new Error(
            `Backend server failed to start within ${(maxRetries * retryDelay) / 1000}s: ${errorMsg}`
          );
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }

    // Start worker process for queue processing
    console.log('🔄 Starting worker process...');

    // Use npx tsx to avoid Corepack issues (shell: true required on Windows)
    // Note: Using src/worker.ts with robust isMainModule check that handles tsx execution
    workerProcess = spawn('npx', ['tsx', 'src/worker.ts'], {
      cwd: backendPath,
      shell: true,
      env: {
        ...process.env,
        DATABASE_URL: connectionUri,
        REDIS_URL: redisUrl,
        NODE_ENV: 'test',
        LOG_LEVEL: 'error',
        // Honor WORKER_HEALTH_PORT override so local runs on Windows
        // (Hyper-V reserves 3001 via `netsh int ipv4 show
        // excludedportrange`) can pick a free port.
        WORKER_HEALTH_PORT: process.env.WORKER_HEALTH_PORT ?? '3001',
        // Match the backend's deployment mode so queue consumers operate
        // under the same billing / usage-tracking / tenant-resolution
        // rules as the API they're paired with. Diverging here would
        // silently drift behavior between sync (API) and async (queue)
        // paths.
        DEPLOYMENT_MODE: 'saas',
        // Configure MinIO storage for E2E tests (same as backend)
        STORAGE_BACKEND: 'minio',
        S3_ENDPOINT: minioEndpoint,
        S3_ACCESS_KEY: 'bugspotter-e2e-admin',
        S3_SECRET_KEY: 'bugspotter-e2e-secret-key',
        S3_BUCKET: 'bugspotter-e2e',
        S3_REGION: 'us-east-1',
        S3_FORCE_PATH_STYLE: 'true',
        // Pass notification credentials to worker for E2E tests
        SMTP_HOST: process.env.SMTP_HOST,
        SMTP_PORT: process.env.SMTP_PORT,
        SMTP_SECURE: process.env.SMTP_SECURE,
        SMTP_USER: process.env.SMTP_USER,
        SMTP_PASS: process.env.SMTP_PASS,
        EMAIL_FROM_ADDRESS: process.env.EMAIL_FROM_ADDRESS,
        SLACK_TEST_WEBHOOK_URL: process.env.SLACK_TEST_WEBHOOK_URL,
        SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
        DISCORD_TEST_WEBHOOK_URL: process.env.DISCORD_TEST_WEBHOOK_URL,
        DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Capture worker output for debugging
    workerProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      console.log(`Worker stdout: ${output.trim()}`);
    });

    workerProcess.stderr?.on('data', (data) => {
      const error = data.toString();
      console.error(`Worker stderr: ${error.trim()}`);
    });

    workerProcess.on('error', (error) => {
      console.error('Failed to start worker process:', error);
    });

    workerProcess.on('exit', (code, signal) => {
      console.warn(`Worker process exited with code ${code}, signal ${signal}`);
    });

    // Worker will initialize asynchronously (no need to wait)
    console.log('✅ Worker process started');

    // Display loaded configuration
    console.log('\n📋 Test configuration:');
    console.log(`   API URL: ${apiUrl}`);
    console.log(`   Base URL: ${process.env.BASE_URL || 'http://localhost:4001'}`);
    console.log(`   Database: Isolated PostgreSQL container`);
    console.log(`   Redis: Isolated Redis container`);
    console.log(`   Storage: MinIO (${minioEndpoint})`);

    if (process.env.JIRA_E2E_BASE_URL) {
      console.log(`   Jira URL: ${process.env.JIRA_E2E_BASE_URL}`);
      console.log(`   Jira Email: ${process.env.JIRA_E2E_EMAIL}`);
      console.log(`   Jira Project: ${process.env.JIRA_E2E_PROJECT_KEY || 'E2E'}`);
    } else {
      console.log('   ⚠️  Jira credentials not configured (Jira tests will be skipped)');
    }

    console.log('\n✅ E2E test environment ready\n');

    // Save state for teardown
    await saveState();
  } catch (error) {
    console.error('\n❌ Global setup failed:', error);

    // Clean up any resources that were started before the error
    console.log('🧹 Cleaning up resources after setup failure...');

    if (workerProcess?.pid) {
      try {
        process.kill(workerProcess.pid, 'SIGKILL');
      } catch {
        // Process may not exist
      }
    }

    if (backendProcess?.pid) {
      try {
        process.kill(backendProcess.pid, 'SIGKILL');
      } catch {
        // Process may not exist
      }
    }

    if (minioContainer) {
      try {
        await minioContainer.stop();
      } catch {
        // Container may not be running
      }
    }

    if (redisContainer) {
      try {
        await redisContainer.stop();
      } catch {
        // Container may not be running
      }
    }

    if (postgresContainer) {
      try {
        await postgresContainer.stop();
      } catch {
        // Container may not be running
      }
    }

    // Re-throw to ensure Playwright knows setup failed
    throw error;
  }
}

/**
 * Playwright Global Teardown
 * Stops the backend server, PostgreSQL container, and cleans up
 */
export async function teardown() {
  console.log('\n🧹 Cleaning up E2E test environment...');

  // Load state from file
  const state = await loadState();
  if (!state) {
    console.log('⚠️  No state file found - cleanup may be incomplete');
  }

  // Stop worker process
  if (workerProcess || state?.workerPid) {
    console.log('Stopping worker process...');
    try {
      const pid = workerProcess?.pid || state?.workerPid;
      if (pid) {
        // Send SIGTERM for graceful shutdown
        process.kill(pid, 'SIGTERM');

        // Wait briefly for graceful shutdown
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Force kill if still running
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Process already exited
        }
      }

      console.log('✅ Worker process stopped');
    } catch (error) {
      console.error('Error stopping worker:', error);
    }
  }

  // Stop backend server
  if (backendProcess || state?.backendPid) {
    console.log('Stopping backend server...');
    try {
      const pid = backendProcess?.pid || state?.backendPid;
      if (pid) {
        // Send SIGTERM for graceful shutdown
        process.kill(pid, 'SIGTERM');

        // Wait for graceful shutdown (max 5 seconds)
        await new Promise((resolve) => setTimeout(resolve, 5000));

        // Force kill if still running
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Process already exited
        }
      }

      console.log('✅ Backend server stopped');
    } catch (error) {
      console.error('Error stopping backend:', error);
    }
  }

  // Stop Redis container
  if (redisContainer || state?.redisContainerId) {
    console.log('Stopping Redis container...');
    try {
      if (redisContainer) {
        await redisContainer.stop();
      } else if (state?.redisContainerId) {
        // Use docker CLI to stop container
        await execAsync(`docker stop ${state.redisContainerId}`);
        await execAsync(`docker rm ${state.redisContainerId}`);
      }
      console.log('✅ Redis container stopped');
    } catch (error) {
      console.error('Error stopping Redis container:', error);
    }
  }

  // Stop MinIO container
  if (minioContainer || state?.minioContainerId) {
    console.log('Stopping MinIO container...');
    try {
      if (minioContainer) {
        await minioContainer.stop();
      } else if (state?.minioContainerId) {
        // Use docker CLI to stop container
        await execAsync(`docker stop ${state.minioContainerId}`);
        await execAsync(`docker rm ${state.minioContainerId}`);
      }
      console.log('✅ MinIO container stopped');
    } catch (error) {
      console.error('Error stopping MinIO container:', error);
    }
  }

  // Stop PostgreSQL container
  if (postgresContainer || state?.postgresContainerId) {
    console.log('Stopping PostgreSQL container...');
    try {
      if (postgresContainer) {
        await postgresContainer.stop();
      } else if (state?.postgresContainerId) {
        // Use docker CLI to stop container
        await execAsync(`docker stop ${state.postgresContainerId}`);
        await execAsync(`docker rm ${state.postgresContainerId}`);
      }
      console.log('✅ PostgreSQL container stopped');
    } catch (error) {
      console.error('Error stopping PostgreSQL container:', error);
    }
  }

  // Clean up state and temp files
  try {
    const envFilePath = path.resolve(__dirname, '.test-env');
    await fs.unlink(envFilePath);
  } catch {
    // Ignore if file doesn't exist
  }

  try {
    await fs.unlink(STATE_FILE);
  } catch {
    // Ignore if file doesn't exist
  }

  console.log('✅ E2E test cleanup complete\n');
}
