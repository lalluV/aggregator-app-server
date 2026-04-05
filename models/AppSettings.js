import mongoose from "mongoose";

const appSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "app" },
    featuredPlans: [
      {
        days: { type: Number, required: true },
        mrp: { type: Number },
        price: { type: Number, required: true },
      },
    ],
  },
  { collection: "appsettings" },
);

const AppSettings = mongoose.model("AppSettings", appSettingsSchema);

export default AppSettings;

export const DEFAULT_FEATURED_PLANS = [
  { days: 7, mrp: 14.99, price: 9.99 },
  { days: 30, mrp: 39.99, price: 29.99 },
  { days: 90, mrp: 99.99, price: 79.99 },
  { days: 180, mrp: 199.99, price: 139.99 },
  { days: 365, mrp: 299.99, price: 249.99 },
];

export async function getFeaturedPlansFromDb() {
  const doc = await AppSettings.findById("app").lean();
  if (
    doc?.featuredPlans?.length &&
    doc.featuredPlans.every((p) => p.days && p.price >= 0)
  ) {
    return doc.featuredPlans.map((p) => ({
      days: p.days,
      mrp: p.mrp || p.price,
      price: p.price,
    }));
  }
  return DEFAULT_FEATURED_PLANS;
}
