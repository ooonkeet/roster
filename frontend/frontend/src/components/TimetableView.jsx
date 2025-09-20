import React from "react";

export default function TimetableView({ schedule }) {
  // The `schedule` prop now holds the entire API response.
  if (!schedule || !schedule.schedules) return null;

  // Get the list of section names to iterate over.
  const sectionNames = schedule.sections || Object.keys(schedule.schedules);

  return (
    <div>
      <h2 style={{ marginTop: 12 }}>Generated Timetables</h2>
      {sectionNames.map((sectionName) => {
        const sectionSchedule = schedule.schedules[sectionName];
        if (!sectionSchedule || !sectionSchedule.days) {
          return (
            <div key={sectionName}>
              <h3>Timetable for Section {sectionName}</h3>
              <p>No schedule data available for this section.</p>
            </div>
          );
        }

        // Calculate the number of scheduled classes for verification.
        const subjectCounts = {};
        schedule.subjects.forEach(subject => {
          subjectCounts[subject.name] = { theory: 0, lab: 0 };
        });

        sectionSchedule.days.forEach(day => {
          day.periods.forEach(p => {
            if (p && !p.break) {
              if (!p.isLab) {
                subjectCounts[p.subject].theory++;
              } else if (p.note === 'lab start') {
                // Count only the start of a lab block.
                subjectCounts[p.subject].lab++;
              }
            }
          });
        });

        const subjectConstraints = {};
        schedule.subjects.forEach(subject => {
          subjectConstraints[subject.name] = { credit: subject.credit, lab: subject.lab };
        });

        const periodsCount = sectionSchedule.days[0]?.periods.length || 0;
        const periodHeaders = Array.from({ length: periodsCount }, (_, i) => i + 1);

        return (
          <div key={sectionName} style={{ marginBottom: 32, borderTop: '2px solid #038BB8', paddingTop: 12 }}>
            <h3>Timetable for Section {sectionName}</h3>
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
              <thead>
                <tr>
                  <th style={{ border: "1px solid #ddd", padding: 6, width: "120px" }}>Day</th>
                  {periodHeaders.map((pNum) => (
                    <th key={pNum} style={{ border: "1px solid #ddd", padding: 6 }}>
                      P{pNum}
                      {pNum === schedule.breakPeriod ? " (Break)" : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sectionSchedule.days.map((day, di) => (
                  <tr key={di}>
                    <td style={{ border: "1px solid #ddd", padding: 8, fontWeight: "bold", textAlign: "center" }}>
                      {day.day}
                    </td>
                    {day.periods.map((p, pi) => (
                      <td key={pi} style={{ border: "1px solid #eee", padding: 8, textAlign: "center", minHeight: 60, verticalAlign: 'top' }}>
                        {p?.break ? (
                          "Break"
                        ) : p ? (
                          <>
                            <div style={{ fontWeight: 700, fontSize: '14px' }}>{p.subject}</div>
                            <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>{p.faculty || ""}</div>
                            <div style={{ fontSize: 11, color: '#777', marginTop: 4 }}>
                              {p.room || "-"} ({p.isLab ? "Lab" : "Theory"})
                            </div>
                          </>
                        ) : (
                          "-"
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 24, padding: '12px', border: '1px solid #e0e0e0', borderRadius: '4px' }}>
              <h4 style={{ marginTop: 0, marginBottom: 12 }}>Weekly Class Summary</h4>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                  <thead>
                      <tr style={{ backgroundColor: '#f9f9f9' }}>
                          <th style={{ border: '1px solid #ddd', padding: 8, textAlign: 'left' }}>Subject</th>
                          <th style={{ border: '1px solid #ddd', padding: 8 }}>Theory (Scheduled / Requested)</th>
                          <th style={{ border: '1px solid #ddd', padding: 8 }}>Labs (Scheduled / Requested)</th>
                      </tr>
                  </thead>
                  <tbody>
                      {Object.keys(subjectCounts).map(subjectName => {
                          const scheduledTheory = subjectCounts[subjectName].theory;
                          const requestedTheory = subjectConstraints[subjectName].credit;
                          const theoryMatch = scheduledTheory === requestedTheory;

                          const scheduledLab = subjectCounts[subjectName].lab;
                          const requestedLab = subjectConstraints[subjectName].lab;
                          const labMatch = scheduledLab === requestedLab;

                          return (
                              <tr key={subjectName}>
                                  <td style={{ border: '1px solid #ddd', padding: 8, fontWeight: 'bold' }}>{subjectName}</td>
                                  <td style={{ border: '1px solid #ddd', padding: 8, textAlign: 'center', backgroundColor: theoryMatch ? '#e8f5e9' : '#ffebee', color: theoryMatch ? 'green' : 'red' }}>
                                      {scheduledTheory} / {requestedTheory}
                                  </td>
                                  <td style={{ border: '1px solid #ddd', padding: 8, textAlign: 'center', backgroundColor: labMatch ? '#e8f5e9' : '#ffebee', color: labMatch ? 'green' : 'red' }}>
                                      {scheduledLab} / {requestedLab}
                                  </td>
                              </tr>
                          );
                      })}
                  </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
