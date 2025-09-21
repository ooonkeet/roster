import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { generateSchedule } from "../api";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v || 0));

export default function InputForm() {
  const [sectionsCount, setSectionsCount] = useState(1); // max 6
  const navigate = useNavigate();
  const [theoryRooms, setTheoryRooms] = useState([]);
  const [labRooms, setLabRooms] = useState([]);
  const [subjects, setSubjects] = useState([{ name: "", code: "", credit: 1, lab: 0 }]);
  const [faculty, setFaculty] = useState([]);
  const [periodsPerDay, setPeriodsPerDay] = useState(8);
  const [breakPeriod, setBreakPeriod] = useState(4); // 1-indexed

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
  const maxSubjects = 6;
  const maxPeriodsPerDay = 12;
  const sectionNames = Array.from({ length: sectionsCount }, (_, i) => String.fromCharCode('A'.charCodeAt(0) + i));

  // add/remove helpers
  const addTheoryRoom = () => theoryRooms.length < sectionsCount && setTheoryRooms([...theoryRooms, ""]);
  const removeTheoryRoom = (i) => setTheoryRooms(theoryRooms.filter((_, idx) => idx !== i));
  const addLabRoom = () => labRooms.length < sectionsCount && setLabRooms([...labRooms, ""]);
  const removeLabRoom = (i) => setLabRooms(labRooms.filter((_, idx) => idx !== i));
  const addSubject = () => subjects.length < maxSubjects && setSubjects([...subjects, { name: "", code: "", credit: 1, lab: 0 }]);
  const removeSubject = (i) => setSubjects(subjects.filter((_, idx) => idx !== i));
  const addFaculty = () => setFaculty([...faculty, { name: "", abbr: "", assignments: [] }]);
  const removeFaculty = (i) => setFaculty(faculty.filter((_, idx) => idx !== i));

  async function handleSubmit(e) {
    e.preventDefault();

    // simple validation
    if (sectionsCount < 1 || sectionsCount > 6) return alert(`Sections must be 1-6.`);
    if (theoryRooms.length < 1) return alert("Add at least one theory room");
    if (labRooms.length < 1) return alert("Add at least one lab room");
    if (subjects.length < minSubjects || subjects.length > maxSubjects) return alert(`Please add between 4 and 6 subjects.`);

    // Check for empty input fields
    if (theoryRooms.some(r => !r.trim())) {
      return alert("All theory rooms must have a name.");
    }
    if (labRooms.some(r => !r.trim())) {
      return alert("All lab rooms must have a name.");
    }

    // Uniqueness validation for subjects and rooms (case-insensitive)
    const seenSubjectNames = new Set();
    const seenSubjectCodes = new Set();
    for (const s of subjects) {
      if (s.name) {
        if (seenSubjectNames.has(s.name.toLowerCase())) {
          return alert(`Subject names must be unique. Found duplicate: "${s.name}".`);
        }
        seenSubjectNames.add(s.name.toLowerCase());
      }
      if (s.code) {
        if (seenSubjectCodes.has(s.code.toLowerCase())) {
          return alert(`Subject codes must be unique. Found duplicate code: "${s.code}".`);
        }
        seenSubjectCodes.add(s.code.toLowerCase());
      }
    }

    const seenTheoryRooms = new Set();
    for (const r of theoryRooms) {
      if (r) {
        if (seenTheoryRooms.has(r.toLowerCase())) {
          return alert(`Theory room names must be unique. Found duplicate: "${r}".`);
        }
        seenTheoryRooms.add(r.toLowerCase());
      }
    }

    const seenLabRooms = new Set();
    for (const r of labRooms) {
      if (r) {
        if (seenLabRooms.has(r.toLowerCase())) {
          return alert(`Lab room names must be unique. Found duplicate: "${r}".`);
        }
        seenLabRooms.add(r.toLowerCase());
      }
    }

    // Check for duplicates between theory and lab rooms
    for (const r of labRooms) {
      if (r && seenTheoryRooms.has(r.toLowerCase())) {
        return alert(`Room names must be unique across theory and lab rooms. Found duplicate: "${r}".`);
      }
    }

    // Uniqueness validation for faculty names (case-insensitive)
    const seenFacultyNames = new Set();
    const seenFacultyAbbrs = new Set();
    for (const f of faculty) {
      if (f.name) {
        if (seenFacultyNames.has(f.name.toLowerCase())) {
          return alert(`Faculty names must be unique. Found duplicate: "${f.name}".`);
        }
        seenFacultyNames.add(f.name.toLowerCase());
      }
      if (f.abbr) {
        if (seenFacultyAbbrs.has(f.abbr.toLowerCase())) {
          return alert(`Faculty abbreviations must be unique. Found duplicate abbreviation: "${f.abbr}".`);
        }
        seenFacultyAbbrs.add(f.abbr.toLowerCase());
      }
    }

    for (const s of subjects) {
      if (!s.name.trim()) return alert("All subjects must have a name.");
      if (s.code.trim().length !== 5) return alert(`Subject code for "${s.name || 'Unnamed Subject'}" must be exactly 5 characters long.`);
      if (s.credit < 0 || s.credit > 3) return alert("Credits must be 0-3");
      if (s.lab < 0 || s.lab > 3) return alert("Lab count must be 0-3");
      if (s.credit === 0 && s.lab === 0) return alert(`Subject "${s.name}" must have at least one theory or lab class.`);
    }

    for (const f of faculty) {
      if (!f.name.trim()) {
        return alert("All faculty members must have a name.");
      }
      if (!f.abbr.trim()) {
        return alert("All faculty members must have an abbreviation.");
      }
      for (const a of f.assignments) {
        if (!a.subject || !a.section) {
          return alert(`Faculty "${f.name}" has an incomplete assignment. Please select both a subject and a section.`);
        }
        if (!a.teachesTheory && !a.teachesLab) {
          return alert(`Faculty "${f.name}" has an assignment for "${a.subject}" in section ${a.section} with no teaching mode (Theory/Lab) selected.`);
        }
      }
    }

    // New validation: Ensure every subject is assigned to a faculty for every section.
    const validationErrors = [];
    for (const subject of subjects) {
      if (!subject.name) continue;
      for (const secName of sectionNames) {
        // Check theory coverage
        if (subject.credit > 0) {
          const isTheoryCovered = faculty.some((f) =>
            f.assignments.some((a) => a.subject === subject.name && a.section === secName && a.teachesTheory)
          );
          if (!isTheoryCovered) {
            validationErrors.push(`Theory for subject "${subject.name}" is not assigned to any faculty for Section ${secName}.`);
          }
        }
        // Check lab coverage
        if (subject.lab > 0) {
          const isLabCovered = faculty.some((f) =>
            f.assignments.some((a) => a.subject === subject.name && a.section === secName && a.teachesLab)
          );
          if (!isLabCovered) {
            validationErrors.push(`Lab for subject "${subject.name}" is not assigned to any faculty for Section ${secName}.`);
          }
        }
      }
    }
    if (validationErrors.length > 0) {
      return alert("Please fix the following assignment issues:\n- " + validationErrors.join("\n- "));
    }

    const payload = {
      sectionsCount,
      theoryRooms: theoryRooms.filter(Boolean),
      labRooms: labRooms.filter(Boolean),
      subjectsPerSection: subjects.length,
      subjects: subjects.map((s) => ({ name: s.name, code: s.code, credit: Number(s.credit), lab: Number(s.lab) })),
      faculty: faculty
        .map((f) => {
          // Group assignments by subject and teaching mode to match backend expectations
          const assignmentsByGroup = new Map();
          f.assignments.forEach((a) => {
            if (!a.subject || !a.section || (!a.teachesTheory && !a.teachesLab)) {
              return;
            }
            const key = `${a.subject}-${a.teachesTheory}-${a.teachesLab}`;
            if (!assignmentsByGroup.has(key)) {
              assignmentsByGroup.set(key, {
                subjectName: a.subject,
                teachesTheory: a.teachesTheory,
                teachesLab: a.teachesLab,
                sections: [],
              });
            }
            assignmentsByGroup.get(key).sections.push(a.section);
          });

          return { name: f.name, abbr: f.abbr, assignments: Array.from(assignmentsByGroup.values()) };
        })
        .filter((f) => f.name && f.assignments.length > 0),
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

  // Pre-calculate all assigned slots to check for conflicts
  const assignedSlots = useMemo(() => {
    const slots = new Map();
    faculty.forEach((f, fi) => {
      f.assignments.forEach((a, ai) => {
        if (a.subject && a.section) {
          if (a.teachesTheory) {
            slots.set(`${a.subject}-${a.section}-theory`, { fi, ai });
          }
          if (a.teachesLab) {
            slots.set(`${a.subject}-${a.section}-lab`, { fi, ai });
          }
        }
      });
    });
    return slots;
  }, [faculty]);

  const isSlotTakenByOther = (subject, section, mode, currentFacultyIdx, currentAssignmentIdx) => {
    if (!subject || !section) return false;
    const key = `${subject}-${section}-${mode}`;
    if (!assignedSlots.has(key)) return false;
    const owner = assignedSlots.get(key);
    return owner.fi !== currentFacultyIdx || owner.ai !== currentAssignmentIdx;
  };

  const totalAvailableSlots = useMemo(() => {
    let count = 0;
    subjects.forEach(subject => {
      if (subject.name) {
        sectionNames.forEach(() => {
          if (subject.credit > 0) {
            count++;
          }
          if (subject.lab > 0) {
            count++;
          }
        });
      }
    });
    return count;
  }, [subjects, sectionNames]);

  const allSlotsAssigned = totalAvailableSlots > 0 && assignedSlots.size >= totalAvailableSlots;

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
              if (subjects.length > maxSubjects) {
                setSubjects(subjects.slice(0, maxSubjects));
              }
            }}
          />
        </div>
        <div>
          <label>Periods per day</label>
          <br />
          <input
            type="number"
            min="8"
            max={maxPeriodsPerDay}
            value={periodsPerDay}
            onChange={(e) => {
              const newPeriods = clamp(Number(e.target.value), 8, maxPeriodsPerDay);
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
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 100px 90px 90px", gap: 8, marginTop: 6 }}>
            <input placeholder="Subject name" value={s.name} onChange={(e) => setAt(subjects, i, { ...s, name: e.target.value }, setSubjects)} />
            <input placeholder="Code (5 chars)" value={s.code} maxLength="5" onChange={(e) => setAt(subjects, i, { ...s, code: e.target.value }, setSubjects)} />
            <input type="number" min="0" max="3" value={s.credit} onChange={(e) => setAt(subjects, i, { ...s, credit: clamp(Number(e.target.value), 0, 3) }, setSubjects)} />
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
        <h4>{`Faculty (${faculty.length} total)`}</h4>
        {faculty.map((f, facultyIdx) => {
          const uniqueSubjects = new Set(f.assignments.map(a => a.subject).filter(Boolean));

          return (
            <div key={facultyIdx} style={{ border: "1px solid #eee", padding: 8, marginTop: 6 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <input placeholder="Faculty name" value={f.name} style={{flex: 2}} onChange={(e) => setAt(faculty, facultyIdx, { ...f, name: e.target.value }, setFaculty)} />
                <input placeholder="Abbreviation" value={f.abbr} style={{flex: 1}} onChange={(e) => setAt(faculty, facultyIdx, { ...f, abbr: e.target.value }, setFaculty)} />
                <button type="button" onClick={() => removeFaculty(facultyIdx)}>
                  Remove faculty
                </button>
              </div>

              <h5 style={{ margin: "8px 0 4px 0" }}>Assignments (max 2 unique subjects)</h5>
              {f.assignments.map((assign, assignIdx) => (
                <div key={assignIdx} style={{ marginLeft: 16, marginBottom: 8, borderLeft: '2px solid #ccc', paddingLeft: 8 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", alignItems: "center", gap: 8 }}>
                    <select
                      value={assign.subject}
                      onChange={e => {
                        const newFaculty = [...faculty];
                        const newSubjectName = e.target.value;
                        newFaculty[facultyIdx].assignments[assignIdx].subject = newSubjectName;
                        newFaculty[facultyIdx].assignments[assignIdx].section = ""; // Reset section on subject change
                        newFaculty[facultyIdx].assignments[assignIdx].teachesTheory = false;
                        newFaculty[facultyIdx].assignments[assignIdx].teachesLab = false;
                        setFaculty(newFaculty);
                      }}
                    >
                      <option value="">-- Select Subject --</option>
                      {subjects.filter(s => s.name).map(s => {
                        const isAlreadyTaught = uniqueSubjects.has(s.name);
                        const isCurrentlySelected = s.name === assign.subject;
                        const isDisabledBySubjectLimit = uniqueSubjects.size >= 2 && !isAlreadyTaught;

                        // Check if all sections for this subject are already unavailable to this faculty.
                        let allSectionsUnavailable = true;
                        if (!isDisabledBySubjectLimit) {
                          for (const secName of sectionNames) {
                            const canHaveTheory = s.credit > 0;
                            const canHaveLab = s.lab > 0;

                            const theoryTaken = canHaveTheory && isSlotTakenByOther(s.name, secName, "theory", facultyIdx, assignIdx);
                            const labTaken = canHaveLab && isSlotTakenByOther(s.name, secName, "lab", facultyIdx, assignIdx);

                            // If there's at least one mode in this section that's not taken, the section is available.
                            if ((canHaveTheory && !theoryTaken) || (canHaveLab && !labTaken)) {
                              allSectionsUnavailable = false;
                              break;
                            }
                          }
                        }

                        const isDisabled = (isDisabledBySubjectLimit || allSectionsUnavailable) && !isCurrentlySelected;
                        return <option key={s.name} value={s.name} disabled={isDisabled}>{s.name}</option>;
                      })}
                    </select>
                    <select
                      value={assign.section}
                      disabled={!assign.subject}
                      onChange={(e) => {
                        const newFaculty = [...faculty];
                        newFaculty[facultyIdx].assignments[assignIdx].section = e.target.value;
                        newFaculty[facultyIdx].assignments[assignIdx].teachesTheory = false;
                        newFaculty[facultyIdx].assignments[assignIdx].teachesLab = false;
                        setFaculty(newFaculty);
                      }}
                    >
                      <option value="">-- Select Section --</option>
                      {sectionNames.map((secName) => {
                        const subjectInfo = subjects.find(s => s.name === assign.subject);
                        const canHaveTheory = subjectInfo && subjectInfo.credit > 0;
                        const canHaveLab = subjectInfo && subjectInfo.lab > 0;
                        const theoryTaken = canHaveTheory && isSlotTakenByOther(assign.subject, secName, "theory", facultyIdx, assignIdx);
                        const labTaken = canHaveLab && isSlotTakenByOther(assign.subject, secName, "lab", facultyIdx, assignIdx);

                        // A section is disabled if all its available modes for the selected subject are taken by others.
                        const isDisabled = (!canHaveTheory || theoryTaken) && (!canHaveLab || labTaken);
                        return (
                          <option key={secName} value={secName} disabled={isDisabled}>
                            {secName}
                          </option>
                        );
                      })}
                    </select>
                    <button type="button" onClick={() => {
                      const newFaculty = [...faculty];
                      newFaculty[facultyIdx].assignments.splice(assignIdx, 1);
                      setFaculty(newFaculty);
                    }}>Remove Assignment</button>
                  </div>

                  {assign.subject && assign.section && (
                    <div style={{ marginTop: 4, fontSize: "12px", display: "flex", gap: 16 }}>
                      <strong>Teaches:</strong>
                      {subjects.find((s) => s.name === assign.subject)?.credit > 0 && (
                        <label>
                          <input
                            type="checkbox"
                            checked={assign.teachesTheory}
                            disabled={isSlotTakenByOther(assign.subject, assign.section, "theory", facultyIdx, assignIdx)}
                            onChange={(e) => {
                              const newFaculty = [...faculty];
                              newFaculty[facultyIdx].assignments[assignIdx].teachesTheory = e.target.checked;
                              setFaculty(newFaculty);
                            }}
                          />{" "}
                          Theory
                        </label>
                      )}
                      {subjects.find((s) => s.name === assign.subject)?.lab > 0 && (
                        <label>
                          <input
                            type="checkbox"
                            checked={assign.teachesLab}
                            disabled={isSlotTakenByOther(assign.subject, assign.section, "lab", facultyIdx, assignIdx)}
                            onChange={(e) => {
                              const newFaculty = [...faculty];
                              newFaculty[facultyIdx].assignments[assignIdx].teachesLab = e.target.checked;
                              setFaculty(newFaculty);
                            }}
                          />{" "}
                          Lab
                        </label>
                      )}
                    </div>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  const newFaculty = [...faculty];
                  newFaculty[facultyIdx].assignments.push({ subject: "", section: "", teachesTheory: false, teachesLab: false });
                  setFaculty(newFaculty);
                }}
                style={{ marginLeft: 16 }}
              >
                Add Assignment
              </button>
            </div>
          );
        })}
        <div style={{ marginTop: 8 }}>
          <button type="button" onClick={addFaculty} disabled={allSlotsAssigned}>
            Add faculty
          </button>
        </div>
      </div>

      <hr />
      <div style={{ marginTop: 12 }}>
        <button type="submit" title="Generate and view timetable">
          Generate Timetable
        </button>
      </div>
    </form>
  );
}
