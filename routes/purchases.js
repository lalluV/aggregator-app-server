import express from "express";
import Stripe from "stripe";
import Property from "../models/Property.js";
import Purchase from "../models/Purchase.js";
import { authenticate, isUser, isCustomerOrAgency } from "../middleware/auth.js";

const router = express.Router();

const FEATURED_PLANS = [
  { days: 7, price: 9.99 },
  { days: 30, price: 29.99 },
  { days: 90, price: 79.99 },
  { days: 180, price: 139.99 },
  { days: 365, price: 249.99 },
];

const stripeSecretKey =
  process.env.STRIPE_SECRET_KEY || process.env.STRIPE_TEST_SECRET_KEY;
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

/** Map display symbols (A$, $, £, etc.) to Stripe's 3-letter ISO currency codes */
const CURRENCY_SYMBOL_TO_ISO = {
  $: "usd",
  "usd": "usd",
  "a$": "aud",
  "aud": "aud",
  "c$": "cad",
  "cad": "cad",
  "£": "gbp",
  "gbp": "gbp",
  "€": "eur",
  "eur": "eur",
  "inr": "inr",
  "₹": "inr",
};

function toStripeCurrency(prop) {
  if (!prop || typeof prop !== "string") return "usd";
  const normalized = prop.trim().toLowerCase();
  return CURRENCY_SYMBOL_TO_ISO[normalized] || (normalized.length === 3 ? normalized : "usd");
}

function requireStripe(req, res, next) {
  if (!stripe) {
    return res.status(503).json({
      message:
        "Stripe is not configured. Set STRIPE_SECRET_KEY or STRIPE_TEST_SECRET_KEY in .env",
    });
  }
  next();
}

/**
 * POST /api/purchases/create-checkout-session
 * Creates a Stripe Checkout Session for property purchase.
 * Returns { url } - redirect user to this URL to complete payment.
 */
router.post(
  "/create-checkout-session",
  authenticate,
  isUser,
  requireStripe,
  async (req, res) => {
    try {
      const { propertyId } = req.body;
      const userId = req.user._id;

      if (!propertyId) {
        return res.status(400).json({ message: "propertyId is required" });
      }

      const property = await Property.findById(propertyId);
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      if (property.soldOut) {
        return res.status(400).json({
          message: "This property has already been sold",
        });
      }

      const amountCents = Math.round(property.price * 100);
      const currency = toStripeCurrency(property.currency);

      if (amountCents < 50) {
        return res.status(400).json({
          message: "Minimum charge amount is $0.50 USD equivalent",
        });
      }

      const baseUrl =
        process.env.FRONTEND_URL ||
        process.env.APP_URL ||
        "https://safeaven.com";
      const successUrl = `${baseUrl}/purchase-success?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${baseUrl}/purchase-cancel`;

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency,
              unit_amount: amountCents,
              product_data: {
                name: property.title,
                description:
                  property.description?.slice(0, 500) ||
                  `${property.city}, ${property.country}`,
                images: property.photos?.length
                  ? [
                      typeof property.photos[0] === "string"
                        ? property.photos[0]
                        : property.photos[0]?.url,
                    ].filter(Boolean)
                  : undefined,
              },
            },
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        customer_email: req.user.email,
        metadata: {
          propertyId: property._id.toString(),
          buyerId: userId.toString(),
        },
      });

      await Purchase.create({
        property: property._id,
        buyer: userId,
        amount: property.price,
        currency,
        status: "pending",
        stripeSessionId: session.id,
        metadata: {
          propertyTitle: property.title,
          buyerEmail: req.user.email,
        },
      });

      res.json({ url: session.url });
    } catch (error) {
      console.error("Create checkout session error:", error);
      res.status(500).json({
        message: error.message || "Failed to create checkout session",
      });
    }
  }
);

/**
 * POST /api/purchases/create-featured-checkout-session
 * Creates Stripe Checkout Session for featured subscription.
 */
router.post(
  "/create-featured-checkout-session",
  authenticate,
  isCustomerOrAgency,
  requireStripe,
  async (req, res) => {
    try {
      const { propertyId, durationDays } = req.body;
      const userId = req.userType === "AGENCY" ? req.agency._id : req.user._id;

      if (!propertyId || !durationDays) {
        return res.status(400).json({
          message: "propertyId and durationDays are required",
        });
      }

      const plan = FEATURED_PLANS.find((p) => p.days === parseInt(durationDays));
      if (!plan) {
        return res.status(400).json({
          message: "Invalid duration. Valid: 7, 30, 90, 180, 365",
        });
      }

      const property = await Property.findById(propertyId);
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      const propertyOwnerId = (property.owner?._id || property.owner).toString();
      if (propertyOwnerId !== userId.toString()) {
        return res.status(403).json({
          message: "Not authorized. You can only feature your own properties.",
        });
      }

      const amountCents = Math.round(plan.price * 100);
      const baseUrl =
        process.env.FRONTEND_URL ||
        process.env.APP_URL ||
        "https://safeaven.com";
      const successUrl = `${baseUrl}/purchase-success?session_id={CHECKOUT_SESSION_ID}&type=featured`;
      const cancelUrl = `${baseUrl}/purchase-cancel`;

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: amountCents,
              product_data: {
                name: `Featured Listing: ${property.title}`,
                description: `${plan.days}-day featured subscription for your property in ${property.city}, ${property.country}`,
                images: property.photos?.length
                  ? [
                      typeof property.photos[0] === "string"
                        ? property.photos[0]
                        : property.photos[0]?.url,
                    ].filter(Boolean)
                  : undefined,
              },
            },
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        customer_email: req.user?.email || req.agency?.email,
        metadata: {
          type: "featured",
          propertyId: property._id.toString(),
          buyerId: userId.toString(),
          durationDays: String(plan.days),
        },
      });

      res.json({ url: session.url });
    } catch (error) {
      console.error("Create featured checkout session error:", error);
      res.status(500).json({
        message: error.message || "Failed to create checkout session",
      });
    }
  }
);

/**
 * POST /api/purchases/create-featured-payment-intent
 * Creates PaymentIntent for in-app Payment Sheet (React Native).
 * Returns { clientSecret }.
 */
router.post(
  "/create-featured-payment-intent",
  authenticate,
  isCustomerOrAgency,
  requireStripe,
  async (req, res) => {
    try {
      const { propertyId, durationDays } = req.body;
      const userId = req.userType === "AGENCY" ? req.agency._id : req.user._id;

      if (!propertyId || !durationDays) {
        return res.status(400).json({
          message: "propertyId and durationDays are required",
        });
      }

      const plan = FEATURED_PLANS.find((p) => p.days === parseInt(durationDays));
      if (!plan) {
        return res.status(400).json({
          message: "Invalid duration. Valid: 7, 30, 90, 180, 365",
        });
      }

      const property = await Property.findById(propertyId);
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      const propertyOwnerId = (property.owner?._id || property.owner).toString();
      if (propertyOwnerId !== userId.toString()) {
        return res.status(403).json({
          message: "Not authorized. You can only feature your own properties.",
        });
      }

      const amountCents = Math.round(plan.price * 100);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: "usd",
        automatic_payment_methods: { enabled: true },
        metadata: {
          type: "featured",
          propertyId: property._id.toString(),
          buyerId: userId.toString(),
          durationDays: String(plan.days),
        },
      });

      res.json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
      });
    } catch (error) {
      console.error("Create featured payment intent error:", error);
      res.status(500).json({
        message: error.message || "Failed to create payment intent",
      });
    }
  }
);

/**
 * POST /api/purchases/confirm-featured-payment
 * Confirms payment success and updates property immediately (avoids webhook delay).
 * Call after presentPaymentSheet succeeds.
 */
router.post(
  "/confirm-featured-payment",
  authenticate,
  isCustomerOrAgency,
  requireStripe,
  async (req, res) => {
    try {
      const { paymentIntentId } = req.body;

      if (!paymentIntentId) {
        return res.status(400).json({
          message: "paymentIntentId is required",
        });
      }

      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      const meta = paymentIntent.metadata || {};

      if (paymentIntent.status !== "succeeded") {
        return res.status(400).json({
          message: "Payment has not completed yet",
        });
      }

      if (meta.type !== "featured") {
        return res.status(400).json({
          message: "Invalid payment type",
        });
      }

      const propertyId = meta.propertyId;
      const durationDays = parseInt(meta.durationDays, 10) || 30;

      if (!propertyId) {
        return res.status(400).json({ message: "Invalid payment metadata" });
      }

      const property = await Property.findById(propertyId);
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      const userId = req.userType === "AGENCY" ? req.agency._id : req.user._id;
      const propertyOwnerId = (property.owner?._id || property.owner).toString();
      if (propertyOwnerId !== userId.toString()) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const expiryDate = new Date();
      if (property.featured && property.featuredUntil) {
        const currentExpiry = new Date(property.featuredUntil);
        if (currentExpiry > new Date()) {
          expiryDate.setTime(
            currentExpiry.getTime() + durationDays * 24 * 60 * 60 * 1000
          );
        } else {
          expiryDate.setDate(expiryDate.getDate() + durationDays);
        }
      } else {
        expiryDate.setDate(expiryDate.getDate() + durationDays);
      }

      property.featured = true;
      property.featuredUntil = expiryDate;
      await property.save();

      res.json({
        success: true,
        featured: true,
        featuredUntil: expiryDate.toISOString(),
      });
    } catch (error) {
      console.error("Confirm featured payment error:", error);
      res.status(500).json({
        message: error.message || "Failed to confirm payment",
      });
    }
  }
);

/**
 * POST /api/purchases/webhook
 * Stripe webhook - must use raw body for signature verification.
 */
export const handleWebhook = async (req, res) => {
  if (!stripe || !webhookSecret) {
    return res.status(503).json({ message: "Webhook not configured" });
  }

  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object;
    const meta = paymentIntent.metadata || {};

    try {
      if (meta.type === "featured") {
        const propertyId = meta.propertyId;
        const durationDays = parseInt(meta.durationDays, 10) || 30;

        if (propertyId) {
          const property = await Property.findById(propertyId);
          if (property) {
            const expiryDate = new Date();
            if (property.featured && property.featuredUntil) {
              const currentExpiry = new Date(property.featuredUntil);
              if (currentExpiry > new Date()) {
                expiryDate.setTime(
                  currentExpiry.getTime() + durationDays * 24 * 60 * 60 * 1000
                );
              } else {
                expiryDate.setDate(expiryDate.getDate() + durationDays);
              }
            } else {
              expiryDate.setDate(expiryDate.getDate() + durationDays);
            }
            property.featured = true;
            property.featuredUntil = expiryDate;
            await property.save();
            console.log(
              `Featured (PaymentIntent) completed for property ${propertyId}`
            );
          }
        }
      }
    } catch (err) {
      console.error("Webhook payment_intent.succeeded error:", err);
    }
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const meta = session.metadata || {};

    try {
      if (meta.type === "featured") {
        const propertyId = meta.propertyId;
        const durationDays = parseInt(meta.durationDays, 10) || 30;

        if (propertyId) {
          const property = await Property.findById(propertyId);
          if (property) {
            const expiryDate = new Date();
            if (property.featured && property.featuredUntil) {
              const currentExpiry = new Date(property.featuredUntil);
              if (currentExpiry > new Date()) {
                expiryDate.setTime(
                  currentExpiry.getTime() + durationDays * 24 * 60 * 60 * 1000
                );
              } else {
                expiryDate.setDate(expiryDate.getDate() + durationDays);
              }
            } else {
              expiryDate.setDate(expiryDate.getDate() + durationDays);
            }
            property.featured = true;
            property.featuredUntil = expiryDate;
            await property.save();
            console.log(`Featured subscription completed for property ${propertyId}`);
          }
        }
      } else {
        const purchase = await Purchase.findOne({
          stripeSessionId: session.id,
        });

        if (purchase && purchase.status === "pending") {
          purchase.status = "completed";
          purchase.completedAt = new Date();
          purchase.stripePaymentIntentId = session.payment_intent || undefined;
          await purchase.save();

          await Property.findByIdAndUpdate(purchase.property, {
            soldOut: true,
          });

          console.log(`Purchase completed: ${purchase._id} for property ${purchase.property}`);
        }
      }
    } catch (err) {
      console.error("Webhook processing error:", err);
    }
  }

  res.json({ received: true });
};

/**
 * GET /api/purchases/my
 * List purchases for the authenticated user.
 */
router.get("/my", authenticate, isUser, async (req, res) => {
  try {
    const userId = req.user._id;
    const purchases = await Purchase.find({ buyer: userId })
      .populate("property", "title city country photos price")
      .sort({ createdAt: -1 })
      .lean();

    res.json({ purchases });
  } catch (error) {
    console.error("List purchases error:", error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * GET /api/purchases/:id
 * Get a single purchase by ID (only if buyer).
 */
router.get("/:id", authenticate, isUser, async (req, res) => {
  try {
    const purchase = await Purchase.findById(req.params.id)
      .populate("property")
      .lean();

    if (!purchase) {
      return res.status(404).json({ message: "Purchase not found" });
    }

    const userId = req.user._id.toString();
    if (purchase.buyer?.toString?.() !== userId) {
      return res.status(403).json({ message: "Access denied" });
    }

    res.json({ purchase });
  } catch (error) {
    console.error("Get purchase error:", error);
    res.status(500).json({ message: error.message });
  }
});

export default router;
