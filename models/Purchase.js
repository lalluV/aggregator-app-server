import mongoose from "mongoose";

const purchaseSchema = new mongoose.Schema({
  property: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Property",
    required: true,
  },
  buyer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  currency: {
    type: String,
    default: "usd",
    lowercase: true,
  },
  status: {
    type: String,
    enum: ["pending", "completed", "failed", "canceled"],
    default: "pending",
  },
  stripeSessionId: {
    type: String,
    trim: true,
  },
  stripePaymentIntentId: {
    type: String,
    trim: true,
    sparse: true,
  },
  metadata: {
    propertyTitle: { type: String },
    buyerEmail: { type: String },
  },
  completedAt: {
    type: Date,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

purchaseSchema.index({ property: 1 });
purchaseSchema.index({ buyer: 1 });
purchaseSchema.index({ stripeSessionId: 1 });
purchaseSchema.index({ status: 1 });

export default mongoose.model("Purchase", purchaseSchema);
