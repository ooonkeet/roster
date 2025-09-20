const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

// Configurable via environment variables for better flexibility and security.
const PORT = process.env.PORT || 5000;
const SCHEDULER_URL =
  process.env.SCHEDULER_URL || "http://127.0.0.1:8001/schedule";
// It's a good practice to restrict CORS to your frontend's origin in production.
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:3000";

// Apply middleware
// Restrict requests to the allowed origin.
app.use(cors({ origin: ALLOWED_ORIGIN }));
// Parse JSON bodies, with a limit to prevent large payloads.
app.use(express.json({ limit: "1mb" }));

// Health check endpoint for monitoring.
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "backend" });
});

// Proxy endpoint: forwards payload to the Python scheduler microservice.
app.post("/api/schedule", async (req, res) => {
  try {
    // Basic validation for the incoming request body.
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({ error: "Empty request body" });
    }

    console.log("Forwarding request to scheduler:", SCHEDULER_URL);
    // Forward the request to the Python microservice (scheduler).
    // A generous timeout is set for potentially long-running scheduling tasks.
    const response = await axios.post(SCHEDULER_URL, req.body, {
      timeout: 60000,
    });

    // Respond with the data from the microservice.
    return res.status(response.status).json(response.data);
  } catch (err) {
    console.error("Error while generating schedule:", err.message);

    // If the scheduler service responded with an error, forward that error.
    // This provides more specific error details to the client.
    if (err.response) {
      const status = err.response.status || 500;
      const data = err.response.data || { error: "Scheduler service error" };
      return res.status(status).json({ ...data, forwarded: true });
    }

    // Handle network errors or other issues when communicating with the scheduler.
    return res.status(502).json({
      error: "Failed to communicate with the scheduler service",
      details: err.message,
    });
  }
});

// Optional: An endpoint to check the availability of the scheduler service.
app.get("/api/scheduler-status", async (req, res) => {
  try {
    // The health/docs endpoint of the scheduler might be different.
    const schedulerHealthUrl =
      process.env.SCHEDULER_URL_HEALTH ||
      SCHEDULER_URL.replace(/\/schedule$/, "") + "/docs";
    const r = await axios.get(schedulerHealthUrl, { timeout: 3000 });
    res.json({ scheduler: "reachable", status: r.status });
  } catch (e) {
    res.status(502).json({ scheduler: "unreachable", error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend server listening on port ${PORT}`);
  console.log(`Allowed CORS origin: ${ALLOWED_ORIGIN}`);
  console.log(`Forwarding schedule requests to: ${SCHEDULER_URL}`);
});
