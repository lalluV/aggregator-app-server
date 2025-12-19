import Property from "../models/Property.js";

/**
 * Clean up expired featured properties
 * Sets featured: false for properties where featuredUntil has passed
 * @returns {Promise<{updated: number, properties: Array}>}
 */
export async function cleanupExpiredFeatured() {
  try {
    const now = new Date();

    // Find all properties that are featured but have expired
    const expiredProperties = await Property.find({
      featured: true,
      featuredUntil: { $lt: now },
    });

    if (expiredProperties.length === 0) {
      return { updated: 0, properties: [] };
    }

    // Update all expired properties
    const result = await Property.updateMany(
      {
        featured: true,
        featuredUntil: { $lt: now },
      },
      {
        $set: {
          featured: false,
          featuredUntil: null,
        },
      }
    );

    console.log(
      `✅ Cleaned up ${result.modifiedCount} expired featured properties`
    );

    return {
      updated: result.modifiedCount,
      properties: expiredProperties.map((p) => ({
        id: p._id,
        title: p.title,
        expiredAt: p.featuredUntil,
      })),
    };
  } catch (error) {
    console.error("Error cleaning up expired featured properties:", error);
    throw error;
  }
}

/**
 * Check if a property's featured status has expired
 * @param {Object} property - Property object
 * @returns {boolean}
 */
export function isFeaturedExpired(property) {
  if (!property.featured || !property.featuredUntil) {
    return false;
  }
  return new Date(property.featuredUntil) < new Date();
}

/**
 * Automatically clean up expired featured properties when fetching
 * This ensures data consistency without requiring a separate cron job
 */
export async function ensureFeaturedStatus(property) {
  if (isFeaturedExpired(property)) {
    property.featured = false;
    property.featuredUntil = null;
    await property.save();
    return true; // Indicates it was updated
  }
  return false;
}
