import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";

const router = Router();

const transactionSchema = z
  .object({
    type: z.enum(["credit", "debit"]),
    amount: z.coerce
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

router.post("/:id/transactions", async (req, res, next) => {
  const parsed = transactionSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "Invalid transaction details",
      details: parsed.error.issues,
    });
  }

  const { type, description, reference_id } = parsed.data;
  const amount = parsed.data.amount.toFixed(2);
  const accountId = req.params.id;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const account = await tx.account.findUnique({
        where: { id: accountId },
        select: { id: true },
      });

      if (!account) {
        return { error: "ACCOUNT_NOT_FOUND" as const };
      }

      const existing = await tx.transaction.findUnique({
        where: {
          accountId_referenceId: {
            accountId,
            referenceId: reference_id,
          },
        },
      });

      if (existing) {
        return { error: "DUPLICATE_TRANSACTION" as const };
      }

      const amountDecimal = new Prisma.Decimal(amount);

      const updated = await tx.account.updateMany({
        where: {
          id: accountId,
          ...(type === "debit" ? { balance: { gte: amountDecimal } } : {}),
        },
        data: {
          balance:
            type === "credit"
              ? { increment: amountDecimal }
              : { decrement: amountDecimal },
        },
      });

      if (updated.count === 0) {
        return { error: "INSUFFICIENT_BALANCE" as const };
      }

      const transaction = await tx.transaction.create({
        data: {
          accountId,
          type,
          amount: amountDecimal,
          description,
          referenceId: reference_id,
        },
      });

      const updatedAccount = await tx.account.findUniqueOrThrow({
        where: { id: accountId },
        select: { balance: true },
      });

      return {
        transaction,
        balance: updatedAccount.balance.toString(),
      };
    });

    if ("error" in result) {
      const responses = {
        ACCOUNT_NOT_FOUND: {
          status: 404,
          message: "Account does not exist",
        },
        DUPLICATE_TRANSACTION: {
          status: 409,
          message: "This reference ID has already been used for this account",
        },
        INSUFFICIENT_BALANCE: {
          status: 409,
          message: "Insufficient account balance",
        },
      };

      const response = responses[result.error as keyof typeof responses];

      return res.status(response.status).json({
        error: result.error,
        message: response.message,
      });
    }

    return res.status(201).json({
      message: "Transaction created successfully",
      data: {
        ...result.transaction,
        account_id: result.transaction.accountId,
        reference_id: result.transaction.referenceId,
        created_at: result.transaction.createdAt,
        balance: result.balance,
      },
    });
  } catch (error) {
    // Protect against concurrent requests using the same reference ID.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return res.status(409).json({
        error: "DUPLICATE_TRANSACTION",
        message: "This reference ID has already been used for this account",
      });
    }

    next(error);
  }
});

const historyQuerySchema = z.object({
  type: z.enum(["credit", "debit"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

router.get("/:id/transactions", async (req, res, next) => {
  const parsed = historyQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "Invalid pagination or filter parameters",
      details: parsed.error.issues,
    });
  }

  try {
    const { type, page, limit } = parsed.data;
    const accountId = req.params.id;

    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true },
    });

    if (!account) {
      return res.status(404).json({
        error: "ACCOUNT_NOT_FOUND",
        message: "Account does not exist",
      });
    }

    const where: Prisma.TransactionWhereInput = {
      accountId,
      ...(type ? { type } : {}),
    };

    const [transactions, totalRecords] = await prisma.$transaction([
      prisma.transaction.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.transaction.count({ where }),
    ]);

    return res.status(200).json({
      data: transactions.map((transaction) => ({
        ...transaction,
        account_id: transaction.accountId,
        reference_id: transaction.referenceId,
        created_at: transaction.createdAt,
      })),
      pagination: {
        current_page: page,
        page_size: limit,
        total_records: totalRecords,
        total_pages: Math.ceil(totalRecords / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
