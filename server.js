import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import { connectDB } from "./config/db.js";
import { cleanupExpiredFeatured } from "./utils/featuredCleanup.js";

// Import routes
import userAuthRoutes from "./routes/userAuth.js";
import agencyAuthRoutes from "./routes/agencyAuth.js";
import agencyRoutes from "./routes/agencies.js";
import propertyRoutes from "./routes/properties.js";
import adminRoutes from "./routes/admin.js";
import uploadRoutes from "./routes/upload.js";
import favoriteRoutes from "./routes/favorites.js";
import countryRoutes from "./routes/countries.js";
import partnerRoutes from "./routes/partners.js";

// Load env variables
dotenv.config();

// Connect to database
connectDB();

// Initialize express
const app = express();

// Middleware
app.use(morgan("dev"));
app.use(
  cors({
    origin: [
      "http://localhost:3000", // Web frontend
      "http://localhost:3001", // Admin panel
      "https://safeaven.com",
      "https://admin.safeaven.com",
      "https://www.safeaven.com",
      "https://www.admin.safeaven.com",
      process.env.CORS_ORIGIN,
    ].filter(Boolean),
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Routes
app.get("/", (req, res) => {
  res.json({ message: "Aggregator API is running" });
});

app.use("/api/users", userAuthRoutes);
app.use("/api/agencies", agencyAuthRoutes);
app.use("/api/agencies", agencyRoutes);
app.use("/api/properties", propertyRoutes);
app.use("/api/my", propertyRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/favorites", favoriteRoutes);
app.use("/api/countries", countryRoutes);
app.use("/api/partners", partnerRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Something went wrong!" });
});

// Start server
const PORT = process.env.PORT || 3005;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);

  // Run cleanup on startup
  cleanupExpiredFeatured().catch(console.error);

  // Run cleanup every 12 hours
  setInterval(() => {
    cleanupExpiredFeatured().catch(console.error);
  }, 12 * 60 * 60 * 1000); // 12 hours in milliseconds
});
