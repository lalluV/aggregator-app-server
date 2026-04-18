import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  phone: {
    type: String,
    required: true,
  },
  passwordHash: {
    type: String,
    required: true,
  },
  resetPasswordTokenHash: {
    type: String,
    default: null,
  },
  resetPasswordExpiresAt: {
    type: Date,
    default: null,
  },
  role: {
    type: String,
    default: "CUSTOMER",
    enum: ["CUSTOMER", "ADMIN"],
  },
  fcmTokens: [
    {
      token: { type: String, required: true },
      platform: { type: String, enum: ["android", "ios"], default: "android" },
      updatedAt: { type: Date, default: Date.now },
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model("User", userSchema);
