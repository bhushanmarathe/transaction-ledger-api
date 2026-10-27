import express from "express";
import accountsRouter from "./routes/accounts";
import transactionsRouter from "./routes/transactions";
import transfersRouter from "./routes/transfers";

const app = express();

app.use(express.json({ limit: "100kb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/api/accounts", accountsRouter);
app.use("/api/accounts", transactionsRouter);
app.use("/api/transfers", transfersRouter);

// Handle invalid JSON and unexpected errors.
app.use(
  (
    err: Error & { status?: number; type?: string },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (err.type === "entity.parse.failed") {
      return res.status(400).json({
        error: "INVALID_JSON",
        message: "Request body contains invalid JSON",
      });
    }

    console.error(err);

    return res.status(500).json({
      error: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred",
    });
  },
);

export default app;
