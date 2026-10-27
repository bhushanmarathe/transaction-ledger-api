import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";

const router = Router();

const createAccountSchema = z
  .object({
    name: z.string().trim().min(1, "Account name is required").max(100),
  })
  .strict();

router.post("/", async (req, res, next) => {
  try {
    const parsed = createAccountSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "Invalid account details",
        details: parsed.error.issues,
      });
    }

    const account = await prisma.account.create({
      data: { name: parsed.data.name },
    });

    return res.status(201).json({
      message: "Account created successfully",
      data: account,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:id/balance", async (req, res, next) => {
  try {
    const account = await prisma.account.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        balance: true,
      },
    });

    if (!account) {
      return res.status(404).json({
        error: "ACCOUNT_NOT_FOUND",
        message: "Account does not exist",
      });
    }

    return res.status(200).json({
      account_id: account.id,
      balance: account.balance.toString(),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
