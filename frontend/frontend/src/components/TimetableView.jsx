import React from "react";

export default function TimetableView({ schedule }) {
  // The `schedule` prop now holds the entire API response.
  if (!schedule || !schedule.schedules) return null;

  // Get the list of section names to iterate over.
  const sectionNames = schedule.sections || Object.keys(schedule.schedules);

  // --- Dashboard Calculations ---
  const totalSubjects = schedule.subjects?.length || 0;
  const totalFaculty = schedule.faculty?.length || 0;

  let totalTheoryClasses = 0;
  let totalLabClasses = 0;

  sectionNames.forEach(sectionName => {
    const sectionSchedule = schedule.schedules[sectionName];
    if (sectionSchedule && sectionSchedule.days) {
      sectionSchedule.days.forEach(day => {
        day.periods.forEach(p => {
          if (p && !p.break) {
            if (!p.isLab) {
              totalTheoryClasses++;
            } else if (p.note === 'lab start') {
              totalLabClasses++;
            }
          }
        });
      });
    }
  });

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

        const subjectCodeMap = new Map(schedule.subjects.map(s => [s.name, s.code]));

        // Get a unique list of faculty teaching in this section for the legend
        const facultyInThisSection = new Map();
        sectionSchedule.days.forEach(day => {
          day.periods.forEach(p => {
            if (p && p.faculty && p.faculty.abbr) {
              if (!facultyInThisSection.has(p.faculty.abbr)) {
                facultyInThisSection.set(p.faculty.abbr, p.faculty.name);
              }
            }
          });
        });
        const facultyListForLegend = Array.from(facultyInThisSection, ([abbr, name]) => ({ abbr, name }))
          .sort((a, b) => a.name.localeCompare(b.name));

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
                    {day.periods.map((p, pi) => {
                      if (p?.note === 'lab cont.') {
                        // This period is covered by the previous "lab start" cell with colSpan=2.
                        return null;
                      }

                      const isLabStart = p?.note === 'lab start';
                      const colSpan = isLabStart ? 2 : 1;

                      return (
                        <td key={pi} colSpan={colSpan} style={{ border: "1px solid #eee", padding: 8, textAlign: "center", minHeight: 60, verticalAlign: 'top', backgroundColor: isLabStart ? '#f0f8ff' : 'transparent' }}>
                          {p?.break ? (
                            "Break"
                          ) : p ? (
                            <>
                              <div style={{ fontWeight: 700, fontSize: '14px' }}>{subjectCodeMap.get(p.subject) || p.subject}</div>
                              <div style={{ fontSize: 11, color: '#777', marginTop: 4 }}>
                                {p.room || "-"} ({p.isLab ? "Lab" : "Theory"})
                              </div>
                              <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>{p.faculty?.abbr || ""}</div>
                            </>
                          ) : (
                            "-"
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 32, borderTop: '1px solid #ccc', paddingTop: 16 }}>
              <h4 style={{ marginTop: 0 }}>Legend for Section {sectionName}</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                <div>
                  <h5 style={{ marginTop: 0, marginBottom: 8 }}>Subjects</h5>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f9f9f9' }}>
                        <th style={{ border: '1px solid #ddd', padding: 8, textAlign: 'left' }}>Code</th>
                        <th style={{ border: '1px solid #ddd', padding: 8, textAlign: 'left' }}>Full Name</th>
                      </tr>
                    </thead>
                    <tbody>
                      {schedule.subjects.slice().sort((a, b) => a.name.localeCompare(b.name)).map(subject => (
                        <tr key={subject.code}>
                          <td style={{ border: '1px solid #ddd', padding: 8 }}>{subject.code}</td>
                          <td style={{ border: '1px solid #ddd', padding: 8 }}>{subject.name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div>
                  <h5 style={{ marginTop: 0, marginBottom: 8 }}>Faculty in this Section</h5>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f9f9f9' }}>
                        <th style={{ border: '1px solid #ddd', padding: 8, textAlign: 'left' }}>Abbreviation</th>
                        <th style={{ border: '1px solid #ddd', padding: 8, textAlign: 'left' }}>Full Name</th>
                      </tr>
                    </thead>
                    <tbody>
                      {facultyListForLegend.map(fac => (
                        <tr key={fac.abbr}>
                          <td style={{ border: '1px solid #ddd', padding: 8 }}>{fac.abbr}</td>
                          <td style={{ border: '1px solid #ddd', padding: 8 }}>{fac.name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        );
      })}
      <div style={{ marginTop: 32, borderTop: '2px solid #038BB8', paddingTop: 12 }}>
        <h2>Dashboard</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          <div style={{ border: '1px solid #ddd', padding: '16px', borderRadius: '8px', textAlign: 'center' }}>
            <h3 style={{ margin: 0, color: '#038BB8' }}>{totalTheoryClasses}</h3>
            <p style={{ margin: '4px 0 0', color: '#555' }}>Total Theory Classes</p>
          </div>
          <div style={{ border: '1px solid #ddd', padding: '16px', borderRadius: '8px', textAlign: 'center' }}>
            <h3 style={{ margin: 0, color: '#038BB8' }}>{totalLabClasses}</h3>
            <p style={{ margin: '4px 0 0', color: '#555' }}>Total Lab Classes</p>
          </div>
          <div style={{ border: '1px solid #ddd', padding: '16px', borderRadius: '8px', textAlign: 'center' }}>
            <h3 style={{ margin: 0, color: '#038BB8' }}>{totalSubjects}</h3>
            <p style={{ margin: '4px 0 0', color: '#555' }}>Total Subjects</p>
          </div>
          <div style={{ border: '1px solid #ddd', padding: '16px', borderRadius: '8px', textAlign: 'center' }}>
            <h3 style={{ margin: 0, color: '#038BB8' }}>{totalFaculty}</h3>
            <p style={{ margin: '4px 0 0', color: '#555' }}>Total Faculty</p>
          </div>
        </div>
      </div>
    </div>
  );
}
