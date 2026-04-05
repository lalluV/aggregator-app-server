import mongoose from "mongoose";

const directMessageSchema = new mongoose.Schema({
  directChat: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "DirectChat",
    required: true,
    index: true,
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: "senderModel",
    required: true,
  },
  senderModel: {
    type: String,
    enum: ["User", "Agency"],
    required: true,
  },
  messageType: {
    type: String,
    enum: ["text", "image", "file"],
    default: "text",
  },
  content: {
    type: String,
    required: function () {
      return this.messageType === "text";
    },
  },
  mediaUrl: {
    type: String,
    required: function () {
      return this.messageType === "image" || this.messageType === "file";
    },
  },
  fileName: {
    type: String,
  },
  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "DirectMessage",
  },
  isEdited: {
    type: Boolean,
    default: false,
  },
  isDeleted: {
    type: Boolean,
    default: false,
  },
  /** Set when recipient’s device is in the room (server relay). */
  deliveredAt: {
    type: Date,
    default: null,
  },
  /** Set when recipient marks messages seen (socket). */
  readAt: {
    type: Date,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

directMessageSchema.index({ directChat: 1, createdAt: -1 });

directMessageSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

export default mongoose.model("DirectMessage", directMessageSchema);
