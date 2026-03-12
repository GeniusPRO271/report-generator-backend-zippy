# Zippy Pay Backend

Hono-based REST API with TypeDI, Drizzle ORM, and BullMQ job processing.

## Architecture

```
┌─────────────┐
│   Routes    │ ← Zod validation, JWT middleware, RBAC
└──────┬──────┘
       │
┌──────▼──────┐
│  Services   │ ← @Service() - Business logic layer
└──────┬──────┘
       │
┌──────▼──────┐
│ Repositories│ ← @Service() - Data access layer
└──────┬──────┘
       │
┌──────▼──────┐
│  Drizzle DB │ ← PostgreSQL with connection pooling
└─────────────┘
```

## Dependencies

### Core
- **Hono** `^4.11.7` - Web framework
- **Drizzle ORM** `^0.44.7` - Type-safe database ORM
- **TypeDI** `^0.10.0` - Dependency injection
- **Zod** `^4.3.6` - Schema validation
- **pg** `^8.18.0` / **postgres** `^3.4.8` - PostgreSQL clients

### Authentication & Security
- **jose** `^6.1.3` - JWT signing and verification
- **reflect-metadata** `^0.2.2` - Metadata API for decorators

### Background Jobs
- **BullMQ** `^5.67.2` - Job queue
- **IORedis** `^5.9.2` - Redis client

### File Processing
- **ExcelJS** `^4.4.0` - Excel file generation
- **Luxon** `^3.7.2` - DateTime handling

### Storage
- **@aws-sdk/client-s3** `^3.989.0` - S3 client
- **@aws-sdk/s3-request-presigner** `^3.989.0` - Pre-signed URLs

### Dev Dependencies
- **@types/bun** `latest` - Bun type definitions
- **drizzle-kit** `^0.31.8` - Migration toolkit
- **TypeScript** `^5.9.3` - Type system

## Environment Variables

Create a `.env` file in the `backend/` directory:

```bash
# Database
DATABASE_URL=postgresql://user:password@host:5432/dbname

# Redis (for BullMQ)
REDIS_URL=redis://localhost:6379

# Server
PORT=3110

# Authentication
SESSION_SECRET=your-256-bit-secret-key-here

# S3/Digital Ocean Spaces (for report storage)
DO_SPACES_ENDPOINT=https://nyc3.digitaloceanspaces.com
DO_SPACES_REGION=nyc3
DO_SPACES_BUCKET=your-bucket-name
DO_SPACES_PREFIX=reports/
DO_SPACES_KEY=your-access-key
DO_SPACES_SECRET=your-secret-key
```

## Installation

```bash
cd backend
bun install
```

## Database Setup

### 1. Configure Connection

Update `DATABASE_URL` in `.env` with your PostgreSQL credentials.

### 2. Generate Migrations

After making schema changes in `src/db/schema.ts`:

```bash
bunx drizzle-kit generate
```

### 3. Apply Migrations

```bash
bunx drizzle-kit push
```

Or manually run SQL files from `drizzle/` folder.

### 4. Seed Database

```bash
bun run seed
```

This creates:
- Initial superadmin user
- Sample merchants, providers, countries
- PayMethod configurations
- Sample transactions (optional)

## Development

### Start API Server

```bash
bun run dev:api
```

Server runs on `http://localhost:3110` (or PORT from .env)

### Start Background Worker

```bash
bun run dev:worker
```

Processes report generation jobs from Redis queue.

### Run Both (Development)

```bash
# Using Dockerfile's default CMD
bun run seed && bun run dev:api & bun run dev:worker
```

## Project Structure

```
backend/
├── src/
│   ├── app.ts                 # Hono app setup + route registration
│   ├── index.ts               # Entry point for API server
│   ├── config/
│   │   ├── env.ts            # Environment config
│   │   └── s3.ts             # S3 client config
│   ├── db/
│   │   ├── connection.ts     # PostgreSQL connection pool
│   │   ├── schema.ts         # Drizzle schema definitions
│   │   ├── seed.ts           # Database seeding script
│   │   └── zodSchema/        # Zod validation schemas
│   ├── middleware/
│   │   ├── auth.ts           # JWT verification
│   │   └── role.ts           # RBAC middleware
│   ├── routes/               # API endpoint handlers
│   │   ├── auth.routes.ts
│   │   ├── merchant.routes.ts
│   │   ├── transaction.routes.ts
│   │   ├── statistics.routes.ts
│   │   ├── report.routes.ts
│   │   ├── admin/
│   │   │   └── dedup.routes.ts
│   │   └── ...
│   ├── services/             # Business logic (@Service)
│   │   ├── auth.service.ts
│   │   ├── transaction.service.ts
│   │   ├── statistics.service.ts
│   │   ├── dedup.service.ts
│   │   └── ...
│   ├── repositories/         # Data access (@Service)
│   │   ├── user.repository.ts
│   │   ├── transaction.repository.ts
│   │   ├── merchant.repository.ts
│   │   └── ...
│   ├── queue/
│   │   └── report.queue.ts   # BullMQ job definitions
│   ├── worker/
│   │   └── report.worker.ts  # Background job processor
│   ├── generator/            # Report generation utilities
│   ├── types/                # TypeScript type definitions
│   └── utils/                # Helper functions
├── drizzle/                  # Migration SQL files
├── Exceldata/                # Sample Excel files for import
├── log/                      # Application logs
├── Dockerfile                # Multi-process container (API + worker)
├── Dockerfile.api            # Migration-only container
├── docker-compose.yml        # Full stack (Postgres + Redis + API)
├── drizzle.config.ts         # Drizzle Kit configuration
├── tsconfig.json             # TypeScript config
└── package.json
```

## API Routes

### Public Endpoints
- `POST /api/auth/login` - User login
- `POST /api/auth/refresh` - Refresh access token

### Protected Endpoints (JWT required)
- `GET /api/merchants` - List merchants
- `GET /api/providers` - List providers
- `GET /api/countries` - List countries
- `GET /api/paymethods` - List payment methods
- `GET /api/transactions` - List transactions (paginated)
- `POST /api/transactions` - Create transaction
- `POST /api/transactions/import` - Bulk import from Excel
- `GET /api/statistics/approval-rates` - Approval rate stats
- `POST /api/reports/generate` - Generate Excel/CSV report

### Admin Endpoints (superadmin only)
- `GET /api/admin/dedup/merchants` - Find duplicate merchants
- `POST /api/admin/dedup/merchants/:id/merge` - Merge merchant duplicates
- Similar endpoints for providers, countries, payMethods, transactions

## Key Features

### 1. Transaction Import

```bash
POST /api/transactions/import
Content-Type: multipart/form-data

file: transactions.xlsx
```

- Handles Excel files with transaction data
- Auto-creates missing merchants, providers, countries, payMethods
- Deduplicates based on `commerceReqId`
- In-memory caching for performance

### 2. Deduplication System

```bash
GET /api/admin/dedup/merchants
POST /api/admin/dedup/merchants/:keepId/merge
```

- SQL-based GROUP BY + HAVING for finding duplicates
- Atomic transaction merging
- Updates all FK references before deletion
- Available for all major entities

### 3. Report Generation

```bash
POST /api/reports/generate
{
  "format": "xlsx",
  "filters": {
    "startDate": "2025-01-01",
    "endDate": "2025-12-31",
    "merchantId": 1
  }
}
```

- Async job processing via BullMQ
- Excel/CSV export options
- S3 storage with pre-signed URLs
- Job status polling

### 4. Statistics & Analytics

```bash
GET /api/statistics/approval-rates?merchantId=1&countryId=2
```

- SQL aggregation for performance
- Filtered by merchant, provider, country, date range
- Real-time calculation

## Database Schema Highlights

### Core Tables
- `merchant` - Payment processors
- `provider` - Payment service providers
- `country` - Countries of operation
- `payMethod` - Payment methods (composite key: name + providerId + countryId)
- `transaction` - Transaction records (FK: provider, payMethod, merchant)
- `countryOperation` - Merchant operations config per country
- `user` - Admin users with role-based access

### Indexes (Performance Optimized)
- `transaction(providerId, payMethodId, status)` - Approval rate queries
- `payMethod(providerId, countryId)` - Lookup optimization

### Unique Constraints
- `merchant.name`
- `provider.name`
- `payMethod(name, providerId, countryId)` - Composite
- `countryOperation(merchantId, providerId, countryId, payMethodId)` - Composite

## Deployment

### Option 1: Docker Compose (Recommended for Development)

```bash
docker-compose up --build
```

Includes:
- PostgreSQL on port 5555
- Redis on port 6379
- API + Worker on port 3110
- Auto-migration and seeding

### Option 2: Manual Deployment

#### Prerequisites
1. PostgreSQL 16+ running
2. Redis 7+ running
3. Environment variables configured

#### Steps

```bash
# 1. Install dependencies
bun install

# 2. Run migrations
bunx drizzle-kit push

# 3. Seed database
bun run seed

# 4. Start API server (production)
bun run src/index.ts

# 5. Start worker (separate process)
bun run src/worker/report.worker.ts
```

### Option 3: Docker with External DB

```bash
docker build -f Dockerfile -t zippy-backend .

docker run -d \
  -p 3110:3110 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/db \
  -e REDIS_URL=redis://host:6379 \
  -e SESSION_SECRET=your-secret \
  -e DO_SPACES_ENDPOINT=https://... \
  -e DO_SPACES_KEY=... \
  -e DO_SPACES_SECRET=... \
  -e DO_SPACES_BUCKET=... \
  zippy-backend
```

## Database Migrations

### Adding New Columns/Tables

1. Edit `src/db/schema.ts`
2. Generate migration: `bunx drizzle-kit generate`
3. Review SQL in `drizzle/` folder
4. Apply: `bunx drizzle-kit push`

### Adding Unique Constraints

**CRITICAL**: Merge existing duplicates BEFORE applying unique constraint migrations!

```bash
# 1. Deploy code with dedup endpoints
# 2. Run dedup API calls to merge duplicates
# 3. Then apply migration
bunx drizzle-kit push
```

## Performance Notes

- **Connection Pool**: Configured with `idle_timeout=30s`, `max_lifetime=30min`, `connect_timeout=10s`
- **Unbounded Queries**: All list methods have safety limits (50K default)
- **SQL Aggregation**: Approval rates use GROUP BY instead of ORM iteration
- **Indexes**: Added for transaction filtering and payMethod lookups

## Troubleshooting

### Migration Errors
```bash
# Drop all tables (CAUTION: data loss)
bunx drizzle-kit drop

# Regenerate from scratch
bunx drizzle-kit generate
bunx drizzle-kit push
```

### Connection Issues
- Check DATABASE_URL format: `postgresql://user:pass@host:5432/dbname`
- Verify PostgreSQL is running: `pg_isready`
- Check Redis: `redis-cli ping`

### Job Queue Not Processing
- Ensure Redis is accessible
- Check worker logs for errors
- Verify `REDIS_URL` in worker process environment

## License

Private
