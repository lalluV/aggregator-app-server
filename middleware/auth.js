import mongoose from "mongoose";
import User from "../models/User.js";
import Agency from "../models/Agency.js";

export const authenticate = async (req, res, next) => {
  try {
    // Get user ID and email from headers (sent by frontend)
    const userId = req.headers["x-user-id"];
    const userEmail = req.headers["x-user-email"];
    const userType = req.headers["x-user-type"]; // "USER", "ADMIN", or "AGENCY"

    if (!userId || !userEmail) {
      console.error("Missing auth headers:", {
        userId: !!userId,
        userEmail: !!userEmail,
        userType,
        url: req.url,
        method: req.method,
      });
      return res.status(401).json({ message: "Not authenticated" });
    }

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.error("Invalid user ID format:", userId);
      return res.status(401).json({ message: "Invalid user ID format" });
    }

    if (userType === "AGENCY") {
      const agency = await Agency.findById(userId).select("-passwordHash");
      if (!agency) {
        console.error("Agency not found:", userId);
        return res.status(401).json({ message: "Agency not found" });
      }
      if (agency.email !== userEmail) {
        console.error("Email mismatch:", { agencyEmail: agency.email, providedEmail: userEmail });
        return res.status(401).json({ message: "Invalid credentials" });
      }
      req.agency = agency;
      req.userType = "AGENCY";
    } else {
      // USER or ADMIN
      const user = await User.findById(userId).select("-passwordHash");
      if (!user) {
        console.error("User not found:", userId);
        return res.status(401).json({ message: "User not found" });
      }
      if (user.email !== userEmail) {
        console.error("Email mismatch:", { userEmail: user.email, providedEmail: userEmail });
        return res.status(401).json({ message: "Invalid credentials" });
      }
      req.user = user;
      // Set userType based on actual role from database
      req.userType = user.role === "ADMIN" ? "ADMIN" : "USER";
    }

    next();
  } catch (error) {
    console.error("Authentication error:", error);
    return res.status(401).json({ message: "Authentication failed", error: error.message });
  }
};

export const isAdmin = (req, res, next) => {
  if (!req.userType) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  if (req.userType !== "ADMIN") {
    console.error("Admin check failed:", {
      userType: req.userType,
      userRole: req.user?.role,
      userId: req.user?._id,
      userEmail: req.user?.email,
    });
    return res.status(403).json({ 
      message: "Admin access required",
      userType: req.userType,
      userRole: req.user?.role 
    });
  }
  next();
};

export const isAgency = (req, res, next) => {
  if (req.userType !== "AGENCY") {
    return res.status(403).json({ message: "Agency access required" });
  }
  next();
};

export const isCustomerOrAgency = (req, res, next) => {
  if (req.userType !== "USER" && req.userType !== "AGENCY") {
    return res
      .status(403)
      .json({ message: "Customer or Agency access required" });
  }
  next();
};

/** Only regular users (or admin) can purchase - agencies list properties, users buy them */
export const isUser = (req, res, next) => {
  if (req.userType !== "USER" && req.userType !== "ADMIN") {
    return res.status(403).json({ message: "User account required to purchase" });
  }
  next();
};
