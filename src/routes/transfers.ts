import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";

const router = Router();

const transferSchema = z
  .object({
    source_account_id: z.string().uuid(),
    destination_account_id: z.string().uuid(),
    amount: z
      .number()
      .finite()
      .positive()
      .refine(
        (value) => Number.isSafeInteger(value * 100),
        "Amount must have at most 2 decimal places",
      ),
    description: z.string().trim().min(1).max(500),
    reference_id: z.string().trim().min(1).max(100),
  })
  .strict();

router.post("/", async (req, res, next) => {
  const parsed = transferSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "Invalid transfer details",
      details: parsed.error.issues,
    });
  }

  const {
    source_account_id,
    destination_account_id,
    description,
    reference_id,
  } = parsed.data;

  const amount = new Prisma.Decimal(parsed.data.amount.toFixed(2));

  if (source_account_id === destination_account_id) {
    return res.status(400).json({
      error: "INVALID_TRANSFER",
      message: "Source and destination accounts must be different",
    });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const accounts = await tx.account.findMany({
        where: {
          id: {
            in: [source_account_id, destination_account_id],
          },
        },
        select: { id: true },
      });

      if (accounts.length !== 2) {
        return { error: "ACCOUNT_NOT_FOUND" as const };
      }

      const existing = await tx.transaction.findFirst({
        where: {
          referenceId: reference_id,
          accountId: {
            in: [source_account_id, destination_account_id],
          },
        },
      });

      if (existing) {
        return { error: "DUPLICATE_TRANSACTION" as const };
      }

      // Debit the source only if sufficient funds exist.
      const debit = await tx.account.updateMany({
        where: {
          id: source_account_id,
          balance: { gte: amount },
        },
        data: {
          balance: { decrement: amount },
        },
      });

      if (debit.count === 0) {
        return { error: "INSUFFICIENT_BALANCE" as const };
      }

      // Credit the destination in the same DB transaction.
      await tx.account.update({
        where: { id: destination_account_id },
        data: {
          balance: { increment: amount },
        },
      });

      // Record both sides of the transfer atomically.
      const debitTransaction = await tx.transaction.create({
        data: {
          accountId: source_account_id,
          type: "debit",
          amount,
          description,
          referenceId: reference_id,
        },
      });

      const creditTransaction = await tx.transaction.create({
        data: {
          accountId: destination_account_id,
          type: "credit",
          amount,
          description,
          referenceId: reference_id,
        },
      });

      const [source, destination] = await Promise.all([
        tx.account.findUniqueOrThrow({
          where: { id: source_account_id },
          select: { balance: true },
        }),
        tx.account.findUniqueOrThrow({
          where: { id: destination_account_id },
          select: { balance: true },
        }),
      ]);

      return {
        debitTransaction,
        creditTransaction,
        sourceBalance: source.balance.toString(),
        destinationBalance: destination.balance.toString(),
      };
    });

    if ("error" in result) {
      const errors = {
        ACCOUNT_NOT_FOUND: {
          status: 404,
          message: "Source or destination account does not exist",
        },
        DUPLICATE_TRANSACTION: {
          status: 409,
          message:
            "This reference ID has already been used for one of these accounts",
        },
        INSUFFICIENT_BALANCE: {
          status: 409,
          message: "Source account has insufficient balance",
        },
      };

      const error = errors[result.error as keyof typeof errors];

      return res.status(error.status).json({
        error: result.error,
        message: error.message,
      });
    }

    return res.status(201).json({
      message: "Transfer completed successfully",
      data: {
        reference_id,
        amount: amount.toString(),
        source_account_id,
        destination_account_id,
        source_balance: result.sourceBalance,
        destination_balance: result.destinationBalance,
        transactions: [result.debitTransaction, result.creditTransaction],
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return res.status(409).json({
        error: "DUPLICATE_TRANSACTION",
        message:
          "This reference ID has already been used for one of these accounts",
      });
    }

    next(error);
  }
});

export default router;
