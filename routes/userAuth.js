import express from "express";
import bcrypt from "bcrypt";
import User from "../models/User.js";
import { authenticate } from "../middleware/auth.js";

const router = express.Router();

// POST /api/users/register
router.post("/register", async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    // Validation
    if (!name || !email || !phone || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email already registered" });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const user = await User.create({
      name,
      email,
      phone,
      passwordHash,
      role: "CUSTOMER",
    });

    // Return user data (no tokens, no cookies)
    res.status(201).json({
      message: "User registered successfully",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/users/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Return user data (no tokens, no cookies)
    res.json({
      message: "Login successful",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/users/profile/:id - Get user profile (for chat, group members)
router.get("/profile/:id", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("name email").lean();
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json({ user: { ...user, _id: user._id } });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/users/me
router.get("/me", authenticate, async (req, res) => {
  try {
    res.json({
      user: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        phone: req.user.phone,
        role: req.user.role,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PATCH /api/users/profile - Update own profile (name, phone)
router.patch("/profile", authenticate, async (req, res) => {
  try {
    const { name, phone } = req.body;
    const updateData = {};
    if (name !== undefined && String(name).trim()) updateData.name = String(name).trim();
    if (phone !== undefined) updateData.phone = String(phone).trim();
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: "No valid fields to update" });
    }
    const user = await User.findByIdAndUpdate(
      req.user._id,
      updateData,
      { new: true, runValidators: true }
    );
    res.json({
      message: "Profile updated successfully",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/users/logout
router.post("/logout", (req, res) => {
  res.json({ message: "Logged out successfully" });
});

export default router;
