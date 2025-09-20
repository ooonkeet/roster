import axios from "axios";

const baseURL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
const API = axios.create({ baseURL });

export const generateSchedule = (data) => API.post("/schedule", data);