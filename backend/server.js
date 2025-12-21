const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');
const nodemailer = require('nodemailer');
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware
app.use(express.json());
// Root health check
app.get('/', (req, res) => {
    res.json({ 
        status: 'Server is running',
        timestamp: new Date().toISOString()
    });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'Server is running',
        timestamp: new Date().toISOString()
    });
});

// CORS Configuration - Allow your Netlify domain
const allowedOrigins = [
    'https://bloomwithanjli.netlify.app',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
];

app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (mobile apps, curl, etc)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) === -1) {
            return callback(null, true); // Allow all for now
        }
        return callback(null, true);
    },
    methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true,
    optionsSuccessStatus: 200
}));

// Handle preflight requests explicitly
app.options('*', cors());

// Handle preflight requests
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Serve static files from frontend
app.use(express.static(path.join(__dirname, '../docs')));

// Initialize Razorpay
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Email transporter (optional)
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

// ============= ROUTES =============

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Server is running' });
});

// Create Razorpay Order
app.post('/api/create-order', async (req, res) => {
    // Add CORS headers explicitly
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    try {
        console.log('=== Create Order Request ===');
        console.log('Origin:', req.headers.origin);
        console.log('Body:', req.body);
        
        const { amount, email } = req.body;

        // Validate request
        if (!amount || !email) {
            return res.status(400).json({ 
                error: 'Amount and email are required' 
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ 
                error: 'Invalid email format' 
            });
        }

        // Create order options
        const options = {
            amount: parseInt(amount), // Amount in paise
            currency: 'INR',
            receipt: `guide_${Date.now()}`,
            notes: {
                product: 'The Ultimate Bridal Makeup Guide',
                customer_email: email,
                purchase_date: new Date().toISOString()
            }
        };

        // Create order with Razorpay
        const order = await razorpay.orders.create(options);

        console.log('Order created:', order.id);

        res.json({
            id: order.id,
            amount: order.amount,
            currency: order.currency,
            receipt: order.receipt
        });

    } catch (error) {
        console.error('Error creating order:', error);
        res.status(500).json({ 
            error: 'Failed to create order',
            message: error.message 
        });
    }
});

// Verify Payment
app.post('/api/verify-payment', async (req, res) => {
    try {
        const { 
            razorpay_order_id, 
            razorpay_payment_id, 
            razorpay_signature,
            email 
        } = req.body;

        // Validate request
        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({ 
                success: false,
                error: 'Missing payment details' 
            });
        }

        // Generate signature for verification
        const generatedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest('hex');

        // Verify signature
        if (generatedSignature !== razorpay_signature) {
            console.error('Signature verification failed');
            return res.status(400).json({
                success: false,
                error: 'Payment verification failed'
            });
        }

        console.log('Payment verified successfully:', razorpay_payment_id);

        // Fetch payment details from Razorpay
        try {
            const payment = await razorpay.payments.fetch(razorpay_payment_id);
            console.log('Payment details:', {
                id: payment.id,
                amount: payment.amount,
                status: payment.status,
                email: payment.email
            });

            // TODO: Save payment details to database here
            // await savePaymentToDatabase(payment);

        } catch (fetchError) {
            console.error('Error fetching payment details:', fetchError);
        }

        // Send email with guide (optional)
        if (email && process.env.EMAIL_USER) {
            try {
                await sendGuideEmail(email, razorpay_payment_id);
            } catch (emailError) {
                console.error('Error sending email:', emailError);
                // Don't fail the request if email fails
            }
        }

        // Return success response
        res.json({
            success: true,
            message: 'Payment verified successfully',
            payment_id: razorpay_payment_id,
            download_url: '/guide/Makeupguide.pdf'
        });

    } catch (error) {
        console.error('Error verifying payment:', error);
        res.status(500).json({
            success: false,
            error: 'Error verifying payment',
            message: error.message
        });
    }
});

// Download Guide (Protected)
app.get('/api/download-guide/:paymentId', async (req, res) => {
    try {
        const { paymentId } = req.params;

        console.log('Download requested for payment:', paymentId);

        // Verify payment exists and is successful
        try {
            const payment = await razorpay.payments.fetch(paymentId);
            console.log('Payment status:', payment.status);

            if (payment.status !== 'captured') {
                return res.status(403).json({
                    error: 'Payment not completed'
                });
            }
        } catch (fetchError) {
            console.error('Error fetching payment:', fetchError);
            return res.status(404).json({
                error: 'Payment not found'
            });
        }

        // Serve the PDF file
        const filePath = path.join(__dirname, '../docs/guide/Makeupguide.pdf');
        
        console.log('Serving file from:', filePath);
        
        // Check if file exists
        const fs = require('fs');
        if (!fs.existsSync(filePath)) {
            console.error('File not found at:', filePath);
            return res.status(404).json({
                error: 'Guide file not found'
            });
        }

        // Set headers for download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="Ultimate-Bridal-Makeup-Guide.pdf"');
        
        res.download(filePath, 'Ultimate-Bridal-Makeup-Guide.pdf', (err) => {
            if (err) {
                console.error('Download error:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Error downloading file' });
                }
            }
        });

    } catch (error) {
        console.error('Error in download route:', error);
        res.status(500).json({
            error: 'Failed to download guide',
            message: error.message
        });
    }
});

// Razorpay Webhook (for production)
app.post('/api/webhook', (req, res) => {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];

    try {
        const generatedSignature = crypto
            .createHmac('sha256', webhookSecret)
            .update(JSON.stringify(req.body))
            .digest('hex');

        if (generatedSignature === signature) {
            const event = req.body.event;
            const payload = req.body.payload;

            console.log('Webhook received:', event);

            // Handle different webhook events
            switch (event) {
                case 'payment.captured':
                    // Payment successful
                    console.log('Payment captured:', payload.payment.entity.id);
                    // TODO: Update database, send email, etc.
                    break;
                
                case 'payment.failed':
                    // Payment failed
                    console.log('Payment failed:', payload.payment.entity.id);
                    break;
                
                default:
                    console.log('Unhandled webhook event:', event);
            }

            res.json({ status: 'ok' });
        } else {
            res.status(400).json({ error: 'Invalid signature' });
        }
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

// ============= HELPER FUNCTIONS =============

// Send email with guide
async function sendGuideEmail(email, paymentId) {
    const mailOptions = {
        from: `"Anjli Gupta Makeup" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: '✨ Your Ultimate Bridal Makeup Guide - Thank You!',
        html: `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: linear-gradient(135deg, #E8C4C4, #E8B7A5); padding: 30px; text-align: center; color: white; }
                    .content { background: #fff; padding: 30px; }
                    .button { display: inline-block; padding: 15px 30px; background: #E8C4C4; color: white; text-decoration: none; border-radius: 50px; margin: 20px 0; }
                    .footer { text-align: center; padding: 20px; color: #999; font-size: 12px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>Thank You for Your Purchase! 💄</h1>
                    </div>
                    <div class="content">
                        <p>Dear Beauty Enthusiast,</p>
                        <p>Thank you for purchasing <strong>The Ultimate Bridal Makeup Guide</strong>! I'm excited to share my professional techniques and secrets with you.</p>
                        <p>Your guide is attached to this email and ready to download.</p>
                        <p><strong>Payment ID:</strong> ${paymentId}</p>
                        <p><strong>What's Inside:</strong></p>
                        <ul>
                            <li>Step-by-step bridal makeup tutorial</li>
                            <li>Skincare preparation tips</li>
                            <li>Product recommendations</li>
                            <li>Long-lasting makeup techniques</li>
                            <li>Common mistakes to avoid</li>
                        </ul>
                        <p>If you have any questions or need personalized advice, feel free to reach out to me on WhatsApp or Instagram.</p>
                        <p>Happy learning! ✨</p>
                        <p><strong>Anjli Gupta</strong><br>
                        Professional Makeup Artist<br>
                        @bloomwithanjli</p>
                    </div>
                    <div class="footer">
                        <p>© 2025 Anjli Gupta Makeup Artistry. All rights reserved.</p>
                        <p>📧 Contact: +91 9654938428</p>
                    </div>
                </div>
            </body>
            </html>
        `,
        attachments: [{
            filename: 'Ultimate-Bridal-Makeup-Guide.pdf',
            path: path.join(__dirname, '../docs/guide/Makeupguide.pdf')
        }]
    };

    await transporter.sendMail(mailOptions);
    console.log('Guide email sent to:', email);
}

// ============= START SERVER =============

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`
    🚀 Server is running on http://localhost:${PORT}
    📝 Frontend: http://localhost:${PORT}
    🔐 API: http://localhost:${PORT}/api
    💳 Razorpay Mode: ${process.env.RAZORPAY_KEY_ID.includes('test') ? 'TEST' : 'LIVE'}
    `);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    app.close(() => {
        console.log('HTTP server closed');
    });
});