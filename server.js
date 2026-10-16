
const express = require("express");
const ws = require("ws");
const multer = require("multer");
const nodemailer = require("nodemailer");
const cors = require("cors");
require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");
const cv = require("@u4/opencv4nodejs");

const app = express();

app.use(cors());
app.use(express.json());
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024
    }
});

// =========================================================
// ORB IMAGE COMPARISON
// =========================================================

function compareImagesWithORB(imageBuffer1, imageBuffer2) {
    const image1 = cv.imdecode(imageBuffer1);
    const image2 = cv.imdecode(imageBuffer2);

    const gray1 = image1.bgrToGray();
    const gray2 = image2.bgrToGray();

    const orb = new cv.ORBDetector();

    const result1 = orb.detectAndCompute(gray1);
    const result2 = orb.detectAndCompute(gray2);

    if (
        !result1.descriptors ||
        !result2.descriptors ||
        result1.descriptors.rows === 0 ||
        result2.descriptors.rows === 0
    ) {
        return {
            matchPercent: 0,
            isDuplicate: false,
            result: "Not Duplicate"
        };
    }

    const matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);

    const matches = matcher.knnMatch(
        result1.descriptors,
        result2.descriptors,
        2
    );

    const goodMatches = matches.filter(pair =>
        pair.length >= 2 &&
        pair[0].distance < 0.75 * pair[1].distance
    );

    const totalFeatures = Math.max(
        result1.descriptors.rows,
        result2.descriptors.rows
    );

    const matchPercent = Math.round(
        goodMatches.length / totalFeatures * 100
    );

    const isDuplicate = matchPercent >= 30;

    return {
        matchPercent: Math.min(matchPercent, 100),
        isDuplicate,
        result: isDuplicate
            ? "Duplicate Complaint"
            : "Not Duplicate"
    };
}


// =========================================================
// TEMPORARY OTP STORAGE
// =========================================================

const otpStore = {};


// =========================================================
// GMAIL CONFIGURATION
// =========================================================

const transporter = nodemailer.createTransport({
    service: "gmail",

    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
    }
});


// =========================================================
// SUPABASE CONFIGURATION
// =========================================================

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY,
    {
        realtime: {
            transport: ws
        }
    }
);


// =========================================================
// SEND OTP
// =========================================================

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
            Math.floor(
                100000 +
                Math.random() * 900000
            ).toString();


        // Store OTP for 5 minutes
        otpStore[email] = {

            otp: otp,

            expiresAt:
                Date.now() +
                5 * 60 * 1000

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


        console.log(
            "OTP sent to:",
            email
        );


        res.json({

            success: true,

            message:
                "OTP sent successfully"

        });


    } catch (error) {

        console.log(
            "Email error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                "Failed to send OTP"

        });

    }

});


// =========================================================
// VERIFY OTP
// =========================================================

app.post("/verify-otp", (req, res) => {

    const {
        email,
        otp
    } = req.body;


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
    if (
        Date.now() >
        storedData.expiresAt
    ) {

        delete otpStore[email];


        return res.status(400).json({

            success: false,

            message:
                "OTP expired"

        });

    }


    // Check OTP
    if (
        storedData.otp !== otp
    ) {

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


// =========================================================
// CREATE ACCOUNT
// =========================================================

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
        const {
            data,
            error
        } = await supabase

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


// =========================================================
// UPLOAD COMPLAINT IMAGE
// =========================================================

app.post(
    "/upload-complaint-image",
    upload.single("image"),
    async (req, res) => {

        try {

            if (!req.file) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Image is required"

                });

            }


            const extension =
                req.file.mimetype === "image/png"
                    ? "png"
                    : "jpg";


            const fileName =
                `complaint-${Date.now()}.${extension}`;


            // Upload image to Supabase Storage
            const {
                data,
                error
            } = await supabase.storage

                .from("complaint-images")

                .upload(
                    fileName,
                    req.file.buffer,
                    {
                        contentType:
                            req.file.mimetype,

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

                    message:
                        error.message

                });

            }


            // Get public image URL
            const {
                data: publicData
            } =
                supabase.storage

                    .from("complaint-images")

                    .getPublicUrl(
                        data.path
                    );


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


// =========================================================
// SUBMIT COMPLAINT
// =========================================================

app.post(
    "/submit-complaint",
    async (req, res) => {

        try {

            const {
                username,
                name,
                hostel_name,
                room_number,
                complaint_description,
                image_url
            } = req.body;


            // Check required fields
            if (
                !username ||
                !name ||
                !hostel_name ||
                !room_number ||
                !complaint_description
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "All complaint fields are required"

                });

            }


            console.log(
                "New complaint from username:",
                username
            );


            // Save complaint in Supabase
            const {
                data,
                error
            } = await supabase

                .from("complaints")

                .insert([

                    {
                        username: username,

                        name: name,

                        hostel_name:
                            hostel_name,

                        room_number:
                            room_number,

                        complaint_description:
                            complaint_description,

                        image_url:
                            image_url || null,

                        status:
                            "Pending"
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

                    message:
                        error.message

                });

            }


            res.json({

                success: true,

                message:
                    "Complaint submitted successfully",

                complaint:
                    data

            });


        } catch (error) {

            console.log(
                "Submit complaint error:",
                error
            );


            res.status(500).json({

                success: false,

                message:
                    "Server error"

            });

        }

    }
);


// =========================================================
// GET ALL COMPLAINTS
// ADMIN
// =========================================================

app.get(
    "/complaints",
    async (req, res) => {

        try {

            const {
                data,
                error
            } = await supabase

                .from("complaints")

                .select("*")

                .order(
                    "created_at",
                    {
                        ascending: false
                    }
                );


            if (error) {

                console.log(
                    "Fetch complaints error:",
                    error
                );


                return res.status(500).json({

                    success: false,

                    message:
                        error.message

                });

            }


            res.json({

                success: true,

                complaints:
                    data

            });


        } catch (error) {

            console.log(
                "Get complaints error:",
                error
            );


            res.status(500).json({

                success: false,

                message:
                    "Server error"

            });

        }

    }
);

// =========================================================
// GET DUPLICATE COMPLAINTS
// ADMIN
// =========================================================

app.get("/duplicate-complaints", async (req, res) => {
    try {
        // Fetch all complaints from Supabase
        const { data: complaints, error } = await supabase
            .from("complaints")
            .select("*")
            .order("created_at", { ascending: false });

        if (error) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }

        // Group complaints by hostel and room number
        const groups = {};

        for (const complaint of complaints || []) {
            if (!complaint.room_number || !complaint.image_url) {
                continue;
            }

            const hostel = String(complaint.hostel_name || "")
                .trim()
                .toLowerCase();

            const room = String(complaint.room_number)
                .trim()
                .toLowerCase();

            const key = `${hostel}::${room}`;

            if (!groups[key]) {
                groups[key] = [];
            }

            groups[key].push(complaint);
        }

        const duplicatePairs = [];

        // Compare images only within the same hostel and room
        for (const group of Object.values(groups)) {
            if (group.length < 2) continue;

            for (let i = 0; i < group.length; i++) {
                for (let j = i + 1; j < group.length; j++) {
                    const complaint1 = group[i];
                    const complaint2 = group[j];

                    try {
                        // Download both images
                        const [response1, response2] = await Promise.all([
                            fetch(complaint1.image_url),
                            fetch(complaint2.image_url)
                        ]);

                        if (!response1.ok || !response2.ok) {
                            console.error("Could not download complaint images");
                            continue;
                        }

                        const [buffer1, buffer2] = await Promise.all([
                            response1.arrayBuffer(),
                            response2.arrayBuffer()
                        ]);

                        // Compare using ORB
                        const comparison = compareImagesWithORB(
                            Buffer.from(buffer1),
                            Buffer.from(buffer2)
                        );

                        // Return only pairs classified as duplicates
                        if (comparison.isDuplicate) {
                            duplicatePairs.push({
                                complaint1,
                                complaint2,
                                room_number: complaint1.room_number,
                                match_percent: comparison.matchPercent,
                                is_duplicate: true,
                                result: "Duplicate Complaint"
                            });
                        }
                    } catch (imageError) {
                        console.error(
                            "Image comparison failed:",
                            imageError.message
                        );
                    }
                }
            }
        }

        return res.json({
            success: true,
            total_duplicates: duplicatePairs.length,
            duplicates: duplicatePairs
        });

    } catch (error) {
        console.error("Duplicate complaints API error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to detect duplicate complaints"
        });
    }
});


// =========================================================
// GET MY COMPLAINTS
// STUDENT
// =========================================================

app.get(
    "/my-complaints",
    async (req, res) => {

        try {

            const {
                username
            } = req.query;


            // Check username
            if (
                !username ||
                username.trim() === ""
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Username is required"

                });

            }


            console.log(
                "Fetching complaints for:",
                username
            );


            const {
                data,
                error
            } = await supabase

                .from("complaints")

                .select("*")

                .eq(
                    "username",
                    username
                )

                .order(
                    "created_at",
                    {
                        ascending: false
                    }
                );


            if (error) {

                console.log(
                    "My complaints error:",
                    error
                );


                return res.status(500).json({

                    success: false,

                    message:
                        error.message

                });

            }


            res.json({

                success: true,

                username:
                    username,

                complaints:
                    data

            });


        } catch (error) {

            console.log(
                "My complaints server error:",
                error
            );


            res.status(500).json({

                success: false,

                message:
                    "Server error"

            });

        }

    }
);



// =========================================================
// UPDATE COMPLAINT STATUS
// ADMIN
// =========================================================

app.patch(
    "/complaints/:id",
    async (req, res) => {

        try {

            const { id } = req.params;
            const { status } = req.body;

            const allowedStatuses = [
                "Pending",
                "In Progress",
                "Resolved"
            ];

            if (
                !status ||
                !allowedStatuses.includes(status)
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid status. Use Pending, In Progress or Resolved."
                });
            }

            const {
                data,
                error
            } = await supabase
                .from("complaints")
                .update({
                    status: status
                })
                .eq("id", id)
                .select()
                .single();

            if (error) {

                console.log(
                    "Update complaint error:",
                    error
                );

                return res.status(500).json({
                    success: false,
                    message: error.message
                });
            }

            if (!data) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Complaint not found"
                });
            }

            res.json({
                success: true,
                message:
                    "Complaint status updated successfully",
                complaint: data
            });

        } catch (error) {

            console.log(
                "Status update error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Server error"
            });
        }
    }
);// =========================================================
// LOGIN
// NAME = USERNAME
// =========================================================

app.post(
    "/login",
    async (req, res) => {

        try {

            const {
                name,
                password
            } = req.body;


            // Check fields
            if (
                !name ||
                !password
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Name and password are required"

                });

            }


            // Find user
            const {
                data,
                error
            } = await supabase

                .from("users")

                .select("*")

                .eq(
                    "name",
                    name
                )

                .eq(
                    "password",
                    password
                )

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

                    id:
                        data.id,

                    name:
                        data.name,

                    prn:
                        data.prn,

                    hostel_address:
                        data.hostel_address,

                    gmail:
                        data.gmail

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

    }
);


// =========================================================
// START SERVER
// =========================================================

const PORT =
    process.env.PORT || 3000;


app.listen(
    PORT,
    () => {

        console.log(
            `MemoBox backend running on port ${PORT}`
        );

    }
);
