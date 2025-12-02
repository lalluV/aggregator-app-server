import express from "express";
import Favorite from "../models/Favorite.js";
import Property from "../models/Property.js";
import { authenticate } from "../middleware/auth.js";

const router = express.Router();

// POST /api/favorites - Add property to favorites
router.post("/", authenticate, async (req, res) => {
  try {
    const { propertyId } = req.body;

    if (!propertyId) {
      return res.status(400).json({ message: "Property ID is required" });
    }

    // Check if property exists
    const property = await Property.findById(propertyId);
    if (!property) {
      return res.status(404).json({ message: "Property not found" });
    }

    // Check if already favorited
    const existing = await Favorite.findOne({
      user: req.user._id,
      property: propertyId,
    });

    if (existing) {
      return res.status(400).json({ message: "Property already in favorites" });
    }

    const favorite = await Favorite.create({
      user: req.user._id,
      property: propertyId,
    });

    await favorite.populate("property");

    res.status(201).json({
      message: "Property added to favorites",
      favorite,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// DELETE /api/favorites/:id - Remove from favorites
router.delete("/:id", authenticate, async (req, res) => {
  try {
    const favorite = await Favorite.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!favorite) {
      return res.status(404).json({ message: "Favorite not found" });
    }

    await Favorite.findByIdAndDelete(req.params.id);

    res.json({
      message: "Property removed from favorites",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// DELETE /api/favorites/property/:propertyId - Remove by property ID
router.delete("/property/:propertyId", authenticate, async (req, res) => {
  try {
    const favorite = await Favorite.findOneAndDelete({
      user: req.user._id,
      property: req.params.propertyId,
    });

    if (!favorite) {
      return res.status(404).json({ message: "Favorite not found" });
    }

    res.json({
      message: "Property removed from favorites",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/favorites - Get user's favorites
router.get("/", authenticate, async (req, res) => {
  try {
    const favorites = await Favorite.find({ user: req.user._id })
      .populate("property")
      .sort({ createdAt: -1 });

    res.json({
      count: favorites.length,
      favorites,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/favorites/check/:propertyId - Check if property is favorited
router.get("/check/:propertyId", authenticate, async (req, res) => {
  try {
    const favorite = await Favorite.findOne({
      user: req.user._id,
      property: req.params.propertyId,
    });

    res.json({
      isFavorited: !!favorite,
      favoriteId: favorite?._id,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
