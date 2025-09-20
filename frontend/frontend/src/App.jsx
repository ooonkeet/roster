import React, { useState, useEffect } from "react";
import { Routes, Route, useNavigate, Link } from "react-router-dom";
import InputForm from "./components/InputForm";
import TimetableView from "./components/TimetableView";

function TimetablePage() {
  const [schedule, setSchedule] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const savedSchedule = localStorage.getItem('timetableData');
    if (savedSchedule) {
      try {
        setSchedule(JSON.parse(savedSchedule));
      } catch (e) {
        console.error("Failed to parse saved timetable data from localStorage", e);
        localStorage.removeItem('timetableData');
        navigate('/');
      }
    } else {
      // If there's no schedule, redirect to the form page.
      navigate('/');
    }
  }, [navigate]);

  const handleClear = () => {
    localStorage.removeItem('timetableData');
    navigate('/');
  };

  return (
    <div>
      <button type="button" onClick={handleClear} style={{ marginBottom: 16 }}>
        Generate New Timetable
      </button>
      <TimetableView schedule={schedule} />
    </div>
  );
}

export default function App() {
  return (
    <div style={{ maxWidth: 1100, margin: "24px auto", padding: 16 }}>
      <h1 style={{ marginBottom: 12 }}><Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>Timetable Generator</Link></h1>
      <Routes>
        <Route path="/" element={<InputForm />} />
        <Route path="/timetable" element={<TimetablePage />} />
      </Routes>
    </div>
  );
}
