import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { generateSchedule } from "../api";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v || 0));

export default function InputForm() {
  const [sectionsCount, setSectionsCount] = useState(1); // max 6
  const navigate = useNavigate();
  const [theoryRooms, setTheoryRooms] = useState([]);
  const [labRooms, setLabRooms] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [faculty, setFaculty] = useState([]); // each faculty can teach 1-2 subjects
  const [periodsPerDay, setPeriodsPerDay] = useState(6);
  const [breakPeriod, setBreakPeriod] = useState(3); // 1-indexed

  // Persists the schedule and navigates to the timetable view.
  const persistAndNavigate = (data) => {
    if (data) {
      localStorage.setItem('timetableData', JSON.stringify(data));
      navigate('/timetable');
    } else {
      localStorage.removeItem('timetableData');
    }
  };

  // helpers to edit arrays
  const setAt = (arr, idx, val, setter) => {
    const copy = [...arr];
    copy[idx] = val;
    setter(copy);
  };

  const minSubjects = 4;
  const maxSubjects = Math.max(4, sectionsCount);
  const maxPeriodsPerDay = sectionsCount * 2;
  const isFacultySufficient = faculty.length >= subjects.length;

  // add/remove helpers
  const addTheoryRoom = () => theoryRooms.length < sectionsCount && setTheoryRooms([...theoryRooms, ""]);
  const removeTheoryRoom = (i) => setTheoryRooms(theoryRooms.filter((_, idx) => idx !== i));
  const addLabRoom = () => labRooms.length < sectionsCount && setLabRooms([...labRooms, ""]);
  const removeLabRoom = (i) => setLabRooms(labRooms.filter((_, idx) => idx !== i));
  const addSubject = () => subjects.length < maxSubjects && setSubjects([...subjects, { name: "", credit: 1, lab: 0 }]);
  const removeSubject = (i) => setSubjects(subjects.filter((_, idx) => idx !== i));
  const addFaculty = () => setFaculty([...faculty, { name: "", subjects: [""] }]);
  const removeFaculty = (i) => setFaculty(faculty.filter((_, idx) => idx !== i));

  async function handleSubmit(e) {
    e.preventDefault();

    // simple validation
    if (sectionsCount < 1 || sectionsCount > 6) return alert(`Sections must be 1-6.`);
    if (theoryRooms.length < 1) return alert("Add at least one theory room");
    if (labRooms.length < 1) return alert("Add at least one lab room");
    if (subjects.length < minSubjects || subjects.length > maxSubjects) return alert(`For ${sectionsCount} sections, please add between ${minSubjects} and ${maxSubjects} subjects.`);
    if (!isFacultySufficient) {
      return alert(`The number of faculty must be at least equal to the number of subjects. You have ${subjects.length} subjects and only ${faculty.length} faculty.`);
    }

    for (const s of subjects) {
      if (!s.name) return alert("All subjects must have a name");
      if (s.credit < 1 || s.credit > 3) return alert("Credits must be 1-3");
      if (s.lab < 0 || s.lab > 3) return alert("Lab count must be 0-3");
    }

    // Ensure every subject has at least one faculty that can teach it
    for (const sub of subjects) {
      const canBeTaught = faculty.some((f) => f.subjects.includes(sub.name));
      if (!canBeTaught) {
        const cont = window.confirm(
          `No faculty assigned for subject "${sub.name}". Continue anyway? (Recommended: assign at least one faculty per subject)`
        );
        if (!cont) return;
      }
    }

    const payload = {
      sectionsCount,
      theoryRooms: theoryRooms.filter(Boolean),
      labRooms: labRooms.filter(Boolean),
      subjectsPerSection: subjects.length,
      subjects: subjects.map((s) => ({ name: s.name, credit: Number(s.credit), lab: Number(s.lab) })),
      faculty: faculty.map((f) => ({ name: f.name, subjects: f.subjects.filter(Boolean) })),
      periodsPerDay: Number(periodsPerDay),
      breakPeriod: Number(breakPeriod),
      workingDays: 5,
    };

    try {
      const res = await generateSchedule(payload);
      persistAndNavigate(res.data);
    } catch (err) {
      console.error(err);
      // Extract the detailed error message from the backend response, which is often in `err.response.data.detail`.
      const message = err.response?.data?.detail || err.response?.data?.error || err.message;
      alert(`Failed to generate timetable: ${message}`);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ border: "1px solid #ddd", padding: 12, borderRadius: 8 }}>
      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        <div>
          <label>Number of Sections (max 6)</label>
          <br />
          <input
            type="number"
            min="1"
            max="6"
            value={sectionsCount}
            onChange={(e) => {
              const newCount = clamp(Number(e.target.value), 1, 6);
              setSectionsCount(newCount);
              // Truncate room arrays if they exceed the new max limit
              if (theoryRooms.length > newCount) {
                setTheoryRooms(theoryRooms.slice(0, newCount));
              }
              if (labRooms.length > newCount) {
                setLabRooms(labRooms.slice(0, newCount));
              }
              // Truncate subjects if they exceed the new max limit
              const newMaxSubjects = Math.max(4, newCount);
              if (subjects.length > newMaxSubjects) {
                setSubjects(subjects.slice(0, newMaxSubjects));
              }
              // Adjust periodsPerDay based on the new sectionsCount
              const newMaxPeriods = newCount * 2;
              setPeriodsPerDay(currentPeriods => {
                const clampedPeriods = clamp(currentPeriods, 5, newMaxPeriods);
                setBreakPeriod(Math.ceil(clampedPeriods / 2));
                return clampedPeriods;
              });
            }}
          />
        </div>
        <div>
          <label>Periods per day</label>
          <br />
          <input
            type="number"
            min="5"
            max={maxPeriodsPerDay}
            value={periodsPerDay}
            onChange={(e) => {
              const newPeriods = clamp(Number(e.target.value), 5, maxPeriodsPerDay);
              setPeriodsPerDay(newPeriods);
              setBreakPeriod(Math.ceil(newPeriods / 2));
            }}
          />
        </div>
        <div>
          <label>Break period (1-indexed)</label>
          <br />
          <input
            type="number"
            min="1"
            max={periodsPerDay}
            value={breakPeriod}
            onChange={(e) => setBreakPeriod(clamp(Number(e.target.value), 1, periodsPerDay))}
          />
        </div>
      </div>

      <hr />

      <div style={{ marginTop: 8 }}>
        <h4>{`Theory Rooms (max ${sectionsCount})`}</h4>
        {theoryRooms.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <input value={r} onChange={(e) => setAt(theoryRooms, i, e.target.value, setTheoryRooms)} placeholder={`Theory room #${i + 1}`} />
            <button type="button" onClick={() => removeTheoryRoom(i)}>
              Remove
            </button>
          </div>
        ))}
        <div style={{ marginTop: 6 }}>
          <button type="button" onClick={addTheoryRoom} disabled={theoryRooms.length >= sectionsCount}>
            Add theory room
          </button>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <h4>{`Lab Rooms (max ${sectionsCount})`}</h4>
        {labRooms.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <input value={r} onChange={(e) => setAt(labRooms, i, e.target.value, setLabRooms)} placeholder={`Lab room #${i + 1}`} />
            <button type="button" onClick={() => removeLabRoom(i)}>
              Remove
            </button>
          </div>
        ))}
        <div style={{ marginTop: 6 }}>
          <button type="button" onClick={addLabRoom} disabled={labRooms.length >= sectionsCount}>
            Add lab room
          </button>
        </div>
      </div>

      <hr />

      <div style={{ marginTop: 12 }}>
        <h4>{`Subjects (${subjects.length} total, min 4, max ${maxSubjects})`}</h4>
        {subjects.map((s, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px", gap: 8, marginTop: 6 }}>
            <input placeholder="Subject name" value={s.name} onChange={(e) => setAt(subjects, i, { ...s, name: e.target.value }, setSubjects)} />
            <input type="number" min="1" max="3" value={s.credit} onChange={(e) => setAt(subjects, i, { ...s, credit: clamp(Number(e.target.value), 1, 3) }, setSubjects)} />
            <input type="number" min="0" max="3" value={s.lab} onChange={(e) => setAt(subjects, i, { ...s, lab: clamp(Number(e.target.value), 0, 3) }, setSubjects)} />
            <div style={{ gridColumn: "1 / -1" }}>
              <button type="button" onClick={() => removeSubject(i)}>
                Remove subject
              </button>
            </div>
          </div>
        ))}
        <div style={{ marginTop: 8 }}>
          <button type="button" onClick={addSubject} disabled={subjects.length >= maxSubjects}>
            Add subject
          </button>
        </div>
      </div>

      <hr />

      <div style={{ marginTop: 12 }}>
        <h4>{`Faculty (${faculty.length} total, 1-2 subjects each)`}</h4>
        {faculty.map((f, i) => (
          <div key={i} style={{ border: "1px solid #eee", padding: 8, marginTop: 6 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input placeholder="Faculty name" value={f.name} onChange={(e) => setAt(faculty, i, { ...f, name: e.target.value }, setFaculty)} />
              <div style={{ display: "flex", gap: 6 }}>
                {f.subjects.map((ss, si) => (
                  <input
                    key={si}
                    placeholder={`subject #${si + 1}`}
                    value={ss}
                    onChange={(e) => {
                      const copy = [...faculty];
                      copy[i].subjects[si] = e.target.value;
                      setFaculty(copy);
                    }}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => {
                    const copy = [...faculty];
                    if (copy[i].subjects.length < 2) copy[i].subjects.push("");
                    setFaculty(copy);
                  }}
                  disabled={f.subjects.length >= 2}
                >
                  Add subj
                </button>
              </div>
              <button type="button" onClick={() => removeFaculty(i)}>
                Remove faculty
              </button>
            </div>
          </div>
        ))}
        <div style={{ marginTop: 8 }}>
          <button type="button" onClick={addFaculty}>
            Add faculty
          </button>
        </div>
      </div>

      <hr />
      <div style={{ marginTop: 12 }}>
        <button type="submit" disabled={!isFacultySufficient} title="Generate and view timetable">
          Generate Timetable
        </button>
        {!isFacultySufficient && (
          <p style={{ color: "red", fontSize: "small", marginTop: 4 }}>
            Please add more faculty. The number of faculty must be at least equal to the number of subjects.
          </p>
        )}
      </div>
    </form>
  );
}
