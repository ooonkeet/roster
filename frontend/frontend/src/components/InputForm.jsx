import React, { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { generateSchedule } from "../api";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v || 0));

const getInitialData = () => {
  try {
    const saved = localStorage.getItem('inputFormData');
    if (!saved) return null;

    const { data, timestamp } = JSON.parse(saved);
    const TEN_MINUTES = 10 * 60 * 1000;

    if (Date.now() - timestamp > TEN_MINUTES) {
      localStorage.removeItem('inputFormData');
      return null;
    }
    return data;
  } catch (e) {
    console.error("Error loading form data from storage:", e);
    localStorage.removeItem('inputFormData');
    return null;
  }
};

const initialData = getInitialData();

export default function InputForm() {
  const [sectionsCount, setSectionsCount] = useState(initialData?.sectionsCount ?? 1); // max 6
  const navigate = useNavigate();
  const [theoryRooms, setTheoryRooms] = useState([]);
  const [labRooms, setLabRooms] = useState([]);
  const [theoryRoomAssignments, setTheoryRoomAssignments] = useState(initialData?.theoryRoomAssignments ?? [{ roomName: "", sections: [""] }]);
  const [labRoomAssignments, setLabRoomAssignments] = useState(initialData?.labRoomAssignments ?? [{ roomName: "", assignments: [{ subjectName: "", sections: [] }] }]);
  const [subjects, setSubjects] = useState(initialData?.subjects ?? [{ name: "", code: "", credit: 1, lab: 0 }]);
  const [faculty, setFaculty] = useState(initialData?.faculty ?? []);
  const [periodsPerDay, setPeriodsPerDay] = useState(initialData?.periodsPerDay ?? 8);
  const [breakPeriod, setBreakPeriod] = useState(initialData?.breakPeriod ?? 4); // 1-indexed

  useEffect(() => {
    const formState = { sectionsCount, theoryRoomAssignments, labRoomAssignments, subjects, faculty, periodsPerDay, breakPeriod };
    const dataToSave = {
      data: formState,
      timestamp: Date.now(),
    };
    localStorage.setItem('inputFormData', JSON.stringify(dataToSave));
  }, [sectionsCount, theoryRoomAssignments, labRoomAssignments, subjects, faculty, periodsPerDay, breakPeriod]);

  // Persists the schedule and navigates to the timetable view.
  const persistAndNavigate = (data) => {
    if (data) {
      localStorage.setItem('timetableData', JSON.stringify(data));
      navigate('/timetable');
    } else {
      localStorage.removeItem('timetableData');
    }
  };

  const handleClearForm = () => {
    if (window.confirm("Are you sure you want to clear the form? All progress will be lost.")) {
      setSectionsCount(1);
      setTheoryRoomAssignments([{ roomName: "", sections: [""] }]);
      setLabRoomAssignments([{ roomName: "", assignments: [{ subjectName: "", sections: [] }] }]);
      setSubjects([{ name: "", code: "", credit: 1, lab: 0 }]);
      setFaculty([]);
      setPeriodsPerDay(8);
      setBreakPeriod(4);
      localStorage.removeItem('inputFormData');
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
  const addTheoryRoom = () => setTheoryRoomAssignments([...theoryRoomAssignments, { roomName: "", sections: [""] }]);
  const removeTheoryRoom = (i) => setTheoryRoomAssignments(theoryRoomAssignments.filter((_, idx) => idx !== i));
  const addLabRoom = () => setLabRoomAssignments([...labRoomAssignments, { roomName: "", assignments: [{ subjectName: "", sections: [] }] }]);
  const removeLabRoom = (i) => setLabRoomAssignments(labRoomAssignments.filter((_, idx) => idx !== i));
  const addSubject = () => subjects.length < maxSubjects && setSubjects([...subjects, { name: "", code: "", credit: 1, lab: 0 }]);
  const removeSubject = (i) => setSubjects(subjects.filter((_, idx) => idx !== i));
  const addFaculty = () => setFaculty([...faculty, { name: "", abbr: "", assignments: [] }]);
  const removeFaculty = (i) => setFaculty(faculty.filter((_, idx) => idx !== i));

  async function handleSubmit(e) {
    e.preventDefault();

    // simple validation
    if (sectionsCount < 1 || sectionsCount > 6) return alert(`Sections must be 1-6.`);
    if (subjects.length < minSubjects || subjects.length > maxSubjects) return alert(`Please add between 4 and 6 subjects.`);

    // --- New Room Assignment Validation ---
    const requiredTheorySections = new Set(sectionNames.filter(sec => subjects.some(s => s.credit > 0)));
    const assignedTheorySections = new Set(theoryRoomAssignments.flatMap(a => a.sections).filter(Boolean));
    if (requiredTheorySections.size > 0 && requiredTheorySections.size > assignedTheorySections.size) {
      return alert("Not all sections with theory classes have been assigned a theory room.");
    }

    const requiredLabSlots = new Set();
    subjects.forEach(s => {
      if (s.lab > 0) {
        sectionNames.forEach(sec => requiredLabSlots.add(`${s.name}-${sec}`));
      }
    });
    const assignedLabSlots = new Set();
    labRoomAssignments.forEach(room => {
      room.assignments.forEach(assign => {
        assign.sections.forEach(sec => {
          assignedLabSlots.add(`${assign.subjectName}-${sec}`);
        });
      });
    });
    if (requiredLabSlots.size > 0 && requiredLabSlots.size > assignedLabSlots.size) {
      return alert("Not all required lab classes have been assigned a lab room.");
    }

    for (const assignment of theoryRoomAssignments) {
      if (!assignment.roomName.trim()) {
        return alert("All theory rooms must have a name.");
      }
      if (assignment.sections.filter(Boolean).length === 0) {
        return alert(`Room "${assignment.roomName}" is defined but not assigned to any section.`);
      }
    }

    // Check for empty input fields
    const allTheoryRoomNames = theoryRoomAssignments.map(a => a.roomName);
    if (allTheoryRoomNames.some(r => !r.trim())) {
      return alert("All theory rooms must have a name.");
    }
    const allLabRoomNames = labRoomAssignments.map(a => a.roomName);
    if (allLabRoomNames.some(r => !r.trim())) {
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
    for (const r of allTheoryRoomNames) {
      if (r) {
        if (seenTheoryRooms.has(r.toLowerCase())) {
          return alert(`Theory room names must be unique. Found duplicate: "${r}".`);
        }
        seenTheoryRooms.add(r.toLowerCase());
      }
    }

    const seenLabRooms = new Set();
    for (const r of allLabRoomNames) {
      if (r) {
        if (seenLabRooms.has(r.toLowerCase())) {
          return alert(`Lab room names must be unique. Found duplicate: "${r}".`);
        }
        seenLabRooms.add(r.toLowerCase());
      }
    }

    // Check for duplicates between theory and lab rooms
    for (const r of allLabRoomNames) {
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
      if (s.code.trim().length < 1 || s.code.trim().length > 5) return alert(`Subject code for "${s.name || 'Unnamed Subject'}" must be between 1 and 5 characters long.`);
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

    // --- New Payload Transformation ---
    const finalTheoryRooms = [...new Set(theoryRoomAssignments.map(a => a.roomName).filter(Boolean))];
    const finalLabRooms = [...new Set(labRoomAssignments.map(a => a.roomName).filter(Boolean))];

    const finalTheoryRoomAssignments = [];
    theoryRoomAssignments.forEach(tra => {
      if (tra.roomName) {
        tra.sections.forEach(sectionName => {
          if (sectionName) {
            subjects.forEach(s => {
              if (s.credit > 0) {
                finalTheoryRoomAssignments.push({
                  subjectName: s.name,
                  sectionName: sectionName,
                  roomName: tra.roomName
                });
              }
            });
          }
        });
      }
    });

    const finalLabRoomAssignments = [];
    labRoomAssignments.forEach(lra => {
      if (lra.roomName) {
        lra.assignments.forEach(assign => {
          assign.sections.forEach(sec => {
            finalLabRoomAssignments.push({ subjectName: assign.subjectName, sectionName: sec, roomName: lra.roomName });
          });
        });
      }
    });

    const payload = {
      sectionsCount,
      theoryRooms: finalTheoryRooms,
      labRooms: finalLabRooms,
      theoryRoomAssignments: finalTheoryRoomAssignments,
      labRoomAssignments: finalLabRoomAssignments,
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

  const assignedLabSlotsMap = useMemo(() => {
    const map = new Map();
    labRoomAssignments.forEach((room, roomIndex) => {
      room.assignments.forEach(assign => {
        if (assign.subjectName) {
          assign.sections.forEach(sec => {
            map.set(`${assign.subjectName}-${sec}`, { roomIndex });
          });
        }
      });
    });
    return map;
  }, [labRoomAssignments]);

  const isLabSlotTakenByOther = (subjectName, sectionName, currentRoomIndex) => {
    if (!subjectName || !sectionName) return false;
    const key = `${subjectName}-${sectionName}`;
    if (!assignedLabSlotsMap.has(key)) return false;
    const owner = assignedLabSlotsMap.get(key);
    return owner.roomIndex !== currentRoomIndex;
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

  // --- Memos for new room assignment logic ---
  const assignedTheorySectionSet = useMemo(() => new Set(theoryRoomAssignments.flatMap(a => a.sections).filter(Boolean)), [theoryRoomAssignments]);
  const sectionsWithTheory = useMemo(() => new Set(sectionNames.filter(sec => subjects.some(s => s.credit > 0))), [subjects, sectionNames]);
  const allTheorySectionsAssigned = sectionsWithTheory.size > 0 && assignedTheorySectionSet.size >= sectionsWithTheory.size;

  const allRequiredLabSlots = useMemo(() => {
    const slots = new Set();
    subjects.forEach(s => {
      if (s.lab > 0) sectionNames.forEach(sec => slots.add(`${s.name}-${sec}`));
    });
    return slots;
  }, [subjects, sectionNames]);

  const assignedLabSlotsSet = useMemo(() => {
    const slots = new Set();
    labRoomAssignments.forEach(room => {
      room.assignments.forEach(assign => {
        if (assign.subjectName) assign.sections.forEach(sec => slots.add(`${assign.subjectName}-${sec}`));
      });
    });
    return slots;
  }, [labRoomAssignments]);
  const allLabSlotsAssigned = allRequiredLabSlots.size > 0 && assignedLabSlotsSet.size >= allRequiredLabSlots.size;

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

      <div style={{ marginTop: 12 }}>
        <h4>{`Subjects (${subjects.length} total, min 4, max ${maxSubjects})`}</h4>
        {subjects.map((s, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 100px 90px 90px", gap: 8, marginTop: 6 }}>
            <input placeholder="Subject name" value={s.name} onChange={(e) => setAt(subjects, i, { ...s, name: e.target.value }, setSubjects)} />
            <input placeholder="Code (1-5 chars)" value={s.code} maxLength="5" onChange={(e) => setAt(subjects, i, { ...s, code: e.target.value }, setSubjects)} />
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
        <h4>Theory Room Allocation</h4>
        {theoryRoomAssignments.map((assignment, roomIndex) => (
          <div key={roomIndex} style={{ border: '1px solid #f0f0f0', padding: '8px', marginTop: '8px', borderRadius: '4px' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <input
                value={assignment.roomName}
                onChange={(e) => {
                  const newAssignments = [...theoryRoomAssignments];
                  newAssignments[roomIndex].roomName = e.target.value;
                  setTheoryRoomAssignments(newAssignments);
                }}
                placeholder={`Theory room name`}
                style={{ flex: 1 }}
              />
              <button type="button" onClick={() => removeTheoryRoom(roomIndex)}>Remove Room</button>
            </div>

            {assignment.sections.map((sectionName, sectionIndex) => (
              <div key={sectionIndex} style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 16, marginBottom: 4 }}>
                <label style={{ flexShrink: 0, width: '60px' }}>Section:</label>
                <select
                  value={sectionName}
                  onChange={(e) => {
                    const newAssignments = [...theoryRoomAssignments];
                    newAssignments[roomIndex].sections[sectionIndex] = e.target.value;
                    setTheoryRoomAssignments(newAssignments);
                  }}
                  style={{ flex: 1 }}
                >
                  <option value="">-- Select Section --</option>
                  {sectionNames.filter(sec => sectionsWithTheory.has(sec)).map(sec => {
                    const isAssigned = assignedTheorySectionSet.has(sec);
                    const isCurrentlySelected = sectionName === sec;
                    return <option key={sec} value={sec} disabled={isAssigned && !isCurrentlySelected}>{sec}</option>
                  })}
                </select>
                {assignment.sections.length > 1 && (
                  <button type="button" style={{ padding: '2px 6px', lineHeight: 1 }} onClick={() => {
                    const newAssignments = [...theoryRoomAssignments];
                    newAssignments[roomIndex].sections.splice(sectionIndex, 1);
                    setTheoryRoomAssignments(newAssignments);
                  }}>
                    &times;
                  </button>
                )}
              </div>
            ))}

            {assignment.sections.length < 2 && assignment.sections[0] && (
              <button
                type="button"
                style={{ marginLeft: 16, marginTop: 4 }}
                onClick={() => {
                  const newAssignments = [...theoryRoomAssignments];
                  newAssignments[roomIndex].sections.push("");
                  setTheoryRoomAssignments(newAssignments);
                }}
                disabled={allTheorySectionsAssigned}
              >
                Add another section
              </button>
            )}
          </div>
        ))}
        <div style={{ marginTop: 6 }}>
          <button type="button" onClick={addTheoryRoom} disabled={allTheorySectionsAssigned}>
            Add Theory Room
          </button>
        </div>
      </div>

      <hr />

      <div style={{ marginTop: 12 }}>
        <h4>Lab Room Allocation</h4>
        {labRoomAssignments.map((labRoom, roomIndex) => {
          const currentAssignmentsInRoom = labRoom.assignments.reduce((acc, a) => acc + a.sections.length, 0);

          return (
            <div key={roomIndex} style={{ border: '1px solid #f0f0f0', padding: '8px', marginTop: '8px', borderRadius: '4px' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <input
                value={labRoom.roomName}
                onChange={e => {
                  const newAssignments = [...labRoomAssignments];
                  newAssignments[roomIndex].roomName = e.target.value;
                  setLabRoomAssignments(newAssignments);
                }}
                placeholder="Lab room name"
                style={{ flex: 1 }}
              />
              <button type="button" onClick={() => removeLabRoom(roomIndex)}>Remove Room</button>
            </div>

            {labRoom.assignments.map((assign, assignIndex) => {
              return (
              <div key={assignIndex} style={{ marginLeft: 16, borderLeft: '2px solid #ccc', paddingLeft: 8, marginBottom: 8 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    value={assign.subjectName}
                    onChange={e => {
                      const newAssignments = [...labRoomAssignments];
                      newAssignments[roomIndex].assignments[assignIndex].subjectName = e.target.value;
                      newAssignments[roomIndex].assignments[assignIndex].sections = []; // Reset sections on subject change
                      setLabRoomAssignments(newAssignments);
                    }}
                  >
                    <option value="">-- Select Subject --</option>
                    {subjects.filter(s => s.lab > 0).map(s => {
                      const isCurrentlySelected = s.name === assign.subjectName;
                      // A subject is available if it has at least one section that is not taken by another room,
                      // and not already assigned to this same subject in another row within this room.
                      const hasAvailableSection = sectionNames.some(secName => {
                        const takenByOtherRoom = isLabSlotTakenByOther(s.name, secName, roomIndex);
                        const takenBySameSubjectInThisRoom = labRoom.assignments.some((otherAssign, otherIdx) =>
                          assignIndex !== otherIdx && otherAssign.subjectName === s.name && otherAssign.sections.includes(secName)
                        );
                        return !takenByOtherRoom && !takenBySameSubjectInThisRoom;
                      });

                      const isDisabled = !hasAvailableSection && !isCurrentlySelected;
                      return <option key={s.name} value={s.name} disabled={isDisabled}>{s.name}</option>;
                    })}
                  </select>
                  <button type="button" onClick={() => {
                    const newAssignments = [...labRoomAssignments];
                    newAssignments[roomIndex].assignments.splice(assignIndex, 1);
                    setLabRoomAssignments(newAssignments);
                  }}>Remove Subject</button>
                </div>
                <div style={{ marginTop: 4, fontSize: '12px' }}>
                  <strong>Sections (max 6 per room):</strong>
                  {sectionNames.map(secName => {
                    const isChecked = assign.sections.includes(secName);
                    const isTakenElsewhere = isLabSlotTakenByOther(assign.subjectName, secName, roomIndex);
                    // A section is non-tickable if it's already ticked for the SAME subject in another row in THIS room.
                    const isTakenBySameSubjectInThisRoom = labRoom.assignments.some((otherAssign, otherIdx) =>
                      assignIndex !== otherIdx &&
                      otherAssign.subjectName === assign.subjectName &&
                      otherAssign.sections.includes(secName)
                    );
                    const isRoomFull = currentAssignmentsInRoom >= 6 && !isChecked;
                    return (
                      <label key={secName} style={{ marginRight: 8, marginLeft: 4, opacity: isTakenElsewhere || isTakenBySameSubjectInThisRoom ? 0.5 : 1 }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={!assign.subjectName || isRoomFull || isTakenElsewhere || isTakenBySameSubjectInThisRoom}
                          onChange={e => {
                            const newAssignments = [...labRoomAssignments];
                            const currentSections = newAssignments[roomIndex].assignments[assignIndex].sections;
                            const newSections = e.target.checked
                              ? [...currentSections, secName]
                              : currentSections.filter(s => s !== secName);
                            newAssignments[roomIndex].assignments[assignIndex].sections = newSections;
                            setLabRoomAssignments(newAssignments);
                          }}
                        /> {secName}
                      </label>
                    );
                  })}
                </div>
              </div>
            )})}
            <button
              type="button"
              style={{ marginLeft: 16 }}
              disabled={currentAssignmentsInRoom >= 6 || allLabSlotsAssigned}
              onClick={() => {
                const newAssignments = [...labRoomAssignments];
                newAssignments[roomIndex].assignments.push({ subjectName: "", sections: [] });
                setLabRoomAssignments(newAssignments);
              }}
            >
              Add Subject to Room
            </button>
          </div>
        )})}
        <div>
          <button type="button" onClick={addLabRoom} disabled={allLabSlotsAssigned}>Add Lab Room</button>
        </div>
      </div>

      <hr />

      <div style={{ marginTop: 12 }}>
        <h4>{`Faculty (${faculty.length} total)`}</h4>
        {faculty.map((f, facultyIdx) => {
          const uniqueSubjects = new Set(f.assignments.map(a => a.subject).filter(Boolean));

          // Determine if this faculty can take on any new assignments.
          // This is true if there is at least one unassigned class slot (theory or lab)
          // for a subject that this faculty is eligible to teach (i.e., not exceeding the 2-subject limit).
          let canTakeNewAssignment = false;
          for (const s of subjects) {
            if (!s.name) continue;

            const canTeachSubject = uniqueSubjects.size < 2 || uniqueSubjects.has(s.name);
            if (!canTeachSubject) continue;

            for (const secName of sectionNames) {
              const theoryNeededAndAvailable = s.credit > 0 && !assignedSlots.has(`${s.name}-${secName}-theory`);
              const labNeededAndAvailable = s.lab > 0 && !assignedSlots.has(`${s.name}-${secName}-lab`);
              if (theoryNeededAndAvailable || labNeededAndAvailable) {
                canTakeNewAssignment = true;
                break;
              }
            }
            if (canTakeNewAssignment) break;
          }

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
                disabled={!canTakeNewAssignment}
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
      <div style={{ marginTop: 12, display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button type="submit" title="Generate and view timetable">
          Generate Timetable
        </button>
        <button type="button" onClick={handleClearForm} title="Clear all fields and start over" style={{ backgroundColor: '#dc3545', color: 'white' }}>
          Clear Form
        </button>
      </div>
    </form>
  );
}
