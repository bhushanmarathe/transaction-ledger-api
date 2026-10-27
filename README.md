# Transaction Ledger API

A REST API built with Node.js, Express, TypeScript, PostgreSQL, and Prisma 6 to manage accounts, credit and debit transactions, balances, transaction history, and money transfers.

## Features

- Create accounts with an initial balance of zero.
- Add credit and debit transactions.
- Prevent debits when funds are insufficient.
- Prevent duplicate transaction references within the same account.
- Retrieve account balances.
- Retrieve transaction history with filtering, pagination, and latest-first sorting.
- Transfer money between accounts atomically.
- Validate incoming requests and return consistent error responses.
- Automated tests using Vitest and Supertest.

## Tech Stack

- Node.js
- Express.js
- TypeScript
- PostgreSQL
- Prisma ORM 6
- Zod
- Vitest
- Supertest

## Prerequisites

Install the following:

- Node.js and npm
- PostgreSQL
- Git (optional)

## Installation

Clone the repository or download the source code, then navigate to the project directory.

```bash
npm install
```

Create a PostgreSQL database named `transaction_ledger`.

Create a `.env` file in the project root:

```env
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/transaction_ledger?schema=public"
PORT=5000
```

Replace `YOUR_PASSWORD` with your PostgreSQL password.

Generate the Prisma client and synchronize the database schema:

```bash
npx prisma generate
npx prisma db push
```

Start the development server:

```bash
npm run dev
```

The server runs at `http://localhost:5000`.

Health check:

```http
GET /health
```

Expected response:

```json
{
  "status": "ok"
}
```

## API Documentation

Base URL: `http://localhost:5000`

### 1. Create an Account

**Endpoint:** `POST /api/accounts`

Request body:

```json
{
  "name": "Alice"
}
```

Success response: `201 Created`

The response includes the generated account ID, account name, zero balance, and creation timestamp.

The client cannot set the initial balance.

### 2. Add a Transaction

**Endpoint:** `POST /api/accounts/:id/transactions`

Example credit request:

```json
{
  "type": "credit",
  "amount": 100,
  "description": "Initial deposit",
  "reference_id": "REF-001"
}
```

Example debit request:

```json
{
  "type": "debit",
  "amount": 30,
  "description": "Cash withdrawal",
  "reference_id": "REF-002"
}
```

A successful transaction returns `201 Created` and includes the transaction details and updated balance.

A debit is rejected if the account has insufficient funds.

Duplicate references within the same account return `409 Conflict`.

### 3. Get Account Balance

**Endpoint:** `GET /api/accounts/:id/balance`

Example:

```http
GET /api/accounts/ACCOUNT_UUID/balance
```

Example response:

```json
{
  "account_id": "ACCOUNT_UUID",
  "balance": "70.00"
}
```

A nonexistent account returns `404 Not Found`.

### 4. Get Transaction History

**Endpoint:** `GET /api/accounts/:id/transactions`

Supported query parameters:

| Parameter | Description                     | Default   |
| --------- | ------------------------------- | --------- |
| `type`    | Filter by `credit` or `debit`   | All types |
| `page`    | Page number, starting at 1      | 1         |
| `limit`   | Records per page, from 1 to 100 | 10        |

Example:

```http
GET /api/accounts/ACCOUNT_UUID/transactions?type=credit&page=1&limit=10
```

Transactions are sorted by creation timestamp in descending order, with transaction ID used as a secondary sort key.

The response contains the transaction records and pagination metadata, including current page, page size, total records, and total pages.

### 5. Transfer Money

**Endpoint:** `POST /api/transfers`

Request body:

```json
{
  "source_account_id": "SOURCE_ACCOUNT_UUID",
  "destination_account_id": "DESTINATION_ACCOUNT_UUID",
  "amount": 30,
  "description": "Transfer to another account",
  "reference_id": "TRANSFER-001"
}
```

A successful transfer returns `201 Created`, including both transaction records and updated balances.

The source account is debited and the destination account is credited within a single database transaction. If an operation fails, the database transaction is rolled back.

The reference ID must not already exist on either account involved in the transfer.

## Error Handling

The API returns structured JSON errors with appropriate HTTP status codes.

| Status                      | Meaning                                                                  |
| --------------------------- | ------------------------------------------------------------------------ |
| `400 Bad Request`           | Invalid request body, amount, transaction type, or pagination parameters |
| `404 Not Found`             | Account does not exist                                                   |
| `409 Conflict`              | Duplicate transaction reference or insufficient funds                    |
| `500 Internal Server Error` | Unexpected server error                                                  |

## Data Integrity

- Account IDs and transaction IDs are generated by the system.
- Initial account balances default to zero.
- Transaction references are unique per account using a database constraint.
- Account balances are updated in the same database transaction as transaction creation.
- Money transfers update both accounts and create both transaction records atomically.
- Transactions have no edit or delete endpoints.
- Monetary values use PostgreSQL `DECIMAL(18,2)`.

## Running Tests

Run the automated test suite:

```bash
npm test
```

The tests cover account creation, initial balance validation, credits, insufficient-funds rejection, duplicate references, successful transfers, failed transfers, transaction sorting, and edit/delete request rejection.

**Important:** The current test setup deletes account and transaction records during test setup and cleanup. Use a separate test database and configure the test environment to use it before running tests. Never run these tests against a database containing important data.

## Assumptions

1. Every account starts with a balance of zero.
2. Transaction amounts must be positive and have no more than two decimal places.
3. Account names and transaction descriptions are required.
4. Reference IDs must be unique within an account, not globally.
5. A rejected transaction must not change the account balance or create a transaction record.
6. A transfer creates a debit record for the source account and a credit record for the destination account.
7. Transactions are immutable through the public API.
8. Pagination defaults to page 1 with 10 records and supports a maximum page size of 100.
9. Balances and transaction amounts are stored as decimal values to avoid floating-point money calculations.

## Future Improvements

- Add authentication and authorization.
- Add database-level enforcement of transaction immutability.
- Improve automated test isolation and execution speed.
- Add concurrency and stress tests.
- Add structured logging and monitoring.
- Add API schema documentation using OpenAPI/Swagger.
