import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import request from "supertest";
import app from "../src/app";
import { prisma } from "../src/lib/prisma";

let accountA: string;
let accountB: string;

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  // Remove previous test data in foreign-key-safe order.
  await prisma.transaction.deleteMany();
  await prisma.account.deleteMany();

  const a = await prisma.account.create({
    data: { name: "Alice" },
  });

  const b = await prisma.account.create({
    data: { name: "Bob" },
  });

  accountA = a.id;
  accountB = b.id;
});

afterAll(async () => {
  await prisma.transaction.deleteMany();
  await prisma.account.deleteMany();
  await prisma.$disconnect();
});

describe("Transaction Ledger API", () => {
  it("creates an account with zero balance", async () => {
    const response = await request(app)
      .post("/api/accounts")
      .send({ name: "Charlie" });

    expect(response.status).toBe(201);
    expect(response.body.data.name).toBe("Charlie");
    expect(Number(response.body.data.balance)).toBe(0);
  });

  it("rejects a client-supplied initial balance", async () => {
    const response = await request(app)
      .post("/api/accounts")
      .send({ name: "Charlie", balance: 500 });

    expect(response.status).toBe(400);
  });

  it("credits an account and updates its balance", async () => {
    const response = await request(app)
      .post(`/api/accounts/${accountA}/transactions`)
      .send({
        type: "credit",
        amount: 100,
        description: "Deposit",
        reference_id: "TEST-CREDIT-1",
      });

    expect(response.status).toBe(201);

    const balance = await request(app).get(`/api/accounts/${accountA}/balance`);

    expect(Number(balance.body.balance)).toBe(100);
  });

  it("rejects a debit when the balance is insufficient", async () => {
    const response = await request(app)
      .post(`/api/accounts/${accountA}/transactions`)
      .send({
        type: "debit",
        amount: 50,
        description: "Withdrawal",
        reference_id: "TEST-DEBIT-1",
      });

    expect(response.status).toBe(409);

    const balance = await request(app).get(`/api/accounts/${accountA}/balance`);

    expect(Number(balance.body.balance)).toBe(0);

    const history = await request(app).get(
      `/api/accounts/${accountA}/transactions`,
    );

    expect(history.body.pagination.total_records).toBe(0);
  });

  it("rejects duplicate transaction references", async () => {
    const body = {
      type: "credit",
      amount: 100,
      description: "Deposit",
      reference_id: "DUPLICATE-1",
    };

    const first = await request(app)
      .post(`/api/accounts/${accountA}/transactions`)
      .send(body);

    const second = await request(app)
      .post(`/api/accounts/${accountA}/transactions`)
      .send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);

    const balance = await request(app).get(`/api/accounts/${accountA}/balance`);

    expect(Number(balance.body.balance)).toBe(100);
  });

  it("transfers money between accounts atomically", async () => {
    await request(app).post(`/api/accounts/${accountA}/transactions`).send({
      type: "credit",
      amount: 100,
      description: "Initial deposit",
      reference_id: "TRANSFER-SETUP",
    });

    const transfer = await request(app).post("/api/transfers").send({
      source_account_id: accountA,
      destination_account_id: accountB,
      amount: 30,
      description: "Transfer",
      reference_id: "TRANSFER-TEST-1",
    });

    expect(transfer.status).toBe(201);

    const source = await request(app).get(`/api/accounts/${accountA}/balance`);

    const destination = await request(app).get(
      `/api/accounts/${accountB}/balance`,
    );

    expect(Number(source.body.balance)).toBe(70);
    expect(Number(destination.body.balance)).toBe(30);
  }, 20000);

  it("rejects an overdrawn transfer without changing either account", async () => {
    await request(app)
      .post(`/api/accounts/${accountA}/transactions`)
      .send({
        type: "credit",
        amount: 20,
        description: "Initial deposit",
        reference_id: "FAILED-TRANSFER-SETUP",
      })
      .expect(201);

    const transfer = await request(app).post("/api/transfers").send({
      source_account_id: accountA,
      destination_account_id: accountB,
      amount: 30,
      description: "Transfer exceeding balance",
      reference_id: "FAILED-TRANSFER-001",
    });

    expect(transfer.status).toBe(409);

    const sourceBalance = await request(app).get(
      `/api/accounts/${accountA}/balance`,
    );

    const destinationBalance = await request(app).get(
      `/api/accounts/${accountB}/balance`,
    );

    expect(Number(sourceBalance.body.balance)).toBe(20);
    expect(Number(destinationBalance.body.balance)).toBe(0);

    const destinationHistory = await request(app).get(
      `/api/accounts/${accountB}/transactions`,
    );

    expect(destinationHistory.body.pagination.total_records).toBe(0);
  }, 30000);

  it("returns transactions in latest-first order", async () => {
    await request(app)
      .post(`/api/accounts/${accountA}/transactions`)
      .send({
        type: "credit",
        amount: 10,
        description: "First deposit",
        reference_id: "SORT-001",
      })
      .expect(201);

    await request(app)
      .post(`/api/accounts/${accountA}/transactions`)
      .send({
        type: "credit",
        amount: 20,
        description: "Second deposit",
        reference_id: "SORT-002",
      })
      .expect(201);

    const response = await request(app).get(
      `/api/accounts/${accountA}/transactions`,
    );

    expect(response.status).toBe(200);
    expect(response.body.data.length).toBe(2);
    expect(response.body.data[0].reference_id).toBe("SORT-002");
    expect(response.body.data[1].reference_id).toBe("SORT-001");
  }, 30000);

  it("does not allow transactions to be edited or deleted", async () => {
    const created = await request(app)
      .post(`/api/accounts/${accountA}/transactions`)
      .send({
        type: "credit",
        amount: 50,
        description: "Immutable deposit",
        reference_id: "IMMUTABLE-001",
      });

    expect(created.status).toBe(201);

    const transactionId = created.body.data.id;

    const editResponse = await request(app)
      .put(`/api/accounts/${accountA}/transactions/${transactionId}`)
      .send({ amount: 500 });

    const deleteResponse = await request(app).delete(
      `/api/accounts/${accountA}/transactions/${transactionId}`,
    );

    expect(editResponse.status).toBeGreaterThanOrEqual(400);
    expect(deleteResponse.status).toBeGreaterThanOrEqual(400);

    const history = await request(app).get(
      `/api/accounts/${accountA}/transactions`,
    );

    expect(history.body.pagination.total_records).toBe(1);
    expect(history.body.data[0].amount).toBe("50");
    expect(history.body.data[0].reference_id).toBe("IMMUTABLE-001");
  });

  it("prevents concurrent debits from overspending an account", async () => {
    await request(app)
      .post(`/api/accounts/${accountA}/transactions`)
      .send({
        type: "credit",
        amount: 100,
        description: "Initial deposit",
        reference_id: "CONCURRENT-SETUP",
      })
      .expect(201);

    const debitRequest = (reference_id: string) =>
      request(app).post(`/api/accounts/${accountA}/transactions`).send({
        type: "debit",
        amount: 80,
        description: "Concurrent withdrawal",
        reference_id,
      });

    const results = await Promise.all([
      debitRequest("CONCURRENT-DEBIT-1"),
      debitRequest("CONCURRENT-DEBIT-2"),
    ]);

    const successful = results.filter((response) => response.status === 201);

    const rejected = results.filter((response) => response.status === 409);

    expect(successful).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const balance = await request(app).get(`/api/accounts/${accountA}/balance`);

    expect(Number(balance.body.balance)).toBe(20);

    const history = await request(app).get(
      `/api/accounts/${accountA}/transactions`,
    );

    expect(history.body.pagination.total_records).toBe(2);
  });
});
