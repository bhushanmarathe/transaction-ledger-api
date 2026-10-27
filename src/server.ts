import * as dotenv from "dotenv";
import app from "./app";
import { prisma } from "./lib/prisma";

dotenv.config();

const port = Number(process.env.PORT) || 5000;

async function startServer() {
  try {
    await prisma.$connect();

    app.listen(port, () => {
      console.log(`Server running at http://localhost:${port}`);
    });
  } catch (error) {
    console.error("Failed to connect to the database:", error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

startServer();
