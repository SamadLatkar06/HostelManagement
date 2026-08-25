const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

// Temporary OTP storage
const otpStore = {};

// Gmail configuration
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
    }
});


// ===============================
// SEND OTP
// ===============================

app.post("/send-otp", async (req, res) => {

    try {

        const { email } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                message: "Email is required"
            });
        }

        // Generate 6 digit OTP
        const otp =
            Math.floor(100000 + Math.random() * 900000).toString();

        // Store OTP for 5 minutes
        otpStore[email] = {
            otp: otp,
            expiresAt: Date.now() + 5 * 60 * 1000
        };

        // Send email
        await transporter.sendMail({

            from: `"Hostel Management" <${process.env.GMAIL_USER}>`,

            to: email,

            subject: "MemoBox Account Verification OTP",

            text:
                `Your MemoBox verification OTP is: ${otp}\n\n` +
                `This OTP is valid for 5 minutes.\n\n` +
                `Do not share this OTP with anyone.`
        });

        console.log("OTP sent to:", email);

        res.json({
            success: true,
            message: "OTP sent successfully"
        });

    } catch (error) {

        console.log("Email error:", error);

        res.status(500).json({
            success: false,
            message: "Failed to send OTP"
        });
    }
});


// ===============================
// VERIFY OTP
// ===============================

app.post("/verify-otp", (req, res) => {

    const { email, otp } = req.body;

    if (!email || !otp) {
        return res.status(400).json({
            success: false,
            message: "Email and OTP are required"
        });
    }

    const storedData = otpStore[email];

    if (!storedData) {
        return res.status(400).json({
            success: false,
            message: "OTP not found"
        });
    }

    // Check expiry
    if (Date.now() > storedData.expiresAt) {

        delete otpStore[email];

        return res.status(400).json({
            success: false,
            message: "OTP expired"
        });
    }

    // Check OTP
    if (storedData.otp !== otp) {

        return res.status(400).json({
            success: false,
            message: "Invalid OTP"
        });
    }

    // OTP correct
    delete otpStore[email];

    res.json({
        success: true,
        message: "OTP verified successfully"
    });
});


// ===============================
// START SERVER
// ===============================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

    console.log(
        `MemoBox backend running on port ${PORT}`
    );

});