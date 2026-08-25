const express = require("express");
const ws = require("ws");
const multer = require("multer");
const nodemailer = require("nodemailer");
const cors = require("cors");
require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors());
app.use(express.json());

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024
    }
});
// ===============================
// TEMPORARY OTP STORAGE
// ===============================

const otpStore = {};


// ===============================
// GMAIL CONFIGURATION
// ===============================

const transporter = nodemailer.createTransport({
    service: "gmail",

    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
    }
});


// ===============================
// SUPABASE CONFIGURATION
// ===============================

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY,
    {
        realtime: {
            transport: ws
        }
    }
);


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

            expiresAt:
                Date.now() + 5 * 60 * 1000

        };


        // Send OTP email
        await transporter.sendMail({

            from:
                `"Hostel Management" <${process.env.GMAIL_USER}>`,

            to: email,

            subject:
                "Hostel Management Account Verification OTP",

            text:

                `Your Hostel Management verification OTP is: ${otp}\n\n` +

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

            message:
                "Email and OTP are required"

        });

    }


    const storedData =
        otpStore[email];


    if (!storedData) {

        return res.status(400).json({

            success: false,

            message:
                "OTP not found"

        });

    }


    // Check OTP expiry
    if (Date.now() > storedData.expiresAt) {

        delete otpStore[email];


        return res.status(400).json({

            success: false,

            message:
                "OTP expired"

        });

    }


    // Check OTP
    if (storedData.otp !== otp) {

        return res.status(400).json({

            success: false,

            message:
                "Invalid OTP"

        });

    }


    // OTP verified
    delete otpStore[email];


    res.json({

        success: true,

        message:
            "OTP verified successfully"

    });

});


// ===============================
// CREATE ACCOUNT
// ===============================

app.post("/create-account", async (req, res) => {

    try {

        const {

            name,

            prn,

            hostel_address,

            gmail,

            password

        } = req.body;


        // Check all fields
        if (

            !name ||

            !prn ||

            !hostel_address ||

            !gmail ||

            !password

        ) {

            return res.status(400).json({

                success: false,

                message:
                    "All fields are required"

            });

        }


        // Save account in Supabase
        const { data, error } =

            await supabase

                .from("users")

                .insert([

                    {

                        name: name,

                        prn: prn,

                        hostel_address:
                            hostel_address,

                        gmail: gmail,

                        password: password

                    }

                ])

                .select();


        // Supabase error
        if (error) {

            console.log(
                "Supabase error:",
                error
            );


            return res.status(500).json({

                success: false,

                message:
                    error.message

            });

        }


        // Account created
        res.json({

            success: true,

            message:
                "Account created successfully"

        });


    } catch (error) {

        console.log(
            "Create account error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                "Server error"

        });

    }

});
// ===============================
// UPLOAD COMPLAINT IMAGE
// ===============================

app.post(
    "/upload-complaint-image",
    upload.single("image"),
    async (req, res) => {

        try {

            if (!req.file) {

                return res.status(400).json({
                    success: false,
                    message: "Image is required"
                });

            }

            const extension =
                req.file.mimetype === "image/png"
                    ? "png"
                    : "jpg";

            const fileName =
                `complaint-${Date.now()}.${extension}`;


            // Upload image to Supabase Storage
            const { data, error } =
                await supabase.storage
                    .from("complaint-images")
                    .upload(
                        fileName,
                        req.file.buffer,
                        {
                            contentType: req.file.mimetype,
                            upsert: false
                        }
                    );


            if (error) {

                console.log(
                    "Storage upload error:",
                    error
                );

                return res.status(500).json({
                    success: false,
                    message: error.message
                });

            }


            // Get public image URL
            const { data: publicData } =
                supabase.storage
                    .from("complaint-images")
                    .getPublicUrl(data.path);


            res.json({

                success: true,

                message:
                    "Image uploaded successfully",

                image_url:
                    publicData.publicUrl

            });


        } catch (error) {

            console.log(
                "Image upload error:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Failed to upload image"

            });

        }

    }
);
// ===============================
// SUBMIT COMPLAINT
// ===============================

app.post("/submit-complaint", async (req, res) => {

    try {

        const {
            name,
            hostel_name,
            room_number,
            complaint_description,
            image_url
        } = req.body;

        // Check required fields
        if (
            !name ||
            !hostel_name ||
            !room_number ||
            !complaint_description
        ) {

            return res.status(400).json({
                success: false,
                message: "All complaint fields are required"
            });

        }

        // Save complaint in Supabase
        const { data, error } = await supabase
            .from("complaints")
            .insert([
                {
                    name: name,
                    hostel_name: hostel_name,
                    room_number: room_number,
                    complaint_description: complaint_description,
                    image_url: image_url || null,
                    status: "Pending"
                }
            ])
            .select()
            .single();

        if (error) {

            console.log(
                "Complaint Supabase error:",
                error
            );

            return res.status(500).json({
                success: false,
                message: error.message
            });

        }

        res.json({
            success: true,
            message: "Complaint submitted successfully",
            complaint: data
        });

    } catch (error) {

        console.log(
            "Submit complaint error:",
            error
        );

        res.status(500).json({
            success: false,
            message: "Server error"
        });

    }

});
// ===============================
// LOGIN
// ===============================
// NAME = USERNAME
// ===============================

app.post("/login", async (req, res) => {

    try {

        const {

            name,

            password

        } = req.body;


        // Check fields
        if (!name || !password) {

            return res.status(400).json({

                success: false,

                message:
                    "Name and password are required"

            });

        }


        // Find user
        const { data, error } =

            await supabase

                .from("users")

                .select("*")

                .eq("name", name)

                .eq("password", password)

                .maybeSingle();


        // Supabase error
        if (error) {

            console.log(
                "Supabase login error:",
                error
            );


            return res.status(500).json({

                success: false,

                message:
                    "Login failed"

            });

        }


        // User not found
        if (!data) {

            return res.status(401).json({

                success: false,

                message:
                    "Invalid name or password"

            });

        }


        // Login successful
        res.json({

            success: true,

            message:
                "Login successful",

            user: {

                id: data.id,

                name: data.name,

                prn: data.prn,

                hostel_address:
                    data.hostel_address,

                gmail: data.gmail

            }

        });


    } catch (error) {

        console.log(
            "Login error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                "Server error"

        });

    }

});


// ===============================
// START SERVER
// ===============================

const PORT =
    process.env.PORT || 3000;


app.listen(PORT, () => {

    console.log(

        `MemoBox backend running on port ${PORT}`

    );

});