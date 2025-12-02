import express from "express";
import Country from "../models/Country.js";

const router = express.Router();

// GET /api/countries - List all countries (public)
router.get("/", async (req, res) => {
  try {
    const countries = await Country.find().sort({ name: 1 });
    res.json({ count: countries.length, countries });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
