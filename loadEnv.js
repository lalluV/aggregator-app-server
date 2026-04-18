/**
 * Must be imported first from server.js so process.env is populated before any
 * other module reads env at load time (e.g. utils/emailjs.js).
 * Uses server/.env regardless of process.cwd().
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });
