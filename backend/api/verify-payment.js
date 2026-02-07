import crypto from "crypto";

export default async function handler(req, res) {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  const body = razorpay_order_id + "|" + razorpay_payment_id;

  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest("hex");

  if (expectedSignature === razorpay_signature) {
    // Create simple one-time token
    const token = crypto.randomBytes(16).toString("hex");

    // In real apps, store token in DB (for now, pass to frontend)
    res.status(200).json({ success: true, token });
  } else {
    res.status(400).json({ success: false });
  }
}
