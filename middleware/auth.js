import User from "../models/User.js";
import Agency from "../models/Agency.js";

export const authenticate = async (req, res, next) => {
  try {
    // Get user ID and email from headers (sent by frontend)
    const userId = req.headers["x-user-id"];
    const userEmail = req.headers["x-user-email"];
    const userType = req.headers["x-user-type"]; // "USER", "ADMIN", or "AGENCY"

    if (!userId || !userEmail) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    if (userType === "AGENCY") {
      const agency = await Agency.findById(userId).select("-passwordHash");
      if (!agency || agency.email !== userEmail) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      req.agency = agency;
      req.userType = "AGENCY";
    } else {
      // USER or ADMIN
      const user = await User.findById(userId).select("-passwordHash");
      if (!user || user.email !== userEmail) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      req.user = user;
      req.userType = user.role === "ADMIN" ? "ADMIN" : "USER";
    }

    next();
  } catch (error) {
    return res.status(401).json({ message: "Authentication failed" });
  }
};

export const isAdmin = (req, res, next) => {
  if (req.userType !== "ADMIN") {
    return res.status(403).json({ message: "Admin access required" });
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
